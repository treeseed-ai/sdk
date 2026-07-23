import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TreeseedReconcileAdapter, TreeseedReconcileAdapterInput, TreeseedUnitVerificationCheck } from ".././contracts.ts";
import { localComposeDriftReasons, localComposeReconciledSpecHash, localComposeRequiredPathWarnings, localComposeServiceReady, observeLocalComposeRequiredPaths, parseLocalComposeServices, waitForLocalComposeServices } from ".././local-compose-state.ts";
import { desiredUnitSpecHash } from ".././state.ts";
import { inspectDockerAvailability, runDockerCompose } from ".././providers/docker-private.ts";
import { buildLocalComposeLaunchEnv, checkHttpHealthWithRetry, localComposeBuildPolicy, runLocalComposePrepareCommand } from './local-compose-build-policy.ts';
import { genericObservedState, genericResult, noopDiff } from './to-deploy-target.ts';
import { verificationCheck } from './first-railway-domain-string.ts';
import { summarizeVerification } from './summarize-verification.ts';

export function buildLocalDockerComposeAdapter(): TreeseedReconcileAdapter {
	return {
		providerId: 'local',
		unitTypes: ['local-docker-compose'],
		supports(unitType, providerId) {
			return unitType === 'local-docker-compose' && providerId === 'local';
		},
		refresh(input) {
			const composeFiles = resolveLocalComposeFiles(input);
			const composeFilesExist = composeFiles.length > 0 && composeFiles.every((composeFile) => existsSync(composeFile));
			const cwd = resolve(input.context.tenantRoot, String(input.unit.spec.cwd ?? '.'));
			const docker = inspectDockerAvailability();
			const projectName = String(input.unit.spec.projectName ?? 'treeseed-capacity-provider');
			const env = buildLocalComposeLaunchEnv(input);
			const profiles = localComposeProfiles(input);
			const buildPolicy = localComposeBuildPolicy(input);
			const ps = composeFilesExist && docker.available
				? runDockerCompose({ composeFiles, projectName, cwd, env, profiles, buildPolicy, action: 'ps' })
				: null;
			const hasContainers = Boolean(ps?.ok && ps.stdout.trim());
			const config = composeFilesExist && docker.available
				? runDockerCompose({ composeFiles, projectName, cwd, env, profiles, buildPolicy, action: 'config' })
				: null;
			const missingComposeFiles = composeFiles.filter((composeFile) => !existsSync(composeFile));
			const requiredPaths = observeLocalComposeRequiredPaths(input.unit.spec.requiredHostPaths, input.context.tenantRoot);
			const requiredPathWarnings = localComposeRequiredPathWarnings(requiredPaths);
			const prerequisitesAvailable = Boolean(composeFilesExist && docker.available && requiredPathWarnings.length === 0);
			return {
				...genericObservedState(input, prerequisitesAvailable, [
					...(composeFiles.length > 0 ? [] : ['Compose file is missing: (unset)']),
					...missingComposeFiles.map((composeFile) => `Compose file is missing: ${composeFile}`),
					...requiredPathWarnings,
					...docker.warnings,
				]),
				status: prerequisitesAvailable ? (hasContainers ? 'ready' : 'pending') : 'error',
				live: {
					...input.unit.spec,
					composeFile: composeFiles[0] ?? null,
					composeFiles,
					projectName,
					cwd,
					profiles,
					buildPolicy,
					docker,
					ps,
					hasContainers,
					configHash: config?.stdout?.trim() || null,
					requiredPaths,
				},
			};
		},
		diff(input) {
			if (!input.observed.exists) return { action: 'blocked', reasons: input.observed.warnings, before: input.observed.live, after: input.unit.spec };
			if (input.unit.spec.resetData === true) {
				return { action: 'update', reasons: ['disposable compose data reset requested'], before: input.observed.live, after: input.unit.spec };
			}
			if (input.unit.spec.forceRecreate === true) {
				return { action: 'update', reasons: ['compose force recreate requested'], before: input.observed.live, after: input.unit.spec };
			}
			const driftReasons = localComposeDriftReasons({
				persistedState: input.persistedState,
				desiredSpecHash: desiredUnitSpecHash(input.unit),
				reconciledSpecHash: localComposeReconciledSpecHash(input.unit.spec),
				configHash: input.observed.live.configHash,
				requiredPaths: Array.isArray(input.observed.live.requiredPaths) ? input.observed.live.requiredPaths as ReturnType<typeof observeLocalComposeRequiredPaths> : [],
			});
			if (driftReasons.length > 0) {
				return { action: 'update', reasons: driftReasons, before: input.observed.live, after: input.unit.spec };
			}
			return input.observed.status === 'ready'
				? noopDiff()
				: { action: 'create', reasons: ['compose services are not running'], before: input.observed.live, after: input.unit.spec };
		},
		apply(input) {
			if (input.diff.action === 'blocked' || input.diff.action === 'noop') return genericResult(input);
			runLocalComposePrepareCommand(input);
			const composeFiles = observedOrResolvedComposeFiles(input);
			const cwd = String(input.observed.live.cwd ?? input.context.tenantRoot);
			const projectName = String(input.unit.spec.projectName ?? 'treeseed-capacity-provider');
			const env = buildLocalComposeLaunchEnv(input);
			const reset = input.unit.spec.resetData === true
				? runDockerCompose({
						composeFiles,
						projectName,
						cwd,
						env,
						profiles: localComposeProfiles(input),
						buildPolicy: localComposeBuildPolicy(input),
						removeVolumes: true,
						action: 'down',
					})
				: null;
			if (reset && !reset.ok) {
				throw new Error(reset.stderr.trim() || reset.stdout.trim() || 'docker compose data reset failed');
			}
			if (reset) resetLocalComposeDataDir(input);
			ensureLocalComposeDataDir(input);
			const result = runDockerCompose({
				composeFiles,
				projectName,
				cwd,
				env,
				profiles: localComposeProfiles(input),
				buildPolicy: localComposeBuildPolicy(input),
				action: input.diff.action === 'update' ? 'restart' : 'up',
			});
			if (!result.ok) {
				throw new Error(result.stderr.trim() || result.stdout.trim() || 'docker compose up failed');
			}
			return genericResult(input, {
				...input.observed.live,
				reconciledSpecHash: localComposeReconciledSpecHash(input.unit.spec),
				reset,
				compose: result,
			});
		},
		async verify(input) {
			const healthChecks = Array.isArray(input.unit.spec.healthChecks) ? input.unit.spec.healthChecks as Array<Record<string, unknown>> : [];
			const checks: TreeseedUnitVerificationCheck[] = [];
			const requiredPaths = Array.isArray(input.observed.live.requiredPaths)
				? input.observed.live.requiredPaths as ReturnType<typeof observeLocalComposeRequiredPaths>
				: [];
			for (const requiredPath of requiredPaths) {
				checks.push(verificationCheck(`host-path:${requiredPath.path}`, requiredPath.description, 'sdk', {
					exists: requiredPath.exists,
					configured: true,
					ready: requiredPath.valid,
					verified: requiredPath.valid,
					expected: requiredPath.kind,
					observed: requiredPath,
					issues: requiredPath.valid ? [] : [`Required ${requiredPath.kind} is unavailable: ${requiredPath.path}`],
				}));
			}
			const declaredServices = new Set([
				...(Array.isArray(input.unit.spec.services) ? input.unit.spec.services.filter((entry): entry is string => typeof entry === 'string') : []),
				...healthChecks.flatMap((entry) => entry.kind === 'container' && typeof entry.service === 'string' ? [entry.service] : []),
			]);
			const initialPs = input.observed.live.ps && typeof input.observed.live.ps === 'object'
				? input.observed.live.ps as Record<string, unknown>
				: {};
			let firstObservation = true;
			const serviceWait = await waitForLocalComposeServices({
				serviceNames: [...declaredServices],
				attempts: typeof input.unit.spec.serviceHealthAttempts === 'number' ? input.unit.spec.serviceHealthAttempts : undefined,
				intervalMs: typeof input.unit.spec.serviceHealthIntervalMs === 'number' ? input.unit.spec.serviceHealthIntervalMs : undefined,
				observe: () => {
					if (firstObservation) {
						firstObservation = false;
						return parseLocalComposeServices(initialPs.stdout);
					}
					const ps = runDockerCompose({
						composeFiles: observedOrResolvedComposeFiles(input),
						projectName: String(input.unit.spec.projectName ?? 'treeseed-capacity-provider'),
						cwd: String(input.observed.live.cwd ?? input.context.tenantRoot),
						env: buildLocalComposeLaunchEnv(input),
						profiles: localComposeProfiles(input),
						buildPolicy: localComposeBuildPolicy(input),
						action: 'ps',
					});
					return parseLocalComposeServices(ps.stdout);
				},
			});
			const services = serviceWait.observations;
			for (const service of declaredServices) {
				const observation = services.find((entry) => entry.service === service);
				const ready = localComposeServiceReady(observation);
				checks.push(verificationCheck(`compose-service:${service}`, `Docker Compose service ${service} is running and healthy`, 'cli', {
					exists: Boolean(observation),
					configured: true,
					ready,
					verified: ready,
					observed: observation ? { ...observation, verificationAttempts: serviceWait.attempts } : { verificationAttempts: serviceWait.attempts },
					issues: ready ? [] : [`Docker Compose service ${service} is missing, stopped, starting, or unhealthy.`],
				}));
			}
			for (const healthCheck of healthChecks) {
				if (healthCheck.kind === 'http' && typeof healthCheck.url === 'string') {
					const attempts = typeof healthCheck.attempts === 'number' && Number.isFinite(healthCheck.attempts)
						? Math.max(1, Math.floor(healthCheck.attempts))
						: undefined;
					const intervalMs = typeof healthCheck.intervalMs === 'number' && Number.isFinite(healthCheck.intervalMs)
						? Math.max(100, Math.floor(healthCheck.intervalMs))
						: undefined;
					const health = await checkHttpHealthWithRetry(healthCheck.url, attempts, intervalMs);
					checks.push(verificationCheck(String(healthCheck.id ?? healthCheck.url), `HTTP health ${healthCheck.url}`, 'api', {
						exists: health.ok,
						configured: true,
						ready: health.ok,
						verified: health.ok,
						observed: health,
						issues: health.ok ? [] : [`Health endpoint ${healthCheck.url} did not respond successfully.`],
					}));
				}
			}
			if (checks.length === 0) {
				checks.push(verificationCheck('compose', 'Docker Compose project is observable', 'cli', {
					exists: input.observed.exists,
					configured: input.observed.exists,
					ready: input.observed.status === 'ready',
					verified: input.observed.exists && input.observed.status !== 'error',
					observed: input.observed.live,
				}));
			}
			return summarizeVerification(input.unit.unitId, checks, input.observed.warnings);
		},
		destroy(input) {
			const composeFiles = observedOrResolvedComposeFiles(input);
			const cwd = String(input.observed.live.cwd ?? input.context.tenantRoot);
			const projectName = String(input.unit.spec.projectName ?? 'treeseed-capacity-provider');
			if (input.context.planOnly !== true && composeFiles.length > 0 && composeFiles.every((composeFile) => existsSync(composeFile))) {
				const result = runDockerCompose({
					composeFiles,
					projectName,
					cwd,
					env: buildLocalComposeLaunchEnv(input),
					profiles: localComposeProfiles(input),
					buildPolicy: localComposeBuildPolicy(input),
					action: 'down',
				});
				if (!result.ok) {
					throw new Error(result.stderr.trim() || result.stdout.trim() || 'docker compose down failed');
				}
			}
			return genericResult({
				...input,
				diff: { action: 'delete', reasons: ['selected local compose project for destroy'], before: input.observed.live, after: {} },
			});
		},
	};
}

