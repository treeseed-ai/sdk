import { inspectRailwayServiceDeploymentHealth, listRailwayVolumes, listRailwayVariables } from "../../../operations/services/hosting/railway/railway-api.ts";
import type { ReconcileAdapterInput, UnitVerificationCheck, UnitVerificationResult } from "../../support/contracts/contracts.ts";
import { findRailwayTopologyEntry, railwayStartCommandMatches, railwayUnitServiceIdentity, railwayVerificationMaySettle, resolveRailwayUnitTopology } from './railway-verification-may-settle.ts';
import { summarizeVerification } from '../support/summarize-verification.ts';
import { verificationCheck } from './first-railway-domain-string.ts';
import { collectRailwayEnvironmentSync } from './observe-railway-unit.ts';
import { isTransientRailwayReconcileError, sleepMs } from './to-deploy-target.ts';
import { railwayServiceRootDirectory } from './build-cloudflare-diff.ts';
import { railwayProviderDrift } from './resolve-railway-topology-for-scope.ts';

export async function verifyRailwayUnit(input: ReconcileAdapterInput): Promise<UnitVerificationResult> {
	let attempt = 0;
	for (;;) {
		try {
			const scope = input.context.target.kind === 'persistent' ? input.context.target.scope : 'staging';
			const serviceKey = String(input.unit.metadata.serviceKey ?? '').trim();
			const topology = await resolveRailwayUnitTopology(input, scope, {
				includeInstances: true,
				includeVariables: true,
				refresh: true,
				cacheSuffix: 'verify',
			});
			const entry = findRailwayTopologyEntry(topology, railwayUnitServiceIdentity(input));
			const service = entry?.configuredService ?? null;
			if (!service || !entry) {
				return summarizeVerification(input.unit.unitId, [
					verificationCheck('railway.service', 'Railway service exists in the desired topology', 'sdk', {
						exists: false,
						issues: [`Railway service ${serviceKey} is not configured for ${scope}.`],
					}),
				]);
			}
			const sync = collectRailwayEnvironmentSync(input).forService(serviceKey, service);
			let currentVariables = entry.currentVariables;
			if (entry.project?.id && entry.environment?.id && entry.service?.id) {
				for (let variableAttempt = 0; variableAttempt < 6; variableAttempt += 1) {
					currentVariables = await listRailwayVariables({
						projectId: entry.project.id,
						environmentId: entry.environment.id,
						serviceId: entry.service.id,
						env: topology.env,
					}).catch(() => entry.currentVariables);
					const expectedVariablesMatch = Object.entries(sync.variables)
						.every(([key, value]) => currentVariables[key] === value);
					const expectedSecretsExist = Object.keys(sync.secrets)
						.every((key) => Object.hasOwn(currentVariables, key));
					if (expectedVariablesMatch && expectedSecretsExist) {
						break;
					}
					sleepMs(1000);
				}
			}
			const checks: UnitVerificationCheck[] = [
		verificationCheck('railway.workspace', 'Railway workspace is resolved', 'api', {
			exists: Boolean(topology.workspace.id),
			expected: topology.workspace.name,
			observed: topology.workspace.name,
			issues: topology.workspace.id ? [] : ['Railway workspace could not be resolved.'],
		}),
		verificationCheck('railway.project', 'Railway project exists', 'api', {
			exists: Boolean(entry.project),
			expected: service.projectName ?? service.projectId ?? null,
			observed: entry.project?.name ?? entry.project?.id ?? null,
			issues: entry.project ? [] : [`Railway project ${service.projectName ?? service.projectId ?? '(unset)'} was not found in workspace ${topology.workspace.name}.`],
		}),
		verificationCheck('railway.service', 'Railway service exists', 'api', {
			exists: Boolean(entry.service),
			expected: service.serviceName ?? service.serviceId ?? null,
			observed: entry.service?.name ?? entry.service?.id ?? null,
			issues: entry.service ? [] : [`Railway service ${service.serviceName ?? service.serviceId ?? '(unset)'} was not found.`],
		}),
		verificationCheck('railway.environment', 'Railway environment exists', 'api', {
			exists: Boolean(entry.environment),
			expected: service.railwayEnvironment,
			observed: entry.environment?.name ?? null,
			issues: entry.environment ? [] : [`Railway environment ${service.railwayEnvironment} was not found.`],
		}),
		verificationCheck('railway.instance', 'Railway service instance exists', 'api', {
			exists: Boolean(entry.instance?.id),
			expected: true,
			observed: entry.instance?.id ?? null,
			issues: entry.instance?.id ? [] : [`Railway service instance for ${service.serviceName ?? service.key} in ${service.railwayEnvironment} is missing.`],
		}),
	];
	if (service.sourceMode === 'image') {
		const hasImageRef = typeof service.imageRef === 'string' && service.imageRef.trim().length > 0;
		checks.push(verificationCheck('railway.instance.image-ref', 'Railway image source has an immutable image reference', 'sdk', {
			exists: hasImageRef,
			configured: hasImageRef,
			expected: service.imageRefEnv ? `${service.imageRefEnv}=<image>:<tag>` : '<image>:<tag>',
			observed: service.imageRef ?? null,
			issues: hasImageRef ? [] : [`Railway production service ${service.serviceName ?? service.key} is configured for image deployment but no image reference was resolved.`],
		}));
	}
	if (service.startCommand) {
		const startCommandMatches = railwayStartCommandMatches(serviceKey, entry.instance?.startCommand, service.startCommand);
		checks.push(verificationCheck('railway.instance.start-command', 'Railway start command matches desired config', 'api', {
			exists: Boolean(entry.instance?.id),
			configured: startCommandMatches,
			expected: service.startCommand,
			observed: entry.instance?.startCommand ?? null,
			issues: startCommandMatches ? [] : ['Railway start command does not match the desired value.'],
		}));
	}
	const desiredRootDirectory = service.imageRef || service.sourceMode === 'image' ? null : railwayServiceRootDirectory(input.context.tenantRoot, service);
	const normalizeRailwayRootDirectory = (value: string | null | undefined) => {
		const trimmed = String(value ?? '').trim();
		return trimmed || '.';
	};
	if (desiredRootDirectory) {
		const observedRootDirectory = normalizeRailwayRootDirectory(entry.instance?.rootDirectory);
		const desiredNormalizedRootDirectory = normalizeRailwayRootDirectory(desiredRootDirectory);
		checks.push(verificationCheck('railway.instance.root-directory', 'Railway root directory matches desired config', 'api', {
			exists: Boolean(entry.instance?.id),
			configured: observedRootDirectory === desiredNormalizedRootDirectory,
			expected: desiredRootDirectory,
			observed: entry.instance?.rootDirectory ?? null,
			issues: observedRootDirectory === desiredNormalizedRootDirectory ? [] : ['Railway root directory does not match the desired value.'],
		}));
	}
	if (service.sourceMode === 'git' && entry.service?.id && entry.environment?.id) {
		const deployment = await inspectRailwayServiceDeploymentHealth({
			serviceId: entry.service.id,
			environmentId: entry.environment.id,
			env: topology.env,
		}).catch((error) => ({
			ok: false,
			repo: null,
			branch: null,
			rootDirectory: null,
			message: error instanceof Error ? error.message : String(error),
		}));
		const repoMatches = service.sourceRepo ? deployment.repo === service.sourceRepo : true;
		const branchMatches = service.sourceBranch ? deployment.branch === service.sourceBranch : true;
		const rootMatches = desiredRootDirectory
			? normalizeRailwayRootDirectory(deployment.rootDirectory) === normalizeRailwayRootDirectory(desiredRootDirectory)
			: true;
		const deploymentIssues = [
			repoMatches ? null : `Expected Railway Git deployment repo ${service.sourceRepo}, observed ${deployment.repo ?? '(unset)'}.`,
			branchMatches ? null : `Expected Railway Git deployment branch ${service.sourceBranch}, observed ${deployment.branch ?? '(unset)'}.`,
			rootMatches ? null : `Expected Railway deployment root ${desiredRootDirectory}, observed ${deployment.rootDirectory ?? '(unset)'}.`,
			deployment.repo || deployment.branch ? null : 'Railway latest deployment does not expose a Git repository/branch; staging may still be using a Docker image source.',
		].filter((issue): issue is string => Boolean(issue));
		checks.push(verificationCheck('railway.service.source-mode', 'Railway staging service deploys from Git source', 'api', {
			exists: Boolean(entry.service?.id),
			configured: deploymentIssues.length === 0,
			ready: deploymentIssues.length === 0,
			verified: deploymentIssues.length === 0,
			expected: { sourceMode: 'git', repo: service.sourceRepo ?? null, branch: service.sourceBranch ?? null, rootDirectory: desiredRootDirectory ?? null },
			observed: { repo: deployment.repo, branch: deployment.branch, rootDirectory: deployment.rootDirectory, message: deployment.message ?? null },
			issues: deploymentIssues,
		}));
	}
	if (service.key === 'api') {
		const wantsRuntimeConfig = Boolean(
			service.healthcheckPath
			|| service.healthcheckIntervalSeconds !== null && service.healthcheckIntervalSeconds !== undefined
			|| service.healthcheckTimeoutSeconds !== null && service.healthcheckTimeoutSeconds !== undefined
			|| service.restartPolicy
			|| service.runtimeMode,
		);
		const runtimeConfigObservable = entry.instance?.runtimeConfigSupported === true;
		if (wantsRuntimeConfig && !runtimeConfigObservable) {
			checks.push(verificationCheck('railway.instance.runtime-config-observable', 'Railway API runtime settings are observable through the provider schema', 'api', {
				exists: Boolean(entry.instance?.id),
				configured: true,
				ready: true,
				verified: true,
				expected: 'runtime config fields observable or covered by live health verification',
				observed: 'runtime config fields unavailable in current Railway API schema',
				issues: [],
			}));
		}
		if (runtimeConfigObservable && service.healthcheckPath) {
			checks.push(verificationCheck('railway.instance.healthcheck-path', 'Railway API healthcheck path matches desired config', 'api', {
				exists: Boolean(entry.instance?.id),
				configured: entry.instance?.healthcheckPath === service.healthcheckPath,
				expected: service.healthcheckPath,
				observed: entry.instance?.healthcheckPath ?? null,
				issues: entry.instance?.healthcheckPath === service.healthcheckPath ? [] : ['Railway API healthcheck path does not match the desired value.'],
			}));
		}
		if (runtimeConfigObservable && service.healthcheckTimeoutSeconds !== null && service.healthcheckTimeoutSeconds !== undefined) {
			checks.push(verificationCheck('railway.instance.healthcheck-timeout', 'Railway API healthcheck timeout matches desired config', 'api', {
				exists: Boolean(entry.instance?.id),
				configured: entry.instance?.healthcheckTimeoutSeconds === service.healthcheckTimeoutSeconds,
				expected: service.healthcheckTimeoutSeconds,
				observed: entry.instance?.healthcheckTimeoutSeconds ?? null,
				issues: entry.instance?.healthcheckTimeoutSeconds === service.healthcheckTimeoutSeconds ? [] : ['Railway API healthcheck timeout does not match the desired value.'],
			}));
		}
		if (runtimeConfigObservable && service.healthcheckIntervalSeconds !== null && service.healthcheckIntervalSeconds !== undefined) {
			checks.push(verificationCheck('railway.instance.healthcheck-interval', 'Railway API healthcheck interval matches desired config', 'api', {
				exists: Boolean(entry.instance?.id),
				configured: entry.instance?.healthcheckIntervalSeconds === service.healthcheckIntervalSeconds,
				expected: service.healthcheckIntervalSeconds,
				observed: entry.instance?.healthcheckIntervalSeconds ?? null,
				issues: entry.instance?.healthcheckIntervalSeconds === service.healthcheckIntervalSeconds ? [] : ['Railway API healthcheck interval does not match the desired value.'],
			}));
		}
		if (runtimeConfigObservable && service.restartPolicy) {
			checks.push(verificationCheck('railway.instance.restart-policy', 'Railway API restart policy matches desired config', 'api', {
				exists: Boolean(entry.instance?.id),
				configured: entry.instance?.restartPolicy === service.restartPolicy,
				expected: service.restartPolicy,
				observed: entry.instance?.restartPolicy ?? null,
				issues: entry.instance?.restartPolicy === service.restartPolicy ? [] : ['Railway API restart policy does not match the desired value.'],
			}));
		}
		if (runtimeConfigObservable && service.runtimeMode) {
			checks.push(verificationCheck('railway.instance.runtime-mode', 'Railway API runtime mode matches desired config', 'api', {
				exists: Boolean(entry.instance?.id),
				configured: entry.instance?.runtimeMode === service.runtimeMode,
				expected: service.runtimeMode,
				observed: entry.instance?.runtimeMode ?? null,
				issues: entry.instance?.runtimeMode === service.runtimeMode ? [] : ['Railway API runtime mode does not match the desired value.'],
			}));
		}
	}
	if (service.volumeMountPath) {
		const volumes = entry.project?.id
			? await listRailwayVolumes({ projectId: entry.project.id, env: topology.env })
			: [];
		const expectedServiceId = entry.service?.id ?? null;
		const expectedEnvironmentId = entry.environment?.id ?? null;
		const mountedVolumes = volumes.filter((volume) => volume.instances.some((instance) =>
			instance.serviceId === expectedServiceId
			&& instance.environmentId === expectedEnvironmentId
			&& instance.mountPath === service.volumeMountPath
			&& !instance.isPendingDeletion
			&& !(typeof instance.deletedAt === 'string' && instance.deletedAt.trim())
			&& !['DELETING', 'DELETED'].includes(String(instance.state ?? '').toUpperCase()),
		));
		const expectedVolumeName = `${service.serviceName}-volume`;
		const mountedVolume = mountedVolumes.find((volume) => volume.name === expectedVolumeName) ?? null;
		const volumeIssues = [
			mountedVolume ? null : `Railway service ${service.serviceName ?? service.key} is not mounted to canonical volume ${expectedVolumeName} at ${service.volumeMountPath}.`,
			mountedVolumes.length === 1 ? null : `Railway service ${service.serviceName ?? service.key} has ${mountedVolumes.length} active volumes mounted at ${service.volumeMountPath}; expected exactly one.`,
		].filter((issue): issue is string => Boolean(issue));
		checks.push(verificationCheck('railway.volume:data', 'Railway service has persistent data volume mounted', 'api', {
			exists: mountedVolumes.length > 0,
			configured: volumeIssues.length === 0,
			ready: volumeIssues.length === 0,
			verified: volumeIssues.length === 0,
			expected: { name: expectedVolumeName, mountPath: service.volumeMountPath, count: 1 },
			observed: mountedVolume
				? {
					name: mountedVolume.name,
					mountPath: service.volumeMountPath,
					count: mountedVolumes.length,
					source: 'api',
				}
				: mountedVolumes.map((volume) => ({ name: volume.name, mountPath: service.volumeMountPath })),
			issues: volumeIssues,
		}));
	}
	for (const [key, value] of Object.entries(sync.variables)) {
		const matches = currentVariables[key] === value;
		checks.push(verificationCheck(`railway.var:${key}`, `Railway variable ${key} exists with the expected value`, 'api', {
			exists: Object.hasOwn(currentVariables, key),
			configured: matches,
			ready: matches,
			verified: matches,
			expected: value,
			observed: currentVariables[key] ?? null,
			issues: matches ? [] : [`Railway variable ${key} does not match the expected value.`],
		}));
	}
	for (const key of Object.keys(sync.secrets)) {
		const exists = Object.hasOwn(currentVariables, key);
		checks.push(verificationCheck(`railway.secret:${key}`, `Railway secret ${key} exists`, 'api', {
			exists,
			configured: exists,
			ready: exists,
			verified: exists,
			expected: true,
			observed: exists,
			issues: exists ? [] : [`Railway secret ${key} is missing.`],
		}));
	}
			const providerDriftWarnings = railwayProviderDrift(input, scope).map((drift) =>
				`Railway provider drift remains unresolved: ${String(drift.reason ?? drift.kind ?? 'unknown drift')}`,
			);
			const verification = summarizeVerification(input.unit.unitId, checks, providerDriftWarnings);
			if (!verification.verified && attempt < 12 && railwayVerificationMaySettle(verification)) {
				attempt += 1;
				sleepMs(5_000);
				continue;
			}
			return verification;
		} catch (error) {
			if (attempt >= 2 || !isTransientRailwayReconcileError(error)) {
				throw error;
			}
			attempt += 1;
			sleepMs(1000 * attempt);
		}
	}
}
