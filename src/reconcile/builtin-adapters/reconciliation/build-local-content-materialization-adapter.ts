import { existsSync } from 'node:fs';
import type { ReconcileAdapter } from "../../support/contracts/contracts.ts";
import { runManagedDevAction } from "../../providers/local-private.ts";
import { runRepositoryGit } from "../../../operations/services/operations/git-runner.ts";
import { expectedLocalContentOrigin, localContentGitEnvironment, localContentObservedState, localContentSpecRecord, localContentSpecString, originMatches, runLocalContentClone } from '../build/local-compose-build-policy.ts';
import { genericObservedState, genericResult, noopDiff, nowIso } from '../hosting/to-deploy-target.ts';
import { verificationCheck } from '../hosting/first-railway-domain-string.ts';
import { summarizeVerification } from '../support/summarize-verification.ts';

export function buildLocalContentMaterializationAdapter(): ReconcileAdapter {
	return {
		providerId: 'local',
		unitTypes: ['local-content-materialization'],
		supports(unitType, providerId) {
			return unitType === 'local-content-materialization' && providerId === 'local';
		},
		refresh(input) {
			return localContentObservedState(input);
		},
		diff(input) {
			const materialization = localContentSpecString(input, 'localContentMaterialization') ?? 'none';
			const executeRequested = input.unit.spec.executeRequested === true;
			const expectedOrigin = expectedLocalContentOrigin(input);
			if (input.observed.status === 'error') {
				return { action: 'blocked', reasons: input.observed.warnings, before: input.observed.live, after: input.unit.spec };
			}
			if (materialization === 'existing_path' && !input.observed.exists) {
				return { action: 'blocked', reasons: ['existing local content path is missing; choose preview/edit with managed_clone or configure the path'], before: input.observed.live, after: input.unit.spec };
			}
			if (input.observed.exists && !originMatches(input.observed, expectedOrigin)) {
				return { action: 'blocked', reasons: ['managed local content origin does not match the configured content repository'], before: input.observed.live, after: input.unit.spec };
			}
			if (!executeRequested) {
				return noopDiff();
			}
			if (!input.observed.exists && (materialization === 'managed_clone' || materialization === 'submodule')) {
				return { action: 'create', reasons: [`${materialization} local content is requested but missing`], before: input.observed.live, after: input.unit.spec };
			}
			if (input.observed.exists && materialization === 'managed_clone') {
				return { action: 'update', reasons: ['managed local content exists; fetch without resetting local work'], before: input.observed.live, after: input.unit.spec };
			}
			return noopDiff();
		},
		apply(input) {
			if (input.diff.action === 'noop' || input.diff.action === 'blocked') return genericResult(input);
			const materialization = localContentSpecString(input, 'localContentMaterialization') ?? 'none';
			const targetPath = localContentSpecString(input, 'effectiveLocalPath');
			const expectedOrigin = expectedLocalContentOrigin(input);
			const repo = localContentSpecRecord(input, 'contentRepository');
			const branch = typeof repo.defaultBranch === 'string' ? repo.defaultBranch : null;
			if (!targetPath) return genericResult(input);
			if (materialization === 'submodule') {
				const submodulePath = typeof repo.submodulePath === 'string' ? repo.submodulePath : localContentSpecString(input, 'contentPath');
				if (!submodulePath) return genericResult(input);
				const { env } = localContentGitEnvironment(input);
				const submodule = runRepositoryGit(['submodule', 'update', '--init', '--', submodulePath], {
					cwd: input.context.tenantRoot,
					mode: 'mutate',
					env,
					timeoutMs: 120_000,
					maxBuffer: 1024 * 1024 * 16,
				});
				return genericResult(input, { ...input.observed.live, submodule: { status: submodule.status } });
			}
			if (materialization === 'managed_clone' && expectedOrigin) {
				const result = input.observed.exists
					? runRepositoryGit(['fetch', 'origin'], {
							cwd: targetPath,
							mode: 'mutate',
							env: localContentGitEnvironment(input).env,
							timeoutMs: 120_000,
							maxBuffer: 1024 * 1024 * 16,
						})
					: runLocalContentClone(input, targetPath, expectedOrigin, branch);
				return genericResult(input, {
					...input.observed.live,
					materializedAt: nowIso(),
					gitOperation: {
						status: result.status,
						tool: 'tool' in result ? result.tool : 'git',
						credentialEnvName: 'credentialEnvName' in result ? result.credentialEnvName : null,
						fallbackUsed: 'fallbackUsed' in result ? result.fallbackUsed : false,
					},
				});
			}
			return genericResult(input);
		},
		verify(input) {
			const targetPath = localContentSpecString(input, 'effectiveLocalPath');
			const materialization = localContentSpecString(input, 'localContentMaterialization') ?? 'none';
			const exists = !targetPath || existsSync(targetPath);
			const expectedOrigin = expectedLocalContentOrigin(input);
			const originOk = originMatches(input.observed, expectedOrigin);
			const checks = [
				verificationCheck('local-content.path', 'Local content path policy is satisfied', 'sdk', {
					exists: materialization === 'none' ? true : exists,
					configured: true,
					ready: materialization === 'none' || exists,
					verified: materialization === 'none' || exists,
					observed: targetPath,
					issues: materialization !== 'none' && !exists ? ['Local content path is missing.'] : [],
				}),
				verificationCheck('local-content.origin', 'Local content origin matches the configured repository when observable', 'sdk', {
					exists: true,
					configured: originOk,
					ready: originOk,
					verified: originOk,
					expected: expectedOrigin,
					observed: input.observed.live.git,
					issues: originOk ? [] : ['Origin does not match configured content repository.'],
				}),
			];
			return summarizeVerification(input.unit.unitId, checks, input.observed.warnings);
		},
	};
}