export function ensureLocalComposeDataDir(input: TreeseedReconcileAdapterInput) {
	const dataDir = typeof input.unit.spec.dataDir === 'string' ? input.unit.spec.dataDir.trim() : '';
	if (!dataDir) return;
	mkdirSync(resolve(input.context.tenantRoot, dataDir), { recursive: true });
}

export function resetLocalComposeDataDir(input: TreeseedReconcileAdapterInput) {
	const dataDir = typeof input.unit.spec.dataDir === 'string' ? input.unit.spec.dataDir.trim() : '';
	if (!dataDir) return;
	const tenantRoot = resolve(input.context.tenantRoot);
	const target = resolve(tenantRoot, dataDir);
	if (target === tenantRoot || !target.startsWith(`${tenantRoot}/`)) {
		throw new Error(`Refusing to reset local Compose data outside the tenant root: ${target}`);
	}
	rmSync(target, { recursive: true, force: true });
}

export function resolveLocalComposeFiles(input: TreeseedReconcileAdapterInput) {
	const rawComposeFiles = Array.isArray(input.unit.spec.composeFiles)
		? input.unit.spec.composeFiles
		: typeof input.unit.spec.composeFile === 'string'
			? [input.unit.spec.composeFile]
			: [];
	return rawComposeFiles
		.filter((composeFile): composeFile is string => typeof composeFile === 'string' && composeFile.trim().length > 0)
		.map((composeFile) => resolve(input.context.tenantRoot, composeFile));
}

export function observedOrResolvedComposeFiles(input: TreeseedReconcileAdapterInput) {
	const observed = input.observed.live.composeFiles;
	if (Array.isArray(observed)) {
		return observed.filter((composeFile): composeFile is string => typeof composeFile === 'string' && composeFile.trim().length > 0);
	}
	return resolveLocalComposeFiles(input);
}

export function localComposeProfiles(input: TreeseedReconcileAdapterInput) {
	return Array.isArray(input.unit.spec.profiles)
		? input.unit.spec.profiles.filter((profile): profile is string => typeof profile === 'string' && profile.trim().length > 0)
		: [];
}
