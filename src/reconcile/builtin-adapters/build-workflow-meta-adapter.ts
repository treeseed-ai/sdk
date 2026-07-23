import { resolveTreeseedMachineEnvironmentValues } from "../../operations/services/config-runtime.ts";
import { cloudflareApiRequest, listD1Databases, queueName, resolveConfiguredCloudflareAccountId, scopeFromTarget } from "../../operations/services/deploy.ts";
import type { TreeseedReconcileAdapter, TreeseedReconcileAdapterInput, TreeseedReconcileUnitType } from ".././contracts.ts";
import { runHostedReconcileGate, runHostedVerifyGate } from ".././providers/release-private.ts";
import { workflowFingerprint } from './build-release-gate-adapter.ts';
import { genericObservedState, genericResult, noopDiff, nowIso, sleepMs, toDeployTarget } from './to-deploy-target.ts';
import { summarizeVerification } from './summarize-verification.ts';
import { verificationCheck } from './first-railway-domain-string.ts';
import { listCloudflareQueuesViaApi } from './normalize-turnstile-domains.ts';

export function buildWorkflowMetaAdapter(): TreeseedReconcileAdapter {
	const unitTypes: TreeseedReconcileUnitType[] = [
		'branch-preview',
		'branch-preview-cleanup',
		'workflow-gate',
		'save-gate:local-verify',
		'save-gate:promotion-readiness',
		'save-gate:hosted-verify',
	];
	return {
		providerId: 'treeseed',
		unitTypes,
		supports(unitType, providerId) {
			return providerId === 'treeseed' && unitTypes.includes(unitType);
		},
		refresh(input) {
			const fingerprint = workflowFingerprint(input);
			const previousFingerprint = typeof input.persistedState?.lastReconciledState?.fingerprint === 'string'
				? input.persistedState.lastReconciledState.fingerprint
				: null;
			return {
				...genericObservedState(input),
				status: previousFingerprint === fingerprint ? 'ready' : 'pending',
				live: {
					...input.unit.spec,
					fingerprint,
					previousFingerprint,
				},
			};
		},
		diff(input) {
			return input.observed.status === 'ready'
				? noopDiff()
				: { action: input.unit.unitType === 'branch-preview-cleanup' ? 'delete' : 'update', reasons: [`${input.unit.unitType} fingerprint has not been reconciled`], before: input.observed.live, after: input.unit.spec };
		},
		async apply(input) {
			if (input.diff.action === 'noop') return genericResult(input);
			const fingerprint = workflowFingerprint(input);
			if (input.unit.unitType === 'branch-preview') {
				const selector = typeof input.unit.spec.resources === 'object' && input.unit.spec.resources
					? input.unit.spec.resources as any
					: { environment: 'staging', appId: [String(input.unit.spec.appId ?? 'web')] };
				const nested = await runHostedReconcileGate({
					parentContext: input.context,
					selector,
					target: input.context.target,
					planOnly: input.context.planOnly === true,
				});
				return genericResult(input, { ...input.observed.live, nested, fingerprint });
			}
			if (input.unit.unitType === 'save-gate:hosted-verify') {
				const selector = typeof input.unit.spec.selector === 'object' && input.unit.spec.selector
					? input.unit.spec.selector as any
					: { environment: input.context.target.kind === 'persistent' ? input.context.target.scope : 'staging' };
				const status = await runHostedVerifyGate({
					parentContext: input.context,
					selector,
					target: input.context.target,
				});
				if (!status.ready) {
					throw new Error(`Save hosted verification failed: ${status.blockers.join('\n')}`);
				}
				return genericResult(input, { ...input.observed.live, status, fingerprint });
			}
			return genericResult(input, { ...input.observed.live, fingerprint });
		},
		verify(input) {
			const fingerprint = workflowFingerprint(input);
			const observedFingerprint = typeof input.observed.live.fingerprint === 'string' ? input.observed.live.fingerprint : null;
			return summarizeVerification(input.unit.unitId, [
				verificationCheck('workflow-meta-fingerprint', `${input.unit.unitType} fingerprint is reconciled`, 'derived', {
					exists: true,
					configured: observedFingerprint === fingerprint,
					ready: observedFingerprint === fingerprint,
					verified: observedFingerprint === fingerprint,
					expected: fingerprint,
					observed: observedFingerprint,
					issues: observedFingerprint === fingerprint ? [] : [`Expected fingerprint ${fingerprint}, observed ${observedFingerprint ?? 'none'}.`],
				}),
			], input.observed.warnings);
		},
		destroy(input) {
			return genericResult({
				...input,
				diff: { action: 'delete', reasons: [`selected ${input.unit.unitType} for destroy`], before: input.observed.live, after: {} },
			}, { ...input.observed.live, destroyedAt: nowIso(), fingerprint: workflowFingerprint(input) });
		},
	};
}

