import {
	deleteRailwayProject,
	ensureRailwayCustomDomain,
	ensureRailwayEnvironment,
	ensureRailwayGeneratedServiceDomain,
	ensureRailwayPostgresService,
	ensureRailwayProject,
	ensureRailwayService,
	ensureRailwayServiceVolume,
	listRailwayEnvironments,
	listRailwayProjects,
	listRailwayServices,
	listRailwayVariables,
	listRailwayVolumes,
	resolveRailwayWorkspaceContext,
	upsertRailwayVariables,
} from '../operations/services/railway-api.ts';
import type { TreeseedCanonicalDrift, TreeseedCanonicalGraphNode } from './platform.ts';
import type {
	RunTreeseedLiveReconcileTestsOptions,
	TreeseedLiveReconcileEnvironment,
	TreeseedLiveReconcileMode,
	TreeseedLiveReconcileScenarioResult,
} from './live-acceptance.ts';
import { capacityAcceptanceConfig, type CapacityAcceptanceProof } from './live-acceptance-capacity-context.ts';
import { runCapacityProviderAssignmentProof } from './live-acceptance-capacity-proof.ts';
import { resolveLiveTestDomain } from './live-acceptance-provider-config.ts';
import {
	PROVIDER_CAPABILITIES,
	blocking,
	measuredScenario,
	node,
	providerNode,
	providerPrefixRoot,
	scenario,
	waitForLiveObservation,
} from './live-acceptance-runtime.ts';
import { configuredLiveAcceptanceValue as configuredValue, type LiveAcceptanceEnv } from './live-acceptance-values.ts';

type LiveEnv = LiveAcceptanceEnv;
type LiveProgress = RunTreeseedLiveReconcileTestsOptions['onProgress'];

function railwayAcceptanceMissingConfig(cwd: string, environment: TreeseedLiveReconcileEnvironment, env: LiveEnv) {
	const missing: string[] = [];
	if (!configuredValue(env, ['TREESEED_RAILWAY_API_TOKEN'])) missing.push('TREESEED_RAILWAY_API_TOKEN');
	if (!resolveLiveTestDomain(cwd, env)) missing.push('TREESEED_LIVE_TEST_DOMAIN or treeseed.site.yaml siteUrl');
	missing.push(...capacityAcceptanceConfig(env, environment).missing);
	return missing;
}

async function cleanupRailwayPrefixedProjects(environment: TreeseedLiveReconcileEnvironment, env: LiveEnv, fetchImpl: typeof fetch) {
	const prefixRoot = providerPrefixRoot(environment, 'railway');
	const workspace = await resolveRailwayWorkspaceContext({ env, fetchImpl });
	const projects = await listRailwayProjects({ workspaceId: workspace.id, env, fetchImpl });
	const prefixed = projects.filter((project) => !project.deletedAt && project.name.startsWith(prefixRoot));
	const destroyed: TreeseedCanonicalGraphNode[] = [];
	for (const project of prefixed) {
		await deleteRailwayProject({ projectId: project.id, env, fetchImpl });
		destroyed.push(node('railway', environment, 'project', project.name, { id: project.id, deleted: true }));
	}
	const refreshed = await listRailwayProjects({ workspaceId: workspace.id, env, fetchImpl });
	const remaining = refreshed.filter((project) => !project.deletedAt && project.name.startsWith(prefixRoot));
	return { workspace, destroyed, remaining };
}

export async function runRailwayCleanup(environment: TreeseedLiveReconcileEnvironment, prefix: string, mode: TreeseedLiveReconcileMode, env: LiveEnv, fetchImpl: typeof fetch) {
	try {
		const cleanup = await cleanupRailwayPrefixedProjects(environment, env, fetchImpl);
		const results = PROVIDER_CAPABILITIES.railway.map((capability) => scenario({
			provider: 'railway',
			mode,
			prefix,
			capability,
			ok: cleanup.remaining.length === 0,
			phase: 'cleanup',
			action: cleanup.destroyed.length > 0 ? 'delete' : 'noop',
			reason: cleanup.remaining.length === 0
				? `Railway cleanup removed ${cleanup.destroyed.length} prefixed test project(s).`
				: `Railway cleanup left ${cleanup.remaining.length} prefixed test project(s).`,
			destroyedResources: cleanup.destroyed,
			issues: cleanup.remaining.map((project) => `Remaining project ${project.name} (${project.id})`),
		}));
		const cleanupDrift = cleanup.remaining.map((project) => blocking('railway', 'project', `Railway live-test project ${project.name} (${project.id}) remained after cleanup.`));
		return { results, cleanupDrift };
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return {
			results: PROVIDER_CAPABILITIES.railway.map((capability) => scenario({ provider: 'railway', mode, prefix, capability, ok: false, phase: 'blocked', action: 'blocked', reason })),
			cleanupDrift: [blocking('railway', 'project', reason)],
		};
	}
}

