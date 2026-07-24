import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	changeSetToEnvironmentPatch,
	IacClient,
	runRailwayIac,
	type RailwayChangeSet,
	type RailwayIacApplyResponse,
	type RailwayIacPlanResponse,
	type ResourceNode,
} from 'railway/iac';
import { railwayGraphqlRequest } from '../../../operations/services/hosting/railway/railway-api.ts';
import { assertApiRailwaySourcePolicy, isApiRailwaySourcePolicyService } from '../../../operations/services/hosting/railway/railway-source-policy.ts';
import { RailwayIacProjectInput, RailwayIacRenderResult, RailwayIacService, RailwayObservedService, RailwayObservedVolume, RailwayVolumeBinding, RailwayVolumeBindingResult, cleanupStaleRailwayIacRenders } from './railway-iac-service.ts';
import { activeObservedVolumeInstances, buildConfig, deployConfig, id, js, normalizeIacScope, renderPostgresEnv, renderServiceEnv, serviceSource, validateGeneratedVariables } from './run-railway-iac-with-rate-limit-retry.ts';

export function resolveRailwayIacVolumeBindings(input: {
	environmentId: string;
	services: RailwayIacService[];
	liveServices: RailwayObservedService[];
	volumes: RailwayObservedVolume[];
}): RailwayVolumeBindingResult {
	const bindings: RailwayVolumeBinding[] = [];
	const blockedReasons: string[] = [];
	const serviceIdByName = new Map(input.liveServices.map((service) => [service.name, service.id]));

	for (const service of input.services.filter((candidate) => Boolean(candidate.volumeMountPath))) {
		const canonicalVolumeName = `${service.serviceName}-volume`;
		const desiredServiceId = serviceIdByName.get(service.serviceName) ?? null;
		const canonical = input.volumes.flatMap((volume) =>
			activeObservedVolumeInstances(volume)
				.filter((instance) => instance.environmentId === input.environmentId && volume.name === canonicalVolumeName)
				.map((instance) => ({ volume, instance })),
		);
		const candidatesByVolume = new Map(canonical.map((candidate) => [candidate.volume.id, candidate]));
		if (candidatesByVolume.size > 1) {
			blockedReasons.push(`${service.serviceName}: ${candidatesByVolume.size} active volumes are viable in environment ${input.environmentId}; refusing ambiguous stateful volume ownership.`);
			continue;
		}
		const selected = candidatesByVolume.values().next().value as typeof candidates[number] | undefined;
		if (!selected?.volume.id || !selected.volume.name) {
			const pendingCanonicalCollision = input.volumes.some((volume) =>
				(volume.name === canonicalVolumeName || (
					String(volume.name ?? '').startsWith('pending-delete-')
					&& Boolean(desiredServiceId)
					&& volume.instances.some((instance) => instance.serviceId === desiredServiceId)
				))
				&& volume.instances.length > 0
				&& activeObservedVolumeInstances(volume).length === 0,
			);
			if (pendingCanonicalCollision) continue;
			continue;
		}
		bindings.push({
			serviceName: service.serviceName,
			volumeId: selected.volume.id,
			volumeName: selected.volume.name,
			canonicalVolumeName,
			mode: 'canonical',
			reason: selected.instance.serviceId === desiredServiceId
				? 'existing desired-service attachment'
				: 'active canonical volume',
		});
	}

	return { bindings, blockedReasons };
}

export function detachRetainedRailwayVolumeBindings(
	resources: ResourceNode[],
	bindings: RailwayVolumeBinding[],
) {
	const movedVolumeNames = new Set(bindings.map((binding) => binding.volumeName));
	return resources.map((resource) => {
		if (resource.type !== 'service' && resource.type !== 'database') return resource;
		const attachments = Object.fromEntries(Object.entries(resource.volumeAttachments ?? {})
			.filter(([, attachment]) => !movedVolumeNames.has(String(attachment.volume).replace(/^volume\./u, ''))));
		const volumeMounts = Object.fromEntries(Object.entries(resource.volumeMounts ?? {})
			.filter(([volumeId]) => !bindings.some((binding) => binding.volumeId === volumeId)));
		let deploy = resource.deploy;
		if (deploy && Object.keys(attachments).length === 0 && Object.keys(volumeMounts).length === 0) {
			const { requiredMountPath: _requiredMountPath, ...deployWithoutMountRequirement } = deploy;
			deploy = Object.keys(deployWithoutMountRequirement).length > 0 ? deployWithoutMountRequirement : undefined;
		}
		const { volumeAttachments: _attachments, volumeMounts: _volumeMounts, ...retained } = resource;
		return {
			...retained,
			...(Object.keys(attachments).length > 0 ? { volumeAttachments: attachments } : {}),
			...(Object.keys(volumeMounts).length > 0 ? { volumeMounts } : {}),
			...(deploy ? { deploy } : {}),
		} as ResourceNode;
	});
}

