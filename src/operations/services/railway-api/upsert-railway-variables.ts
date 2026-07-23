import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { IacClient } from 'railway';
import { connectRailwayServiceSourceWithCli, runRailwayCliJson } from '../railway-cli.ts';
import { resolveTreeseedRailwayApiToken } from '../../../service-credentials.ts';
import { RailwayCustomDomainSummary, RailwayVolumeSummary, configuredEnvValue, createRailwayEnvironmentPatchClient, railwayConnectionLabel } from './default-railway-api-url.ts';
import { listRailwayVariables } from './ensure-railway-service-instance-configuration.ts';
import { collectRailwayVolumes, railwayGraphqlRequest } from './collect-railway-volumes.ts';
import { isActiveRailwayVolumeInstance, normalizeRailwayCustomDomain } from './normalize-workspace.ts';

export async function upsertRailwayVariables({
	projectId,
	environmentId,
	serviceId,
	variables,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId: string;
	environmentId: string;
	serviceId?: string | null;
	variables: Record<string, string>;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	if (Object.keys(variables).length === 0) {
		return;
	}
	const client = createRailwayEnvironmentPatchClient({ env, fetchImpl });
	const applyVariablePatch = async (keys: string[]) => {
		const variablePatch = Object.fromEntries(keys.map((key) => [key, { value: variables[key] }]));
		await client.stageEnvironmentChanges({
			environmentId,
			merge: true,
			patch: serviceId
				? { services: { [serviceId]: { variables: variablePatch } } }
				: { sharedVariables: variablePatch },
		});
		await client.commitStagedPatch({
			environmentId,
			message: `Treeseed update ${keys.length} Railway variable${keys.length === 1 ? '' : 's'}`,
			skipDeploys: true,
		});
	};
	await applyVariablePatch(Object.keys(variables));
	const expectedKeys = Object.keys(variables);
	const mismatchedKeys = (observed: Record<string, string | null | undefined>) =>
		expectedKeys.filter((key) => observed[key] !== variables[key]);
	const observed = await listRailwayVariables({ projectId, environmentId, serviceId, env, fetchImpl }).catch(() => ({}));
	const missingOrMismatched = mismatchedKeys(observed);
	if (missingOrMismatched.length > 0) await applyVariablePatch(missingOrMismatched);
	let retried = missingOrMismatched.length > 0
		? await listRailwayVariables({ projectId, environmentId, serviceId, env, fetchImpl }).catch(() => ({}))
		: observed;
	let stillMismatched = mismatchedKeys(retried);
	for (let attempt = 0; stillMismatched.length > 0 && attempt < 12; attempt += 1) {
		await new Promise((resolve) => setTimeout(resolve, 2_500));
		retried = await listRailwayVariables({ projectId, environmentId, serviceId, env, fetchImpl }).catch(() => ({}));
		stillMismatched = mismatchedKeys(retried);
		if (stillMismatched.length > 0 && attempt === 5) {
			await applyVariablePatch(stillMismatched);
		}
	}
	if (stillMismatched.length > 0) {
		throw new Error(`Railway variable upsert did not persist expected values: ${stillMismatched.join(', ')}.`);
	}
}

export async function listRailwayVolumes({
	projectId,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const query = configuredEnvValue(env, 'TREESEED_RAILWAY_VOLUME_LIST_QUERY') || `
query TreeseedRailwayVolumeList($projectId: String!) {
	project(id: $projectId) {
		id
		volumes {
			edges {
				node {
					id
					name
					projectId
					volumeInstances {
						edges {
							node {
								id
								serviceId
								environmentId
								mountPath
								state
								isPendingDeletion
								deletedAt
							}
						}
					}
				}
			}
		}
	}
}
`.trim();
	const payload = await railwayGraphqlRequest({
		query,
		variables: { projectId },
		env,
		fetchImpl,
	});
	return collectRailwayVolumes(payload.data);
}

export async function ensureRailwayServiceVolume({
	projectId,
	environmentId,
	serviceId,
	name,
	mountPath,
	adoptVolumeId,
	env = process.env,
	fetchImpl = fetch,
	settleAttempts = 24,
	settleDelayMs = 5_000,
}: {
	projectId: string;
	environmentId: string;
	serviceId: string;
	name: string;
	mountPath: string;
	adoptVolumeId?: string | null;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
	settleAttempts?: number;
	settleDelayMs?: number;
}) {
	if (!mountPath.startsWith('/')) {
		throw new Error(`Railway volume mount path must be absolute: ${mountPath}`);
	}
	{
		const observed = await listRailwayVolumes({ projectId, env, fetchImpl });
		const exact = observed.find((candidate) =>
			candidate.name === name
			&& candidate.instances.some((instance) =>
				instance.serviceId === serviceId
				&& instance.environmentId === environmentId
				&& instance.mountPath === mountPath
				&& isActiveRailwayVolumeInstance(instance),
			),
		) ?? null;
		if (exact) {
			return {
				volume: exact,
				instance: exact.instances.find((instance) => instance.serviceId === serviceId && instance.environmentId === environmentId) ?? null,
				created: false,
				updated: false,
			};
		}
		const requestedAdoption = railwayConnectionLabel(adoptVolumeId);
		const adoptable = requestedAdoption
			? observed.find((candidate) => candidate.id === requestedAdoption) ?? null
			: observed.find((candidate) => candidate.name === name)
				?? findRailwayVolumeForService(observed, serviceId, environmentId)
				?? null;
		if (requestedAdoption && !adoptable) {
			throw new Error(`Railway volume ${requestedAdoption} cannot be adopted because it was not found; refusing to create an empty replacement volume.`);
		}
		const volumeKey = adoptable?.id ?? name;
		const client = createRailwayEnvironmentPatchClient({ env, fetchImpl });
		await client.stageEnvironmentChanges({
			environmentId,
			merge: true,
			patch: {
				volumes: { [volumeKey]: adoptable ? { isDeleted: false } : { isCreated: true } },
				services: { [serviceId]: { volumeMounts: { [volumeKey]: { mountPath } } } },
			},
		});
		await client.commitStagedPatch({
			environmentId,
			message: `Treeseed reconcile volume ${name}`,
			skipDeploys: true,
		});
		for (let attempt = 0; attempt <= settleAttempts; attempt += 1) {
			if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, settleDelayMs));
			const refreshed = await listRailwayVolumes({ projectId, env, fetchImpl });
			const volume = refreshed.find((candidate) => candidate.id === adoptable?.id || candidate.name === name) ?? null;
			const instance = volume?.instances.find((entry) =>
				entry.serviceId === serviceId
				&& entry.environmentId === environmentId
				&& entry.mountPath === mountPath
				&& isActiveRailwayVolumeInstance(entry),
			) ?? null;
			if (volume && instance) return { volume, instance, created: !adoptable, updated: Boolean(adoptable) };
		}
		throw new Error(`Railway SDK volume reconciliation did not observe ${name} mounted on service ${serviceId} at ${mountPath}.`);
	}
}