export function buildLocalProcessAdapter(): ReconcileAdapter {
	return {
		providerId: 'local',
		unitTypes: ['local-process'],
		supports(unitType, providerId) {
			return unitType === 'local-process' && providerId === 'local';
		},
		async refresh(input) {
			const surfaces = Array.isArray(input.unit.spec.surfaces)
				? input.unit.spec.surfaces.filter((entry): entry is string => typeof entry === 'string')
				: [String(input.unit.spec.processId ?? input.unit.logicalName)];
			const status = await runManagedDevAction({
				tenantRoot: input.context.tenantRoot,
				action: 'status',
				surfaces,
				options: typeof input.unit.spec.options === 'object' && input.unit.spec.options ? input.unit.spec.options as Record<string, unknown> : {},
				env: input.context.launchEnv,
			});
			const safeStatus = sanitizeManagedDevObservation(status);
			const instances = Array.isArray(safeStatus.parsed?.instances)
				? safeStatus.parsed.instances
				: [];
			const sourceClosureDrift = instances.some((instance) => (
				instance
				&& typeof instance === 'object'
				&& 'sourceClosureMatches' in instance
				&& instance.sourceClosureMatches === false
			));
			return {
				...genericObservedState(input, true, safeStatus.ok ? [] : [safeStatus.output || 'managed dev status failed']),
				status: sourceClosureDrift ? 'drifted' : safeStatus.ok ? 'ready' : 'pending',
				live: {
					...input.unit.spec,
					status: safeStatus,
					sourceClosureDrift,
				},
			};
		},
		diff(input) {
			if (input.unit.spec.action === 'restart') {
				return { action: 'update', reasons: ['local process restart requested'], before: input.observed.live, after: input.unit.spec };
			}
			if (input.observed.live.sourceClosureDrift === true) {
				return { action: 'update', reasons: ['local process source closure changed'], before: input.observed.live, after: input.unit.spec };
			}
			return input.observed.status === 'ready'
				? noopDiff()
				: { action: 'create', reasons: ['local process is not reported ready'], before: input.observed.live, after: input.unit.spec };
		},
		async apply(input) {
			if (input.diff.action === 'noop') return genericResult(input);
			const surfaces = Array.isArray(input.unit.spec.surfaces)
				? input.unit.spec.surfaces.filter((entry): entry is string => typeof entry === 'string')
				: [String(input.unit.spec.processId ?? input.unit.logicalName)];
			const result = await runManagedDevAction({
				tenantRoot: input.context.tenantRoot,
				action: input.unit.spec.action === 'restart' || input.diff.action === 'update' ? 'restart' : 'start',
				surfaces,
				options: typeof input.unit.spec.options === 'object' && input.unit.spec.options ? input.unit.spec.options as Record<string, unknown> : {},
				env: input.context.launchEnv,
			});
			return genericResult(input, { ...input.observed.live, managedDev: result });
		},
		async verify(input) {
			const status = await runManagedDevAction({
				tenantRoot: input.context.tenantRoot,
				action: 'status',
				surfaces: Array.isArray(input.unit.spec.surfaces) ? input.unit.spec.surfaces.filter((entry): entry is string => typeof entry === 'string') : [],
				options: typeof input.unit.spec.options === 'object' && input.unit.spec.options ? input.unit.spec.options as Record<string, unknown> : {},
				env: input.context.launchEnv,
			});
			const safeStatus = sanitizeManagedDevObservation(status);
			return summarizeVerification(input.unit.unitId, [
				verificationCheck('managed-dev-status', 'Managed dev status is observable', 'sdk', {
					exists: safeStatus.ok,
					configured: true,
					ready: safeStatus.ok,
					verified: safeStatus.ok,
					observed: safeStatus.parsed ?? safeStatus.output,
					issues: safeStatus.ok ? [] : [safeStatus.output || 'managed dev status failed'],
				}),
			], input.observed.warnings);
		},
		async destroy(input) {
			const surfaces = Array.isArray(input.unit.spec.surfaces)
				? input.unit.spec.surfaces.filter((entry): entry is string => typeof entry === 'string')
				: [String(input.unit.spec.processId ?? input.unit.logicalName)];
			if (input.context.planOnly !== true) {
				await runManagedDevAction({
					tenantRoot: input.context.tenantRoot,
					action: 'stop',
					surfaces,
					options: typeof input.unit.spec.options === 'object' && input.unit.spec.options ? input.unit.spec.options as Record<string, unknown> : {},
					env: input.context.launchEnv,
				});
			}
			return genericResult({
				...input,
				diff: { action: 'delete', reasons: ['selected local process for stop'], before: input.observed.live, after: {} },
			});
		},
	};
}

export function sanitizeManagedDevObservation<T>(value: T): T {
	if (Array.isArray(value)) {
		return value.map((entry) => sanitizeManagedDevObservation(entry)) as T;
	}
	if (!value || typeof value !== 'object') {
		return value;
	}
	const result: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
		if (key === 'env') {
			result.redactedEnv = redactEnvironmentRecord(entry);
			continue;
		}
		result[key] = sanitizeManagedDevObservation(entry);
	}
	return result as T;
}

export function redactEnvironmentRecord(value: unknown) {
	if (!value || typeof value !== 'object') {
		return {};
	}
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
			key,
			key === 'PATH' || key === 'NODE_ENV' ? String(entry ?? '') : '<redacted>',
		]),
	);
}