export function detachRetainedRailwayCustomDomains(resources: ResourceNode[], domains: string[]) {
	const selected = new Set(domains);
	return resources.map((resource) => {
		if (resource.type !== 'service' || selected.size === 0) return resource;
		const customDomains = Object.fromEntries(Object.entries(resource.networking?.customDomains ?? {})
			.filter(([domain]) => !selected.has(domain)));
		if (Object.keys(customDomains).length === Object.keys(resource.networking?.customDomains ?? {}).length) return resource;
		const networking = { ...(resource.networking ?? {}), customDomains };
		return { ...resource, networking } as ResourceNode;
	});
}

export function renderRailwayIacProject(input: RailwayIacProjectInput): RailwayIacRenderResult {
	const scope = normalizeIacScope(input);
	const region = input.region?.trim() || 'us-east4-eqdc4a';
	const tempParent = resolve(input.tenantRoot, '.treeseed', 'tmp');
	cleanupStaleRailwayIacRenders(input.tenantRoot);
	mkdirSync(tempParent, { recursive: true });
	const tempDir = mkdtempSync(resolve(tempParent, 'railway-iac-'));
	const filePath = resolve(tempDir, 'railway.mjs');
	const resources: string[] = [];
	const declarations: string[] = [];
	const volumeNames: string[] = [];
	const databaseVariableName = input.database ? 'db' : null;
	const databaseEnvName = input.database?.environmentVariable ?? null;
	const desiredResourceNames = new Set([
		...input.services.map((service) => service.serviceName),
		...input.services.filter((service) => service.volumeMountPath).map((service) => `${service.serviceName}-volume`),
		...(input.database ? [input.database.serviceName, `${input.database.serviceName}-volume`] : []),
	]);
	const retainedResources = (input.retainedResources ?? []).filter((resource) => !desiredResourceNames.has(resource.name));
	if (retainedResources.length > 0) {
		declarations.push(`  const retainedResources = ${js(retainedResources)};`);
		resources.push('...retainedResources');
	}
	if (input.database) {
		const postgresVolumeName = `${input.database.serviceName}-volume`;
		const postgresMountPath = input.database.mountPath?.trim() || '/var/lib/postgresql/data';
		volumeNames.push(postgresVolumeName);
		if (input.database.useNativePostgres) {
			declarations.push(`  const dbVolume = volume(${js(postgresVolumeName)}, ${js({
				region,
				sizeMB: 50000,
				allowOnlineResize: true,
				alerts: { usage: { 80: {}, 95: {}, 100: {} } },
			})});`);
			declarations.push(`  const db = postgres(${js(input.database.serviceName)}, ${js({ region })});`);
			resources.push('dbVolume', 'db');
		} else {
			const postgresMounts = [
				...(input.database.detachVolumeIds ?? []).map((volumeId) => `${js(volumeId)}: null`),
				`${js(postgresMountPath)}: dbVolume`,
			];
			declarations.push(`  const dbVolume = volume(${js(postgresVolumeName)}, ${js({
				region,
				sizeMB: 50000,
				allowOnlineResize: true,
				alerts: { usage: { 80: {}, 95: {}, 100: {} } },
			})});`);
			declarations.push(`  const db = service(${js(input.database.serviceName)}, {
    source: image("ghcr.io/railwayapp-templates/postgres-ssl:18"),
    env: ${renderPostgresEnv()},
    deploy: {
      requiredMountPath: ${js(postgresMountPath)},
      region: ${js(region)}
    },
    volumeMounts: { ${postgresMounts.join(', ')} }
  });`);
			resources.push('dbVolume', 'db');
		}
	}
	input.services.forEach((service, index) => {
		assertApiRailwaySourcePolicy(scope, service);
		const serviceVar = id('svc', index);
		const invalidVariables = validateGeneratedVariables(service);
		if (invalidVariables.length > 0) {
			throw new Error(`Railway IaC service ${service.serviceName} has invalid generated variables: ${invalidVariables.join(', ')}.`);
		}
		const entries = [
			`source: ${serviceSource(service)}`,
			`env: ${renderServiceEnv(service, databaseVariableName, databaseEnvName)}`,
		];
		const build = buildConfig(service);
		const deploy = deployConfig(service);
		if (build) entries.push(`build: ${js(build)}`);
		if (deploy) entries.push(`deploy: ${js(deploy)}`);
		entries.push(`regions: ${js({ [region]: 1 })}`);
		if ((service.customDomains?.length ?? 0) > 0) {
			entries.push(`networking: ${js({
				customDomains: Object.fromEntries(service.customDomains!.map((domain) => [domain, {}])),
			})}`);
		}
		if (service.volumeMountPath) {
			const volumeName = service.volumeName?.trim() || `${service.serviceName}-volume`;
			const volumeAddress = service.volumeAddress?.trim() || null;
			const volumeVar = id('vol', index);
			const volumeMounts = [
				...(service.detachVolumeIds ?? []).map((volumeId) => `${js(volumeId)}: null`),
				`${js(service.volumeMountPath)}: ${volumeVar}`,
			];
			volumeNames.push(volumeName);
			declarations.push(`  const ${volumeVar} = ${volumeAddress ? 'Object.assign(' : ''}volume(${js(volumeName)}, ${js({
				region,
				sizeMB: 50000,
				allowOnlineResize: true,
				alerts: { usage: { 80: {}, 95: {}, 100: {} } },
			})})${volumeAddress ? `, { address: ${js(volumeAddress)} })` : ''};`);
			entries.push(`volumeMounts: { ${volumeMounts.join(', ')} }`);
			resources.push(volumeVar);
		}
		declarations.push(`  const ${serviceVar} = service(${js(service.serviceName)}, {\n    ${entries.join(',\n    ')}\n  });`);
		resources.push(serviceVar);
	});
	const source = `
import { defineRailway, empty, github, image, postgres, project, service, volume, preserve } from "railway/iac";

export default defineRailway(() => {
${declarations.join('\n')}
  return project(${js(input.projectName)}, { resources: [${resources.join(', ')}] });
});
`.trimStart();
	writeFileSync(filePath, source);
	return {
		filePath,
		tempDir,
		projectName: input.projectName,
		environmentName: input.environmentName,
		serviceNames: input.services.map((service) => service.serviceName),
		volumeNames,
		databaseName: input.database?.serviceName ?? null,
		retainedResourceNames: retainedResources.map((resource) => resource.name),
		source,
	};
}

