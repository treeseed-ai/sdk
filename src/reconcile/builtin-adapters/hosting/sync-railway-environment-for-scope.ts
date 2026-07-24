import { resolve } from 'node:path';
import { configuredRailwayServices, railwayObsoleteAliasCleanupPolicy } from "../../../operations/services/hosting/railway/railway-deploy.ts";
import { attachRailwayVolumeWithCli, detachRailwayVolumeWithCli, updateRailwayVolumeWithCli } from "../../../operations/services/hosting/railway/railway-cli.ts";
import { listRailwayEnvironmentServices, listRailwayVolumes } from "../../../operations/services/hosting/railway/railway-api.ts";
import type { ReconcileAdapterInput } from "../../support/contracts/contracts.ts";
import { applyRailwayIacProjectWithPlan, cleanupRailwayIacRender, detachRetainedRailwayCustomDomains, detachRetainedRailwayVolumeBindings, findRailwayPendingVolumeNameCollisions, planRailwayIacProject, railwayIacApplyFailure, renderRailwayIacProject, resolveRailwayIacVolumeBindings, waitForRailwayVolumeAdoptionResources, waitForRailwayVolumeName, waitForRailwayServices, selectRailwayIacRetainedResources, validateRailwayIacChangeSet } from "../../providers/railway-iac.ts";
import { collectRailwayEnvironmentSync } from './observe-railway-unit.ts';
import { activeRailwayVolumeInstances, assertNoBlockedRailwayProviderDrift, resolveRailwayTopologyForScope, traceRailwayReconcile } from './resolve-railway-topology-for-scope.ts';
import { activeAttachedRailwayVolumeIds, configuredRailwayIacDatabase, configuredRailwayProjectSyncGroups, configuredRailwaySiblingResourceNames, railwayIacPlanDeletesResource, railwayIacServiceInput } from '../projects/projects-core/configured-railway-project-sync-groups.ts';