export function providerCache<T>(input: TreeseedReconcileAdapterInput, key: string, loader: () => T, forceRefresh = false): T {
	if (forceRefresh) {
		input.context.session.delete(key);
	}
	if (input.context.session.has(key)) {
		return input.context.session.get(key) as T;
	}
	const value = loader();
	input.context.session.set(key, value);
	return value;
}

export function normalizeEnvironmentValues(env: NodeJS.ProcessEnv | Record<string, unknown> | undefined) {
	return Object.fromEntries(
		Object.entries(env ?? {})
			.filter((entry): entry is [string, string] => typeof entry[1] === 'string')
			.map(([key, value]) => [key, value]),
	);
}

export function resolveReconcileEnvironmentValues(
	input: TreeseedReconcileAdapterInput,
	scope: 'local' | 'staging' | 'prod',
) {
	if (scope === 'local') {
		return normalizeEnvironmentValues(resolveTreeseedMachineEnvironmentValues(input.context.tenantRoot, scope));
	}

	return {
		...normalizeEnvironmentValues(process.env),
		...normalizeEnvironmentValues(input.context.launchEnv),
	};
}

export function buildCloudflareEnv(input: TreeseedReconcileAdapterInput) {
	const scope = scopeFromTarget(toDeployTarget(input.context.target));
	const values = resolveReconcileEnvironmentValues(input, scope);
	let accountId = [
		values.TREESEED_CLOUDFLARE_ACCOUNT_ID,
		input.context.launchEnv.TREESEED_CLOUDFLARE_ACCOUNT_ID,
		process.env.TREESEED_CLOUDFLARE_ACCOUNT_ID,
		resolveConfiguredCloudflareAccountId(input.context.deployConfig),
	].find((value) => typeof value === 'string'
		&& value.trim().length > 0
		&& value.trim() !== 'replace-with-cloudflare-account-id')?.trim() ?? '';
	let token = [
		values.TREESEED_CLOUDFLARE_API_TOKEN,
		input.context.launchEnv.TREESEED_CLOUDFLARE_API_TOKEN,
		process.env.TREESEED_CLOUDFLARE_API_TOKEN,
	].find((value) => typeof value === 'string' && value.trim().length > 0)?.trim() ?? '';
	if (scope !== 'local' && (!accountId || !token)) {
		const configuredValues = normalizeEnvironmentValues(resolveTreeseedMachineEnvironmentValues(input.context.tenantRoot, scope));
		accountId = accountId || ([
			configuredValues.TREESEED_CLOUDFLARE_ACCOUNT_ID,
			resolveConfiguredCloudflareAccountId(input.context.deployConfig),
		].find((value) => typeof value === 'string'
			&& value.trim().length > 0
			&& value.trim() !== 'replace-with-cloudflare-account-id')?.trim() ?? '');
		token = token || (configuredValues.TREESEED_CLOUDFLARE_API_TOKEN ?? '');
	}
	return {
		CLOUDFLARE_ACCOUNT_ID: accountId,
		CLOUDFLARE_API_TOKEN: token,
	};
}

export function hasLiveResourceId(value: unknown) {
	return typeof value === 'string'
		&& value.length > 0
		&& !value.startsWith('plan-')
		&& !value.startsWith('local-')
		&& !value.endsWith('-id')
		&& !value.endsWith('-preview-id');
}