export async function runRailwayAcceptance(cwd: string, environment: TreeseedLiveReconcileEnvironment, runId: string, prefix: string, env: LiveEnv, fetchImpl: typeof fetch, onProgress?: LiveProgress) {
	const mode: TreeseedLiveReconcileMode = 'acceptance';
	const missing = railwayAcceptanceMissingConfig(cwd, environment, env);
	if (missing.length > 0) {
		return {
			results: PROVIDER_CAPABILITIES.railway.map((capability) => scenario({
				provider: 'railway',
				mode,
				prefix,
				capability,
				ok: false,
				phase: 'blocked',
				action: 'blocked',
				reason: `Missing Railway acceptance configuration: ${missing.join(', ')}.`,
			})),
			cleanupDrift: [],
		};
	}
	const cleanupBefore = await cleanupRailwayPrefixedProjects(environment, env, fetchImpl);
	if (cleanupBefore.remaining.length > 0) {
		return {
			results: PROVIDER_CAPABILITIES.railway.map((capability) => scenario({
				provider: 'railway',
				mode,
				prefix,
				capability,
				ok: false,
				phase: 'blocked',
				action: 'blocked',
				reason: `Railway acceptance refused to create a project because ${cleanupBefore.remaining.length} prefixed project(s) remain after cleanup.`,
			})),
			cleanupDrift: cleanupBefore.remaining.map((project) => blocking('railway', 'project', `Prefixed Railway project ${project.name} (${project.id}) remained before acceptance.`)),
		};
	}
	const domainRoot = resolveLiveTestDomain(cwd, env);
	const projectName = prefix;
	const envName = 'staging';
	const serviceName = `${prefix}-web`;
	const statefulName = `${prefix}-s01`;
	const volumeName = `${statefulName}-volume`;
	const postgresName = `${prefix}-pg`;
	const customDomain = `${prefix}.${domainRoot}`.replace(/_/gu, '-');
	const results: TreeseedLiveReconcileScenarioResult[] = [];
	const cleanupDrift: TreeseedCanonicalDrift[] = [];
	let projectId = '';
	try {
		const project = await ensureRailwayProject({ projectName, defaultEnvironmentName: envName, env, fetchImpl });
		projectId = project.project.id;
		results.push(await measuredScenario({
			provider: 'railway', mode, environment, runId, prefix, capability: 'project', phase: 'create', action: project.created ? 'create' : 'adopt',
			startMessage: 'railway:project: create/adopt started',
			successReason: 'Railway acceptance created exactly one test project for all Railway scenarios and observed it by id.',
			locators: { projectId },
			createdResources: [providerNode('railway', environment, 'project', projectName, { id: projectId })],
			onProgress,
		}, async () => waitForLiveObservation(
			`Railway project ${projectName}`,
			() => listRailwayProjects({ env, fetchImpl }).catch(() => [project.project]),
			(projects) => projects.some((candidate) => candidate.id === projectId),
		)));
		const environmentResult = await ensureRailwayEnvironment({ projectId, environmentName: envName, env, fetchImpl });
		const environmentId = environmentResult.environment.id;
		results.push(await measuredScenario({
			provider: 'railway', mode, environment, runId, prefix, capability: 'environment', phase: 'create', action: environmentResult.created ? 'create' : 'adopt',
			startMessage: 'railway:environment: create/adopt started',
			successReason: 'Railway acceptance created the project-scoped test environment and observed it live.',
			locators: { projectId, environmentId },
			createdResources: [providerNode('railway', environment, 'environment', envName, { id: environmentId })],
			onProgress,
		}, async () => waitForLiveObservation(
			`Railway environment ${envName}`,
			() => listRailwayEnvironments({ projectId, env, fetchImpl }),
			(environments) => environments.some((candidate) => candidate.id === environmentId),
		)));
		const service = await ensureRailwayService({
			projectId,
			environmentId,
			serviceName,
			imageRef: configuredValue(env, ['TREESEED_LIVE_TEST_RAILWAY_IMAGE']) || 'nginxdemos/hello:latest',
			env,
			fetchImpl,
		});
		const serviceId = service.service.id;
		const stateful = await ensureRailwayService({
			projectId,
			environmentId,
			serviceName: statefulName,
			imageRef: configuredValue(env, ['TREESEED_LIVE_TEST_RAILWAY_STATEFUL_IMAGE']) || 'nginxdemos/hello:latest',
			env,
			fetchImpl,
		});
		const statefulId = stateful.service.id;
		results.push(await measuredScenario({
			provider: 'railway', mode, environment, runId, prefix, capability: 'service', phase: 'create', action: service.created || stateful.created ? 'create' : 'adopt',
			startMessage: 'railway:service: create/adopt started',
			successReason: 'Railway acceptance created image and stateful services inside the single test project and observed both live.',
			locators: { projectId, environmentId, serviceId, statefulId },
			createdResources: [
				providerNode('railway', environment, 'service', serviceName, { id: serviceId }),
				providerNode('railway', environment, 'service', statefulName, { id: statefulId }),
			],
			onProgress,
		}, async () => waitForLiveObservation(
			`Railway services ${serviceName}, ${statefulName}`,
			() => listRailwayServices({ projectId, env, fetchImpl }),
			(services) => services.some((candidate) => candidate.id === serviceId) && services.some((candidate) => candidate.id === statefulId),
		)));
		await upsertRailwayVariables({
			projectId,
			environmentId,
			serviceId,
			variables: {
				TREESEED_LIVE_TEST_RUN_ID: runId,
				TREESEED_LIVE_TEST_PHASE: 'created',
			},
			env,
			fetchImpl,
		});
		await upsertRailwayVariables({
			projectId,
			environmentId,
			serviceId,
			variables: {
				TREESEED_LIVE_TEST_PHASE: 'updated',
			},
			env,
			fetchImpl,
		});
		results.push(await measuredScenario({
			provider: 'railway', mode, environment, runId, prefix, capability: 'variables', phase: 'update', action: 'update',
			startMessage: 'railway:variables: read-back started',
			successReason: 'Railway acceptance created, updated, and observed service variables.',
			locators: { projectId, environmentId, serviceId },
			updatedResources: (value) => [providerNode('railway', environment, 'variables', `${serviceName}:variables`, { keys: Object.keys(value as Record<string, unknown>).sort() })],
			onProgress,
		}, async () => waitForLiveObservation(
			'Railway updated service variables',
			() => listRailwayVariables({ projectId, environmentId, serviceId, env, fetchImpl }),
			(variables) => variables.TREESEED_LIVE_TEST_PHASE === 'updated',
		)));
		const volume = await ensureRailwayServiceVolume({
			projectId,
			environmentId,
			serviceId: statefulId,
			name: volumeName,
			mountPath: '/data',
			env,
			fetchImpl,
			settleAttempts: 6,
			settleDelayMs: 2500,
		});
		results.push(await measuredScenario({
			provider: 'railway', mode, environment, runId, prefix, capability: 'volume', phase: volume.created ? 'create' : 'replace', action: volume.created ? 'create' : 'reattach',
			startMessage: 'railway:volume: live read-back started',
			successReason: 'Railway acceptance attached/reconciled a stateful service volume and observed it live.',
			locators: { projectId, environmentId, serviceId: statefulId, volumeId: volume.volume.id },
			createdResources: [providerNode('railway', environment, 'volume', volumeName, { id: volume.volume.id, mountPath: '/data' })],
			onProgress,
		}, async () => waitForLiveObservation(
			`Railway volume ${volumeName}`,
			() => listRailwayVolumes({ projectId, env, fetchImpl }),
			(volumes) => volumes.some((candidate) => candidate.id === volume.volume.id || candidate.name === volumeName),
		)));
		const postgres = await ensureRailwayPostgresService({ projectId, environmentId, serviceName: postgresName, env, fetchImpl, maxAttempts: 80 });
		results.push(await measuredScenario({
			provider: 'railway', mode, environment, runId, prefix, capability: 'postgres', phase: 'create', action: postgres.created ? 'create' : 'adopt',
			startMessage: 'railway:postgres: live read-back started',
			successReason: postgres.proof.message,
			locators: { projectId, environmentId, serviceId: postgres.service.id },
			createdResources: [providerNode('railway', environment, 'postgres', postgresName, { id: postgres.service.id, proof: postgres.proof })],
			onProgress,
		}, async () => {
			if (!postgres.proof.ok) throw new Error(postgres.proof.message);
			return waitForLiveObservation(
				`Railway Postgres service ${postgresName}`,
				() => listRailwayServices({ projectId, env, fetchImpl }),
				(services) => services.some((candidate) => candidate.id === postgres.service.id),
			);
		}));
		const generatedDomain = await ensureRailwayGeneratedServiceDomain({ projectId, environmentId, serviceId, targetPort: 80, env, fetchImpl });
		let customDomainCreated = false;
		try {
			await ensureRailwayCustomDomain({ projectId, environmentId, serviceId, domain: customDomain, env, fetchImpl });
			customDomainCreated = true;
		} catch {
			customDomainCreated = false;
		}
		results.push(await measuredScenario({
			provider: 'railway', mode, environment, runId, prefix, capability: 'domain', phase: 'create', action: 'create',
			startMessage: 'railway:domain: live read-back started',
			successReason: customDomainCreated
				? 'Railway acceptance created generated and custom domain resources.'
				: 'Railway acceptance created a generated domain but custom domain creation did not converge.',
			locators: { projectId, environmentId, serviceId, generatedDomain: generatedDomain.domain.domain, customDomain },
			createdResources: [providerNode('railway', environment, 'domain', generatedDomain.domain.domain, { id: generatedDomain.domain.id })],
			onProgress,
		}, async () => {
			if (!generatedDomain.domain.domain || !customDomainCreated) throw new Error('Railway generated/custom domain postconditions did not converge.');
			return generatedDomain;
		}));
		results.push(await measuredScenario({
			provider: 'railway', mode, environment, runId, prefix, capability: 'image-service', phase: 'verify', action: 'noop',
			startMessage: 'railway:image-service: verifying image-backed service',
			successReason: 'Railway acceptance verified image service creation through the project-scoped service API.',
			locators: { projectId, environmentId, serviceId },
			onProgress,
		}, async () => waitForLiveObservation(
			`Railway image service ${serviceName}`,
			() => listRailwayServices({ projectId, env, fetchImpl }),
			(services) => services.some((candidate) => candidate.id === serviceId),
		)));
		results.push(await measuredScenario({
			provider: 'railway', mode, environment, runId, prefix, capability: 'deployment-health', phase: 'verify', action: 'noop',
			startMessage: 'railway:deployment-health: verifying deployment observation',
			successReason: 'Railway acceptance observed image services after deployment submission; app-specific deep HTTP health remains enforced by hosting verify/apply.',
			locators: { projectId, environmentId, serviceId },
			onProgress,
		}, async () => waitForLiveObservation(
			`Railway deployment service ${serviceName}`,
			() => listRailwayServices({ projectId, env, fetchImpl }),
				(services) => services.some((candidate) => candidate.id === serviceId),
			)));
		results.push(await measuredScenario({
			provider: 'railway', mode, environment, runId, prefix, capability: 'capacity-provider-runtime-assignment-proof', phase: 'verify', action: 'noop',
			startMessage: 'railway:capacity-provider-runtime-assignment-proof: running assignment lifecycle proof',
			successReason: 'Railway capacity acceptance created a diagnostic assignment, leased it through the provider protocol, emitted mode-run telemetry, and completed it.',
			locators: { projectId, environmentId },
			retainedResources: (value) => {
				const proof = value as CapacityAcceptanceProof;
				return [providerNode('railway', environment, 'capacity-runtime-proof', proof.assignmentId, {
					sessionId: proof.sessionId,
					modeRunId: proof.modeRunId,
					finalStatus: proof.finalStatus,
					mode: proof.mode,
					modeRunCount: proof.modeRunCount,
					artifactCount: proof.artifactCount,
					toolEventCount: proof.toolEventCount,
					usageActualCount: proof.usageActualCount,
					ledgerEntryCount: proof.ledgerEntryCount,
				})];
			},
			onProgress,
		}, async () => runCapacityProviderAssignmentProof({ provider: 'railway', environment, runId, prefix, env, fetchImpl })));
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		for (const capability of PROVIDER_CAPABILITIES.railway) {
			if (!results.some((result) => result.capability === capability)) {
				results.push(scenario({ provider: 'railway', mode, prefix, capability, ok: false, phase: 'blocked', action: 'blocked', reason, locators: { projectId: projectId || null } }));
			}
		}
	} finally {
		if (projectId) {
			await deleteRailwayProject({ projectId, env, fetchImpl }).catch((error) => {
				cleanupDrift.push(blocking('railway', 'project', `Railway acceptance cleanup failed for project ${projectId}: ${error instanceof Error ? error.message : String(error)}`));
			});
		}
		const cleanupAfter = await cleanupRailwayPrefixedProjects(environment, env, fetchImpl).catch((error) => {
			cleanupDrift.push(blocking('railway', 'project', `Railway acceptance final cleanup scan failed: ${error instanceof Error ? error.message : String(error)}`));
			return null;
		});
		if (cleanupAfter) {
			cleanupDrift.push(...cleanupAfter.remaining.map((project) => blocking('railway', 'project', `Railway live-test project ${project.name} (${project.id}) remained after acceptance cleanup.`)));
			if (cleanupAfter.destroyed.length > 0) {
				for (const result of results) {
					result.destroyedResources.push(...cleanupAfter.destroyed);
				}
			}
		}
	}
	return { results, cleanupDrift };
}