export async function syncRailwayEnvironmentForScope(
	input: ReconcileAdapterInput,
	{ planOnly = false, serviceKeys }: { planOnly?: boolean; serviceKeys?: string[] } = {},
) {
	const scope = input.context.target.kind === 'persistent' ? input.context.target.scope : 'staging';
	const sync = collectRailwayEnvironmentSync(input);
	const selectedServiceKeys = Array.isArray(serviceKeys) && serviceKeys.length > 0
		? [...new Set(serviceKeys.map((value) => String(value).trim()).filter(Boolean))]
		: undefined;
	traceRailwayReconcile(input.context.env, 'sync:start', `scope=${scope} planOnly=${planOnly ? 'yes' : 'no'}`);
	const projectGroups = configuredRailwayProjectSyncGroups(input, scope, selectedServiceKeys);
	if (projectGroups.length === 0) {
		return {
			scope,
			services: [],
			secrets: Object.keys(sync.secrets),
			variables: Object.keys(sync.variables),
			planOnly,
			workspace: '',
		};
	}
	let workspace = '';
	const syncedServices: ReturnType<typeof configuredRailwayServices> = [];
	const projectPlans: Array<{
		projectName: string;
		environmentName: string;
		changes: Array<{ kind: string; path: string; summary: string }>;
		volumeBindings: ReturnType<typeof resolveRailwayIacVolumeBindings>['bindings'];
	}> = [];
	for (const projectServices of projectGroups) {
		const serviceKeySet = [...new Set(projectServices.map((service) => service.key))];
		const topology = await resolveRailwayTopologyForScope(input, scope, {
			ensure: !planOnly,
			serviceKeys: serviceKeySet,
			includeInstances: false,
			includeVariables: false,
			refresh: true,
		});
		workspace = topology.workspace.name;
		const resolvedEntry = [...topology.services.values()].find((entry) => entry.project && entry.environment) ?? null;
		const project = resolvedEntry?.project;
		const environment = resolvedEntry?.environment;
		traceRailwayReconcile(topology.env, 'sync:topology', `project-services=${projectServices.map((service) => service.serviceName).join(',')}`);
		for (const service of projectServices) {
			railwayIacServiceInput(input, sync, service, scope);
		}
		if (!project || !environment) {
			throw new Error(`Railway IaC ${planOnly ? 'plan' : 'reconciliation'} could not resolve project/environment for ${projectServices[0]?.projectName ?? '(unknown project)'}/${projectServices[0]?.railwayEnvironment ?? '(unknown environment)'}.`);
		}
		const liveServices = await listRailwayEnvironmentServices({ environmentId: environment.id, env: topology.env });
		const liveServiceByName = new Map(liveServices.map((service) => [service.name, service]));
		let liveVolumes = await listRailwayVolumes({ projectId: project.id, env: topology.env });
		const databaseDescriptor = configuredRailwayIacDatabase(input, projectServices);
		let baseIacServices = projectServices.map((service) => railwayIacServiceInput(input, sync, service, scope));
		const desiredVolumeServices = [
			...baseIacServices,
			...(databaseDescriptor ? [{
				key: 'database',
				serviceName: databaseDescriptor.serviceName,
				volumeMountPath: databaseDescriptor.mountPath?.trim() || '/var/lib/postgresql/data',
			}] : []),
		];
		const pendingVolumeNameCollisions = findRailwayPendingVolumeNameCollisions({
			services: desiredVolumeServices,
			liveServices,
			volumes: liveVolumes,
		});
		if (pendingVolumeNameCollisions.length > 0) {
			const volumes = pendingVolumeNameCollisions
				.map((collision) => `${collision.canonicalVolumeName} (${collision.volumeId})`)
				.join(', ');
			if (input.context.launchEnv.TREESEED_REPLACE_PENDING_RAILWAY_VOLUMES !== '1') {
				throw new Error(`Railway has canonical volumes queued for deletion: ${volumes}. Railway only supports restoration during its 48-hour recovery window through the restoration links it emails; restore these exact volumes before rerunning TreeSeed reconciliation. For an explicitly disposable environment, use \`trsd hosting apply --replace-pending-volumes --yes\`. No replacement volumes were created.`);
			}
			traceRailwayReconcile(topology.env, 'sync:volume:replace-pending', volumes);
			for (const collision of pendingVolumeNameCollisions) {
				const serviceId = liveServiceByName.get(collision.serviceName)?.id
					?? project.services.find((service) => service.name === collision.serviceName)?.id
					?? collision.serviceId;
				if (!serviceId) {
					throw new Error(`Railway cannot replace queued volume ${collision.canonicalVolumeName}: service ${collision.serviceName} has no live identity.`);
				}
				const tombstoneName = `pending-delete-${collision.volumeId.slice(0, 8)}`;
				await updateRailwayVolumeWithCli({
					projectId: project.id,
					environmentId: environment.id,
					serviceId,
					volumeId: collision.volumeId,
					name: tombstoneName,
					mountPath: collision.mountPath,
					env: topology.env,
				});
				const renamed = await waitForRailwayVolumeName({
					volumeId: collision.volumeId,
					expectedName: tombstoneName,
					load: () => listRailwayVolumes({ projectId: project.id, env: topology.env }),
				});
				if (!renamed) {
					throw new Error(`Railway did not free canonical volume name ${collision.canonicalVolumeName} after explicit replacement approval.`);
				}
			}
			liveVolumes = await listRailwayVolumes({ projectId: project.id, env: topology.env });
			const pendingVolumeIdsByService = new Map<string, string[]>();
			for (const collision of pendingVolumeNameCollisions) {
				pendingVolumeIdsByService.set(collision.serviceName, [
					...(pendingVolumeIdsByService.get(collision.serviceName) ?? []),
					collision.volumeId,
				]);
			}
			baseIacServices = baseIacServices.map((service) => ({
				...service,
				detachVolumeIds: pendingVolumeIdsByService.get(service.serviceName) ?? service.detachVolumeIds,
			}));
		}
		const volumeBindingResult = resolveRailwayIacVolumeBindings({
			environmentId: environment.id,
			services: baseIacServices,
			liveServices,
			volumes: liveVolumes,
		});
		if (volumeBindingResult.blockedReasons.length > 0) {
			throw new Error(`Railway volume lineage blocks reconciliation: ${volumeBindingResult.blockedReasons.join('; ')}`);
		}
		const volumeBindingByServiceName = new Map(volumeBindingResult.bindings.map((binding) => [binding.serviceName, binding]));
		const databaseLiveService = databaseDescriptor
			? liveServiceByName.get(databaseDescriptor.serviceName)
				?? project.services.find((candidate) => candidate.name === databaseDescriptor.serviceName)
				?? null
			: null;
		const databaseDetachVolumeIds = databaseDescriptor
			? activeAttachedRailwayVolumeIds(liveVolumes, databaseLiveService?.id, environment.id, `${databaseDescriptor.serviceName}-volume`)
			: [];
		const databaseForIac = databaseDescriptor
			? { ...databaseDescriptor, detachVolumeIds: databaseDetachVolumeIds, useNativePostgres: false }
			: null;
		const token = String(topology.env.TREESEED_RAILWAY_API_TOKEN ?? topology.env.RAILWAY_API_TOKEN ?? '').trim();
		if (!token) {
			throw new Error(`Railway IaC reconciliation requires TREESEED_RAILWAY_API_TOKEN for ${project.name}/${environment.name}.`);
		}
		const iacInput = {
			tenantRoot: input.context.tenantRoot,
			scope,
			projectName: project.name,
			projectId: project.id,
			environmentName: environment.name,
			environmentId: environment.id,
			railwayApiToken: token,
			railwayApiUrl: String(topology.env.TREESEED_RAILWAY_API_URL ?? topology.env.RAILWAY_API_URL ?? '').trim() || null,
			services: baseIacServices.map((service) => ({
				...service,
				volumeName: volumeBindingByServiceName.get(service.serviceName)?.canonicalVolumeName ?? null,
				volumeAddress: (() => {
					const binding = volumeBindingByServiceName.get(service.serviceName);
					return binding && binding.volumeName !== binding.canonicalVolumeName
						? `volume.${binding.volumeName}`
						: null;
				})(),
			})),
			database: databaseForIac,
		};
		const projectEnvironmentServices = await Promise.all(project.environments.map(async (candidate) => ({
			environment: candidate,
			services: await listRailwayEnvironmentServices({ environmentId: candidate.id, env: topology.env }),
		})));
		const activeProjectEnvironmentServices = projectEnvironmentServices.flatMap((entry) => entry.services);
		const siblingEnvironmentName = scope === 'prod' ? 'staging' : scope === 'staging' ? 'production' : null;
		const siblingEnvironmentIds = new Set(project.environments
			.filter((candidate) => siblingEnvironmentName && candidate.name === siblingEnvironmentName)
			.map((candidate) => candidate.id));
		const activeSiblingServices = projectEnvironmentServices
			.filter((entry) => siblingEnvironmentIds.has(entry.environment.id))
			.flatMap((entry) => entry.services);
		const activeSiblingServiceIds = new Set(activeSiblingServices.map((service) => service.id));
		const activeSiblingResourceNames = [
			...activeSiblingServices.map((service) => service.name),
			...liveVolumes
				.filter((volume) => activeRailwayVolumeInstances(volume).some((instance) =>
					siblingEnvironmentIds.has(instance.environmentId ?? '')
					|| activeSiblingServiceIds.has(instance.serviceId ?? '')))
				.map((volume) => volume.name)
				.filter((name): name is string => Boolean(name)),
		];
		const aliasCleanup = railwayObsoleteAliasCleanupPolicy(
			scope,
			projectServices,
			project.services.map((service) => service.name),
			activeProjectEnvironmentServices.map((service) => service.name),
		);
		const protectedSiblingResourceNames = [...new Set([
			...configuredRailwaySiblingResourceNames(input, scope, project.name),
			...activeSiblingResourceNames,
		])];
		const siblingResourceNames = [
			...protectedSiblingResourceNames,
			...aliasCleanup.retainedResourceNames,
		];
		const allowedResourceDeletions = [
			...aliasCleanup.allowedResourceDeletions.filter((name) => !protectedSiblingResourceNames.includes(name)),
		];
		let effectiveIacInput = iacInput;
		let rendered = renderRailwayIacProject(effectiveIacInput);
		try {
			traceRailwayReconcile(topology.env, 'sync:iac-plan', `${project.name}/${environment.name}:${rendered.serviceNames.join(',')}:volumes=${rendered.volumeNames.join(',')}`);
			let plan = await planRailwayIacProject(effectiveIacInput, rendered);
			if (!plan.ok) {
				const diagnostics = plan.diagnostics.map((entry) => entry.message).filter(Boolean).join('; ');
				throw new Error(`Railway IaC plan failed for ${project.name}/${environment.name}${diagnostics ? `: ${diagnostics}` : '.'}`);
			}
			let validation = validateRailwayIacChangeSet(plan.changeSet, {
				services: rendered.serviceNames,
				volumes: rendered.volumeNames,
				database: rendered.databaseName,
				scope,
				serviceSourceModes: Object.fromEntries(effectiveIacInput.services.map((service) => [service.serviceName, service.sourceMode ?? null])),
				serviceSourceRefs: Object.fromEntries(effectiveIacInput.services.map((service) => [
					service.serviceName,
					service.sourceMode === 'git' && service.sourceRepo
						? `github:${service.sourceRepo}:${service.sourceBranch ?? ''}:${service.sourceRootDirectory ?? ''}:${service.sourceCommit ?? ''}`
						: service.sourceMode === 'image' && service.imageRef
							? `image:${service.imageRef}`
							: null,
				])),
				allowedResourceDeletions,
				protectedResourceNames: protectedSiblingResourceNames,
			});
			if (
				!validation.ok
				&& effectiveIacInput.database
				&& !effectiveIacInput.database.useNativePostgres
				&& railwayIacPlanDeletesResource(plan.changeSet, effectiveIacInput.database.serviceName)
			) {
				traceRailwayReconcile(topology.env, 'sync:iac-native-postgres-adopt', `${project.name}/${environment.name}:${effectiveIacInput.database.serviceName}`);
				cleanupRailwayIacRender(rendered);
				effectiveIacInput = {
					...effectiveIacInput,
					database: {
						...effectiveIacInput.database,
						useNativePostgres: true,
					},
				};
				rendered = renderRailwayIacProject(effectiveIacInput);
				plan = await planRailwayIacProject(effectiveIacInput, rendered);
				if (!plan.ok) {
					const diagnostics = plan.diagnostics.map((entry) => entry.message).filter(Boolean).join('; ');
					throw new Error(`Railway IaC plan failed for ${project.name}/${environment.name}${diagnostics ? `: ${diagnostics}` : '.'}`);
				}
				validation = validateRailwayIacChangeSet(plan.changeSet, {
					services: rendered.serviceNames,
					volumes: rendered.volumeNames,
					database: rendered.databaseName,
					scope,
					serviceSourceModes: Object.fromEntries(effectiveIacInput.services.map((service) => [service.serviceName, service.sourceMode ?? null])),
					serviceSourceRefs: Object.fromEntries(effectiveIacInput.services.map((service) => [
						service.serviceName,
						service.sourceMode === 'git' && service.sourceRepo
							? `github:${service.sourceRepo}:${service.sourceBranch ?? ''}:${service.sourceRootDirectory ?? ''}:${service.sourceCommit ?? ''}`
							: service.sourceMode === 'image' && service.imageRef
								? `image:${service.imageRef}`
								: null,
					])),
					allowedResourceDeletions,
					protectedResourceNames: protectedSiblingResourceNames,
				});
			}
			const retainedResources = detachRetainedRailwayCustomDomains(
				detachRetainedRailwayVolumeBindings(
					selectRailwayIacRetainedResources(plan, siblingResourceNames),
					volumeBindingResult.bindings,
				),
				effectiveIacInput.services.flatMap((service) => service.customDomains ?? []),
			);
			if (retainedResources.length > 0) {
				traceRailwayReconcile(
					topology.env,
					'sync:iac-retain-sibling-environment',
					`${project.name}/${environment.name}:${retainedResources.map((resource) => resource.name).join(',')}`,
				);
				cleanupRailwayIacRender(rendered);
				effectiveIacInput = { ...effectiveIacInput, retainedResources };
				rendered = renderRailwayIacProject(effectiveIacInput);
				plan = await planRailwayIacProject(effectiveIacInput, rendered);
				if (!plan.ok) {
					const diagnostics = plan.diagnostics.map((entry) => entry.message).filter(Boolean).join('; ');
					throw new Error(`Railway IaC plan failed for ${project.name}/${environment.name}${diagnostics ? `: ${diagnostics}` : '.'}`);
				}
				validation = validateRailwayIacChangeSet(plan.changeSet, {
					services: rendered.serviceNames,
					volumes: rendered.volumeNames,
					database: rendered.databaseName,
					scope,
					serviceSourceModes: Object.fromEntries(effectiveIacInput.services.map((service) => [service.serviceName, service.sourceMode ?? null])),
					serviceSourceRefs: Object.fromEntries(effectiveIacInput.services.map((service) => [
						service.serviceName,
						service.sourceMode === 'git' && service.sourceRepo
							? `github:${service.sourceRepo}:${service.sourceBranch ?? ''}:${service.sourceRootDirectory ?? ''}:${service.sourceCommit ?? ''}`
							: service.sourceMode === 'image' && service.imageRef
								? `image:${service.imageRef}`
								: null,
					])),
					allowedResourceDeletions,
					protectedResourceNames: protectedSiblingResourceNames,
				});
			}
			if (!validation.ok) {
				throw new Error(`Railway IaC plan rejected for ${project.name}/${environment.name}: ${validation.blockedReasons.join('; ')}`);
			}
			projectPlans.push({
				projectName: project.name,
				environmentName: environment.name,
				changes: (plan.changeSet?.changes ?? []).map((change) => ({
					kind: String(change.kind ?? ''),
					path: String(change.path ?? change.address ?? ''),
					summary: String(change.summary ?? ''),
				})),
				volumeBindings: volumeBindingResult.bindings,
			});
			if (planOnly) {
				syncedServices.push(...projectServices);
				continue;
			}
			const apply = await applyRailwayIacProjectWithPlan(effectiveIacInput, rendered, plan);
			const applyFailure = railwayIacApplyFailure(apply);
			if (applyFailure) throw new Error(`Railway IaC apply failed for ${project.name}/${environment.name}: ${applyFailure}`);
			for (const binding of volumeBindingResult.bindings) {
				const desiredConfig = effectiveIacInput.services.find((service) => service.serviceName === binding.serviceName);
				if (!desiredConfig?.volumeMountPath) {
					throw new Error(`Railway volume adoption could not resolve ${binding.canonicalVolumeName} and its desired service.`);
				}
				const settled = await waitForRailwayVolumeAdoptionResources({
					serviceName: binding.serviceName,
					volumeId: binding.volumeId,
					load: async () => ({
						services: await listRailwayEnvironmentServices({ environmentId: environment.id, env: topology.env }),
						volumes: await listRailwayVolumes({ projectId: project.id, env: topology.env }),
					}),
					sleep: async (milliseconds) => {
						traceRailwayReconcile(topology.env, 'sync:volume:settle', `${binding.canonicalVolumeName}:${milliseconds}ms`);
						await new Promise((resolve) => setTimeout(resolve, milliseconds));
					},
				});
				if (!settled) {
					throw new Error(`Railway volume adoption could not resolve ${binding.canonicalVolumeName} and its desired service after 12 observations.`);
				}
				const desiredService = settled.service;
				const liveVolume = settled.volume;
				const volumesAfterApply = settled.volumes;
				const activeEnvironmentAttachments = liveVolume.instances.filter((instance) =>
					instance.environmentId === environment.id
					&& !instance.isPendingDeletion
					&& !(typeof instance.deletedAt === 'string' && instance.deletedAt.trim())
					&& !['DELETING', 'DELETED'].includes(String(instance.state ?? '').toUpperCase()),
				);
				for (const attachment of activeEnvironmentAttachments.filter((instance) => instance.serviceId && instance.serviceId !== desiredService.id)) {
					traceRailwayReconcile(topology.env, 'sync:volume:detach-stale', `${liveVolume.name ?? liveVolume.id}:${attachment.serviceId}`);
					await detachRailwayVolumeWithCli({
						projectId: project.id,
						environmentId: environment.id,
						serviceId: attachment.serviceId!,
						volumeId: liveVolume.id,
						env: topology.env,
					});
				}
				const desiredAttachment = activeEnvironmentAttachments.find((instance) => instance.serviceId === desiredService.id);
				if (liveVolume.name !== binding.canonicalVolumeName || desiredAttachment?.mountPath !== desiredConfig.volumeMountPath) {
					traceRailwayReconcile(topology.env, 'sync:volume:update', `${liveVolume.name ?? liveVolume.id}:${binding.canonicalVolumeName}:${desiredConfig.volumeMountPath}`);
					await updateRailwayVolumeWithCli({
						projectId: project.id,
						environmentId: environment.id,
						serviceId: desiredService.id,
						volumeId: liveVolume.id,
						name: binding.canonicalVolumeName,
						mountPath: desiredConfig.volumeMountPath,
						env: topology.env,
					});
				}
				const refreshedVolume = (await listRailwayVolumes({ projectId: project.id, env: topology.env }))
					.find((volume) => volume.id === liveVolume.id);
				const attachedAfterUpdate = refreshedVolume?.instances.some((instance) =>
					instance.environmentId === environment.id
					&& instance.serviceId === desiredService.id
					&& !instance.isPendingDeletion
					&& !(typeof instance.deletedAt === 'string' && instance.deletedAt.trim())
					&& !['DELETING', 'DELETED'].includes(String(instance.state ?? '').toUpperCase()),
				);
				if (!attachedAfterUpdate) {
					traceRailwayReconcile(topology.env, 'sync:volume:attach', `${binding.canonicalVolumeName}:${desiredService.name}`);
					await attachRailwayVolumeWithCli({
						projectId: project.id,
						environmentId: environment.id,
						serviceId: desiredService.id,
						volumeId: liveVolume.id,
						env: topology.env,
					});
				}
			}
			const appliedServiceObservation = await waitForRailwayServices({
				serviceNames: effectiveIacInput.services.map((service) => service.serviceName),
				load: () => listRailwayEnvironmentServices({ environmentId: environment.id, env: topology.env }),
				sleep: async (milliseconds) => {
					traceRailwayReconcile(topology.env, 'sync:service:settle', `${project.name}/${environment.name}:${milliseconds}ms`);
					await new Promise((resolve) => setTimeout(resolve, milliseconds));
				},
			});
			const appliedServices = appliedServiceObservation?.services ?? [];
			const appliedServiceByName = new Map(appliedServices.map((service) => [service.name, service]));
			for (const service of effectiveIacInput.services) {
				const appliedService = appliedServiceByName.get(service.serviceName);
				if (!appliedService) {
					throw new Error(`Railway IaC did not create or retain expected service ${service.serviceName} in ${environment.name}.`);
				}
			}
			assertNoBlockedRailwayProviderDrift(input, scope);
			syncedServices.push(...projectServices);
		} finally {
			cleanupRailwayIacRender(rendered);
		}
	}
	traceRailwayReconcile(input.context.env, 'sync:done', `scope=${scope}`);
	return {
		scope,
		services: syncedServices,
		secrets: Object.keys(sync.secrets),
		variables: Object.keys(sync.variables),
		planOnly,
		workspace,
		projectPlans,
	};
	}