export function buildRailwayEnv(input: TreeseedReconcileAdapterInput, scope: 'local' | 'staging' | 'prod') {
	const values = resolveReconcileEnvironmentValues(input, scope);
	let token = [
		values.TREESEED_RAILWAY_API_TOKEN,
		input.context.launchEnv.TREESEED_RAILWAY_API_TOKEN,
		process.env.TREESEED_RAILWAY_API_TOKEN,
	].find((value) => typeof value === 'string' && value.trim().length > 0)?.trim() ?? '';
	let railwayApiUrl = values.TREESEED_RAILWAY_API_URL
		?? input.context.launchEnv.TREESEED_RAILWAY_API_URL
		?? process.env.TREESEED_RAILWAY_API_URL
		?? '';
	let railwayWorkspace = values.TREESEED_RAILWAY_WORKSPACE
		?? input.context.launchEnv.TREESEED_RAILWAY_WORKSPACE
		?? process.env.TREESEED_RAILWAY_WORKSPACE
		?? '';
	if (scope !== 'local' && !token) {
		const configuredValues = normalizeEnvironmentValues(resolveTreeseedMachineEnvironmentValues(input.context.tenantRoot, scope));
		token = configuredValues.TREESEED_RAILWAY_API_TOKEN ?? '';
		railwayApiUrl = railwayApiUrl || (configuredValues.TREESEED_RAILWAY_API_URL ?? '');
		railwayWorkspace = railwayWorkspace || (configuredValues.TREESEED_RAILWAY_WORKSPACE ?? '');
	}
	return {
		TREESEED_RAILWAY_API_TOKEN: token,
		RAILWAY_API_TOKEN: token,
		TREESEED_RAILWAY_API_URL: railwayApiUrl,
		TREESEED_RAILWAY_WORKSPACE: railwayWorkspace,
	};
}

export function findCloudflareQueueByName(
	input: TreeseedReconcileAdapterInput,
	env: Record<string, string>,
	expectedName: string | null | undefined,
	{ attempts = 6, delayMs = 350 }: { attempts?: number; delayMs?: number } = {},
) {
	if (!expectedName) {
		return null;
	}
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		const match = listCloudflareQueuesViaApi(env).find((entry) => queueName(entry) === expectedName) ?? null;
		if (match) {
			return match;
		}
		if (attempt < attempts - 1) {
			sleepMs(delayMs);
		}
	}
	return null;
}

export function findCloudflareD1ByName(
	input: TreeseedReconcileAdapterInput,
	env: Record<string, string>,
	expectedName: string | null | undefined,
	{ attempts = 6, delayMs = 350 }: { attempts?: number; delayMs?: number } = {},
) {
	if (!expectedName) {
		return null;
	}
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		const match = listD1Databases(input.context.tenantRoot, env).find((entry) => entry?.name === expectedName) ?? null;
		if (match) {
			return match;
		}
		if (attempt < attempts - 1) {
			sleepMs(delayMs);
		}
	}
	return null;
}

export function getCloudflareD1ById(env: Record<string, string>, databaseId: string | null | undefined) {
	if (!databaseId) {
		return null;
	}
	const accountId = env.CLOUDFLARE_ACCOUNT_ID;
	if (!accountId) {
		return null;
	}
	const payload = cloudflareApiRequest(
		`/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}`,
		{ env, allowFailure: true },
	);
	return payload?.result ?? null;
}

export function getCloudflareKvById(env: Record<string, string>, namespaceId: string | null | undefined) {
	if (!namespaceId) {
		return null;
	}
	const accountId = env.CLOUDFLARE_ACCOUNT_ID;
	if (!accountId) {
		return null;
	}
	const payload = cloudflareApiRequest(
		`/accounts/${encodeURIComponent(accountId)}/storage/kv/namespaces/${encodeURIComponent(namespaceId)}`,
		{ env, allowFailure: true },
	);
	return payload?.result ?? null;
}