export function findRailwayVolumeForService(volumes: RailwayVolumeSummary[], serviceId: string, environmentId?: string) {
	return volumes.find((candidate) =>
		candidate.instances.some((instance) =>
			instance.serviceId === serviceId
			&& (!environmentId || instance.environmentId === environmentId)
			&& isActiveRailwayVolumeInstance(instance)
		),
	) ?? null;
}

export async function listRailwayCustomDomains({
	projectId,
	environmentId,
	serviceId,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId: string;
	environmentId: string;
	serviceId: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const payload = await railwayGraphqlRequest<{
		domains?: {
			customDomains?: Array<Record<string, unknown> | null> | null;
		} | null;
	}>({
		query: `
query TreeseedRailwayCustomDomains($projectId: String!, $environmentId: String!, $serviceId: String!) {
	domains(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) {
		customDomains {
			id
			domain
			environmentId
			serviceId
			targetPort
			status {
				verified
				certificateStatus
				verificationDnsHost
				verificationToken
				dnsRecords {
					fqdn
					hostlabel
					recordType
					requiredValue
					currentValue
					status
					zone
					purpose
				}
			}
		}
	}
}
`.trim(),
		variables: {
			projectId,
			environmentId,
			serviceId,
		},
		env,
		fetchImpl,
	});
	return Array.isArray(payload.data?.domains?.customDomains)
		? payload.data.domains.customDomains
			.map((entry) => entry && typeof entry === 'object' ? normalizeRailwayCustomDomain(entry as Record<string, unknown>) : null)
			.filter(Boolean) as RailwayCustomDomainSummary[]
		: [];
}