export function selectRailwayIacRetainedResources(
	plan: Pick<RailwayIacPlanResponse, 'changeSet' | 'currentGraph'>,
	allowedNames: Iterable<string>,
): ResourceNode[] {
	const allowed = new Set(allowedNames);
	return (plan.currentGraph?.resources ?? []).filter((resource) => allowed.has(resource.name));
}

export function changeName(change: any) {
	const directName = String(change?.resource?.name ?? change?.previous?.name ?? '').trim();
	if (directName) return directName;
	const location = String(change?.address ?? change?.path ?? '').trim();
	const pathMatch = /(?:^|\.)?(?:resources\.)?(?:service|database|volume)\.([^\.\s]+)/u.exec(location);
	if (pathMatch?.[1]) return pathMatch[1];
	const summaryMatch = /\b(?:service|database|volume)\s+([^\s]+)/iu.exec(String(change?.summary ?? ''));
	return summaryMatch?.[1] ?? location;
}

export function changeFieldText(change: any) {
	return [
		change?.field,
		change?.path,
		change?.address,
		change?.summary,
	].map((value) => String(value ?? '').toLowerCase()).join(' ');
}

export function isRailwaySourceChange(change: any) {
	const field = String(change?.field ?? '').toLowerCase();
	const path = String(change?.path ?? '').toLowerCase();
	const summary = String(change?.summary ?? '').toLowerCase();
	return field === 'source'
		|| /\.source\b/u.test(path)
		|| (/source/u.test(summary) && !/\b(env|environment|variable|variables)\b/u.test(summary));
}

export function isRailwayImageSourceChange(change: any) {
	if (!isRailwaySourceChange(change)) return false;
	return /image|docker-image/u.test(changeFieldText(change));
}

export function isRailwayGitSourceChange(change: any) {
	if (!isRailwaySourceChange(change)) return false;
	return /github|repo|branch/u.test(changeFieldText(change));
}
