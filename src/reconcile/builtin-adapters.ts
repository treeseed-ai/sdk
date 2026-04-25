import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { collectTreeseedEnvironmentContext, resolveTreeseedMachineEnvironmentValues } from '../operations/services/config-runtime.ts';
import {
	buildPublicVars,
	buildProvisioningSummary,
	buildSecretMap,
	cloudflareApiRequest,
	createBranchPreviewDeployTarget,
	createPersistentDeployTarget,
	destroyCloudflareResources,
	ensureGeneratedWranglerConfig,
	hasProvisionedCloudflareResources,
	isWranglerAlreadyExistsError,
	listD1Databases,
	listKvNamespaces,
	listPagesProjects,
	listQueues,
	listR2Buckets,
	loadDeployState,
	queueId,
	queueName,
	reconcileCloudflareWebCacheRules,
	resolveConfiguredCloudflareAccountId,
	resolveCloudflareZoneIdForHost,
	runWrangler,
	scopeFromTarget,
	writeDeployState,
} from '../operations/services/deploy.ts';
import {
	configuredRailwayServices,
	ensureRailwayProjectContext,
	runRailway,
	validateRailwayDeployPrerequisites,
} from '../operations/services/railway-deploy.ts';
import {
	ensureRailwayEnvironment,
	ensureRailwayProject,
	ensureRailwayService,
	ensureRailwayServiceInstanceConfiguration,
	getRailwayServiceInstance,
	getRailwayProject,
	listRailwayCustomDomains,
	listRailwayProjects,
	listRailwayVariables,
	resolveRailwayWorkspaceContext,
	upsertRailwayVariables,
} from '../operations/services/railway-api.ts';
import type {
	TreeseedObservedUnitState,
	TreeseedReconcileAdapter,
	TreeseedReconcileAdapterInput,
	TreeseedReconcileResult,
	TreeseedReconcileTarget,
	TreeseedReconcileUnitDiff,
	TreeseedUnitPostcondition,
	TreeseedUnitVerificationCheck,
	TreeseedUnitVerificationResult,
	TreeseedReconcileUnitType,
} from './contracts.ts';

function toDeployTarget(target: TreeseedReconcileTarget) {
	return target.kind === 'persistent'
		? createPersistentDeployTarget(target.scope)
		: createBranchPreviewDeployTarget(target.branchName);
}

function nowIso() {
	return new Date().toISOString();
}

function sleepMs(durationMs: number) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, durationMs);
}

function isTransientCloudflareReconcileError(error: unknown) {
	const message = error instanceof Error ? error.message : String(error ?? '');
	return /fetch failed|timed out|etimedout|econnreset|enetunreach|temporarily unavailable|aborted|connectivity issue/iu.test(message);
}

function isTransientRailwayReconcileError(error: unknown) {
	const message = error instanceof Error ? error.message : String(error ?? '');
	return /fetch failed|timed out|etimedout|econnreset|enetunreach|temporarily unavailable|aborted|connectivity issue|rate limit|too many requests|429|5\d\d/iu.test(message);
}

function syntheticQueueLocator(name: string) {
	return `queue-name:${name}`;
}

function isSyntheticQueueLocator(value: unknown) {
	return typeof value === 'string' && value.startsWith('queue-name:');
}

function noopObservedState(input: TreeseedReconcileAdapterInput): TreeseedObservedUnitState {
	return {
		exists: true,
		status: 'ready',
		live: {
			unitId: input.unit.unitId,
			dependencies: input.unit.dependencies,
		},
		locators: {},
		warnings: [],
	};
}

function noopDiff(): TreeseedReconcileUnitDiff {
	return {
		action: 'noop',
		reasons: ['composite unit'],
		before: {},
		after: {},
	};
}

function buildCompositeAdapter(unitType: TreeseedReconcileUnitType): TreeseedReconcileAdapter {
	return {
		providerId: 'treeseed',
		unitTypes: [unitType],
		supports(candidateUnitType, providerId) {
			return candidateUnitType === unitType && providerId === 'treeseed';
		},
		observe(input) {
			return noopObservedState(input);
		},
		plan() {
			return noopDiff();
		},
		requiredPostconditions({ unit }) {
			return unit.dependencies.map((dependency) => ({
				key: dependency,
				description: `Dependency ${dependency} is verified`,
			}));
		},
		reconcile({ unit, observed, diff }) {
			return {
				unit,
				observed,
				diff,
				action: diff.action,
				warnings: [],
				resourceLocators: {},
				state: {
					unitId: unit.unitId,
					reconciledAt: nowIso(),
				},
				verification: null,
			};
		},
		verify({ context, unit, postconditions }) {
			const dependencyResults = context.session.get('treeseed:verification-results') as Map<string, TreeseedUnitVerificationResult> | undefined;
			const checks = postconditions.map((condition) => {
				const dependency = dependencyResults?.get(condition.key);
				const verified = dependency?.verified === true;
				return {
					key: condition.key,
					description: condition.description,
					source: 'derived' as const,
					exists: verified,
					configured: verified,
					ready: verified,
					verified,
					expected: true,
					observed: dependency?.verified ?? false,
					issues: verified ? [] : [`Dependency ${condition.key} is not verified.`],
				};
			});
			return summarizeVerification(unit.unitId, checks);
		},
	};
}

function providerCache<T>(input: TreeseedReconcileAdapterInput, key: string, loader: () => T, forceRefresh = false): T {
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

function buildCloudflareEnv(input: TreeseedReconcileAdapterInput) {
	const scope = scopeFromTarget(toDeployTarget(input.context.target));
	const machineValues = resolveTreeseedMachineEnvironmentValues(input.context.tenantRoot, scope);
	return {
		CLOUDFLARE_ACCOUNT_ID: machineValues.CLOUDFLARE_ACCOUNT_ID
			?? input.context.launchEnv.CLOUDFLARE_ACCOUNT_ID
			?? process.env.CLOUDFLARE_ACCOUNT_ID
			?? resolveConfiguredCloudflareAccountId(input.context.deployConfig),
		CLOUDFLARE_API_TOKEN: machineValues.CLOUDFLARE_API_TOKEN
			?? input.context.launchEnv.CLOUDFLARE_API_TOKEN
			?? process.env.CLOUDFLARE_API_TOKEN
			?? '',
	};
}

function hasLiveResourceId(value: unknown) {
	return typeof value === 'string'
		&& value.length > 0
		&& !value.startsWith('dryrun-')
		&& !value.startsWith('local-')
		&& !value.endsWith('-id')
		&& !value.endsWith('-preview-id');
}

function buildRailwayEnv(input: TreeseedReconcileAdapterInput, scope: 'local' | 'staging' | 'prod') {
	const machineValues = resolveTreeseedMachineEnvironmentValues(input.context.tenantRoot, scope);
	const token = [
		machineValues.RAILWAY_API_TOKEN,
		input.context.launchEnv.RAILWAY_API_TOKEN,
		process.env.RAILWAY_API_TOKEN,
	].find((value) => typeof value === 'string' && value.trim().length > 0)?.trim() ?? '';
	return {
		RAILWAY_API_TOKEN: token,
		TREESEED_RAILWAY_API_URL: machineValues.TREESEED_RAILWAY_API_URL
			?? input.context.launchEnv.TREESEED_RAILWAY_API_URL
			?? process.env.TREESEED_RAILWAY_API_URL
			?? '',
		TREESEED_RAILWAY_WORKSPACE: machineValues.TREESEED_RAILWAY_WORKSPACE
			?? input.context.launchEnv.TREESEED_RAILWAY_WORKSPACE
			?? process.env.TREESEED_RAILWAY_WORKSPACE
			?? '',
	};
}

function findCloudflareQueueByName(
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

function findCloudflareD1ByName(
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

function getCloudflareD1ById(env: Record<string, string>, databaseId: string | null | undefined) {
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

function getCloudflareKvById(env: Record<string, string>, namespaceId: string | null | undefined) {
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

function listCloudflareQueuesViaApi(env: Record<string, string>) {
	const accountId = env.CLOUDFLARE_ACCOUNT_ID;
	if (!accountId) {
		throw new Error('Configure CLOUDFLARE_ACCOUNT_ID before reconciling Cloudflare queues.');
	}
	const payload = cloudflareApiRequest(`/accounts/${encodeURIComponent(accountId)}/queues`, { env });
	return Array.isArray(payload?.result) ? payload.result : [];
}

function cloudflareObservationSnapshot(input: TreeseedReconcileAdapterInput, forceRefresh = false) {
	const cacheKey = `cloudflare:observe:${input.unit.target.kind === 'persistent' ? input.unit.target.scope : input.unit.target.branchName}`;
	return providerCache(input, cacheKey, () => {
		const target = toDeployTarget(input.context.target);
		const env = buildCloudflareEnv(input);
		return {
			target,
			env,
			state: loadDeployState(input.context.tenantRoot, input.context.deployConfig, { target }),
			kvNamespaces: listKvNamespaces(input.context.tenantRoot, env),
			d1Databases: listD1Databases(input.context.tenantRoot, env),
			queues: listCloudflareQueuesViaApi(env),
			buckets: listR2Buckets(input.context.tenantRoot, env),
			pagesProjects: listPagesProjects(input.context.tenantRoot, env),
		};
	}, forceRefresh);
}

function customDomainStateKey(provider: string, domain: string) {
	return `custom-domain:${provider}:${domain}`;
}

function storeCustomDomainState(input: TreeseedReconcileAdapterInput, provider: string, domain: string, value: Record<string, unknown>) {
	input.context.session.set(customDomainStateKey(provider, domain), value);
}

function getCustomDomainState(input: TreeseedReconcileAdapterInput, provider: string, domain: string) {
	return input.context.session.get(customDomainStateKey(provider, domain)) as Record<string, unknown> | undefined;
}

function listCloudflareDnsRecords(env: Record<string, string>, zoneId: string, recordName?: string | null) {
	const query = recordName ? `?name=${encodeURIComponent(recordName)}` : '';
	const payload = cloudflareApiRequest(`/zones/${encodeURIComponent(zoneId)}/dns_records${query}`, {
		env,
		allowFailure: true,
	});
	return Array.isArray(payload?.result) ? payload.result : [];
}

function ensureCloudflareDnsRecord(env: Record<string, string>, zoneId: string, record: {
	name: string;
	type: string;
	content: string;
	proxied?: boolean;
	ttl?: number;
}) {
	const existing = listCloudflareDnsRecords(env, zoneId, record.name)
		.find((entry) => entry?.name === record.name && entry?.type === record.type);
	if (existing?.id) {
		const unchanged = existing.content === record.content
			&& (record.proxied === undefined || Boolean(existing.proxied) === Boolean(record.proxied));
		if (unchanged) {
			return existing;
		}
		return cloudflareApiRequest(`/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(existing.id)}`, {
			method: 'PATCH',
			env,
			body: {
				type: record.type,
				name: record.name,
				content: record.content,
				...(record.proxied === undefined ? {} : { proxied: record.proxied }),
				ttl: record.ttl ?? 1,
			},
		})?.result ?? existing;
	}
	return cloudflareApiRequest(`/zones/${encodeURIComponent(zoneId)}/dns_records`, {
		method: 'POST',
		env,
		body: {
			type: record.type,
			name: record.name,
			content: record.content,
			...(record.proxied === undefined ? {} : { proxied: record.proxied }),
			ttl: record.ttl ?? 1,
		},
	})?.result ?? null;
}

function getCloudflarePagesDomain(env: Record<string, string>, projectName: string, domain: string) {
	const accountId = env.CLOUDFLARE_ACCOUNT_ID;
	if (!accountId) {
		return null;
	}
	const payload = cloudflareApiRequest(
		`/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}/domains/${encodeURIComponent(domain)}`,
		{ env, allowFailure: true },
	);
	return payload?.result ?? null;
}

function ensureCloudflarePagesDomain(env: Record<string, string>, projectName: string, domain: string) {
	const existing = getCloudflarePagesDomain(env, projectName, domain);
	if (existing?.name || existing?.domain) {
		return existing;
	}
	const accountId = env.CLOUDFLARE_ACCOUNT_ID;
	if (!accountId) {
		throw new Error('Configure CLOUDFLARE_ACCOUNT_ID before reconciling Pages custom domains.');
	}
	const created = cloudflareApiRequest(
		`/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}/domains`,
		{
			method: 'POST',
			env,
			body: { name: domain },
		},
	);
	return created?.result ?? null;
}

function normalizeRailwayDomainDnsRecord(value: unknown) {
	if (!value || typeof value !== 'object') {
		return null;
	}
	const record = value as Record<string, unknown>;
	const rawType = typeof record.recordType === 'string'
		? record.recordType.trim().toUpperCase()
		: typeof record.type === 'string'
			? record.type.trim().toUpperCase()
			: '';
	const type = rawType.startsWith('DNS_RECORD_TYPE_')
		? rawType.replace(/^DNS_RECORD_TYPE_/u, '')
		: rawType;
	const host = typeof record.fqdn === 'string'
		? record.fqdn.trim()
		: typeof record.hostname === 'string'
			? record.hostname.trim()
		: typeof record.name === 'string'
			? record.name.trim()
			: '';
	const valueText = typeof record.requiredValue === 'string'
		? record.requiredValue.trim()
		: typeof record.currentValue === 'string'
			? record.currentValue.trim()
		: typeof record.value === 'string'
			? record.value.trim()
				: typeof record.link === 'string'
					? record.link.trim()
					: '';
	if (!type || !host || !valueText) {
		return null;
	}
	return {
		type,
		name: host,
		content: valueText,
		status: typeof record.status === 'string' ? record.status.trim().toUpperCase() : '',
	};
}

function normalizeRailwayDomainPayload(value: unknown) {
	if (!value || typeof value !== 'object') {
		return null;
	}
	const record = value as Record<string, unknown>;
	const domain = typeof record.domain === 'string'
		? record.domain.trim()
		: typeof record.name === 'string'
			? record.name.trim()
			: '';
	const dnsRecordCandidates = Array.isArray(record.dnsRecords)
		? record.dnsRecords
		: Array.isArray((record.status as Record<string, unknown> | undefined)?.dnsRecords)
			? ((record.status as Record<string, unknown>).dnsRecords as unknown[])
			: [];
	const dnsRecords = dnsRecordCandidates
		.map((entry) => normalizeRailwayDomainDnsRecord(entry))
		.filter(Boolean);
	return {
		id: typeof record.id === 'string' ? record.id.trim() : null,
		domain,
		serviceDomain: typeof record.serviceDomain === 'string'
			? record.serviceDomain.trim()
			: typeof record.target === 'string'
				? record.target.trim()
				: null,
		certificateStatus: typeof (record.status as Record<string, unknown> | undefined)?.certificateStatus === 'string'
			? String((record.status as Record<string, unknown>).certificateStatus).trim().toUpperCase()
			: null,
		verificationDnsHost: typeof record.verificationDnsHost === 'string'
			? record.verificationDnsHost.trim()
			: typeof (record.status as Record<string, unknown> | undefined)?.verificationDnsHost === 'string'
				? String((record.status as Record<string, unknown>).verificationDnsHost).trim()
				: null,
		verificationToken: typeof record.verificationToken === 'string'
			? record.verificationToken.trim()
			: typeof (record.status as Record<string, unknown> | undefined)?.verificationToken === 'string'
				? String((record.status as Record<string, unknown>).verificationToken).trim()
				: null,
		dnsRecords,
	};
}

async function ensureRailwayCustomDomain(input: TreeseedReconcileAdapterInput, service, domain: string, env: Record<string, string>, identifiers?: { projectId?: string | null; environmentId?: string | null; serviceId?: string | null }) {
	if (identifiers?.projectId && identifiers?.environmentId && identifiers?.serviceId) {
		const existing = await listRailwayCustomDomains({
			projectId: identifiers.projectId,
			environmentId: identifiers.environmentId,
			serviceId: identifiers.serviceId,
			env,
		});
		const matched = existing.find((entry) => entry.domain === domain) ?? null;
		if (matched) {
			return matched;
		}
	}
	ensureRailwayProjectContext(service, { env, capture: true });
	const result = runRailway(['domain', domain, '--service', service.serviceName ?? service.serviceId, '--json'], {
		cwd: service.rootDir,
		capture: true,
		allowFailure: true,
		env,
	});
	const output = `${result.stderr ?? ''}\n${result.stdout ?? ''}`;
	if (identifiers?.projectId && identifiers?.environmentId && identifiers?.serviceId) {
		const refreshed = await listRailwayCustomDomains({
			projectId: identifiers.projectId,
			environmentId: identifiers.environmentId,
			serviceId: identifiers.serviceId,
			env,
		});
		const matched = refreshed.find((entry) => entry.domain === domain) ?? null;
		if (matched) {
			return matched;
		}
	}
	if (result.status !== 0 && !/already exists|already assigned|taken|has already been taken|not available/iu.test(output)) {
		throw new Error(result.stderr?.trim() || result.stdout?.trim() || `railway domain ${domain} failed`);
	}
	let parsedJson: unknown = {};
	if (result.stdout?.trim()) {
		try {
			parsedJson = JSON.parse(result.stdout);
		} catch {
			parsedJson = {};
		}
	}
	const parsed = normalizeRailwayDomainPayload(parsedJson);
	return parsed ?? {
		id: null,
		domain,
		serviceDomain: null,
		certificateStatus: null,
		dnsRecords: [],
	};
}

function collectCloudflareEnvironmentSync(input: TreeseedReconcileAdapterInput) {
	const target = toDeployTarget(input.context.target);
	const scope = scopeFromTarget(target);
	const values = resolveTreeseedMachineEnvironmentValues(input.context.tenantRoot, scope);
	const registry = collectTreeseedEnvironmentContext(input.context.tenantRoot);
	const state = loadDeployState(input.context.tenantRoot, input.context.deployConfig, { target });
	const generatedSecrets = buildSecretMap(input.context.deployConfig, state);
	const publicVars = buildPublicVars(input.context.deployConfig);
	const secrets: Record<string, string> = {};
	const vars: Record<string, string> = { ...publicVars };
	const secretNames = new Set<string>();
	const varNames = new Set<string>(Object.keys(publicVars));

	for (const entry of registry.entries) {
		if (!entry.scopes.includes(scope)) {
			continue;
		}
		const value = typeof values[entry.id] === 'string' ? values[entry.id] : '';
		if (entry.targets.includes('cloudflare-secret')) {
			const secretValue = value || (typeof generatedSecrets[entry.id] === 'string' ? generatedSecrets[entry.id] : '');
			if (secretValue) {
				secrets[entry.id] = secretValue;
				secretNames.add(entry.id);
			}
		}
		if (entry.targets.includes('cloudflare-var') && value) {
			vars[entry.id] = value;
			varNames.add(entry.id);
		}
	}

	for (const [key, value] of Object.entries(generatedSecrets)) {
		if (typeof value === 'string' && value.length > 0) {
			secrets[key] = value;
			secretNames.add(key);
		}
	}

	return { scope, state, secrets, vars, secretNames: [...secretNames], varNames: [...varNames] };
}

function verificationCheck(
	key: string,
	description: string,
	source: TreeseedUnitVerificationCheck['source'],
	options: {
		exists: boolean;
		configured?: boolean;
		ready?: boolean;
		verified?: boolean;
		expected?: unknown;
		observed?: unknown;
		issues?: string[];
	},
): TreeseedUnitVerificationCheck {
	return {
		key,
		description,
		source,
		exists: options.exists,
		configured: options.configured ?? options.exists,
		ready: options.ready ?? options.exists,
		verified: options.verified ?? (options.exists && (options.configured ?? true) && (options.ready ?? true) && (options.issues?.length ?? 0) === 0),
		expected: options.expected,
		observed: options.observed,
		issues: options.issues ?? [],
	};
}

function summarizeVerification(unitId: string, checks: TreeseedUnitVerificationCheck[], warnings: string[] = []): TreeseedUnitVerificationResult {
	const missing = checks.flatMap((check) => !check.exists ? [`${check.key}: ${check.description}`] : []);
	const drifted = checks.flatMap((check) =>
		check.exists && (!check.configured || !check.ready || !check.verified || check.issues.length > 0)
			? [`${check.key}: ${check.issues.join('; ') || 'verification failed'}`]
			: [],
	);
	return {
		unitId,
		supported: true,
		exists: checks.every((check) => check.exists),
		configured: checks.every((check) => check.configured),
		ready: checks.every((check) => check.ready),
		verified: checks.every((check) => check.verified),
		checks,
		missing,
		drifted,
		warnings,
	};
}

function unsupportedVerification(unitId: string, message: string): TreeseedUnitVerificationResult {
	return {
		unitId,
		supported: false,
		exists: false,
		configured: false,
		ready: false,
		verified: false,
		checks: [verificationCheck('unsupported', message, 'sdk', {
			exists: false,
			configured: false,
			ready: false,
			verified: false,
			issues: [message],
		})],
		missing: [message],
		drifted: [],
		warnings: [],
	};
}

function syncPagesEnvironmentVariablesForTarget(input: TreeseedReconcileAdapterInput, { dryRun = false } = {}) {
	const target = toDeployTarget(input.context.target);
	if (target.kind !== 'persistent') {
		return { vars: [], secrets: [] };
	}
	const env = buildCloudflareEnv(input);
	const accountId = env.CLOUDFLARE_ACCOUNT_ID;
	const { state, vars, secrets } = collectCloudflareEnvironmentSync(input);
	if (!accountId || !state.pages?.projectName) {
		return { vars: [], secrets: [] };
	}
	const branchConfigKey = target.scope === 'prod' ? 'production' : 'preview';
	const plainVars = Object.fromEntries(
		Object.entries(vars)
			.filter(([, value]) => typeof value === 'string' && value.length > 0)
			.map(([key, value]) => [key, { type: 'plain_text', value }]),
	);
	const secretVars = Object.fromEntries(
		Object.entries(secrets)
			.filter(([, value]) => typeof value === 'string' && value.length > 0)
			.map(([key, value]) => [key, { type: 'secret_text', value }]),
	);
	const envVars = {
		...plainVars,
		...secretVars,
	};
	if (dryRun || Object.keys(envVars).length === 0) {
		return {
			vars: Object.keys(plainVars),
			secrets: Object.keys(secretVars),
		};
	}
	const projectPath = `/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(state.pages.projectName)}`;
	const existing = cloudflareApiRequest(projectPath, { env, allowFailure: true });
	const deploymentConfigs = (existing?.result?.deployment_configs && typeof existing.result.deployment_configs === 'object')
		? existing.result.deployment_configs
		: {};
	const currentBranchConfig = (deploymentConfigs?.[branchConfigKey] && typeof deploymentConfigs[branchConfigKey] === 'object')
		? deploymentConfigs[branchConfigKey]
		: {};
	const mergedDeploymentConfigs = {
		...deploymentConfigs,
		[branchConfigKey]: {
			...currentBranchConfig,
			env_vars: {
				...(currentBranchConfig?.env_vars ?? {}),
				...envVars,
			},
		},
	};
	cloudflareApiRequest(projectPath, {
		method: 'PATCH',
		env,
		body: {
			deployment_configs: mergedDeploymentConfigs,
		},
	});
	return {
		vars: Object.keys(plainVars),
		secrets: Object.keys(secretVars),
	};
}

function reconcileCloudflareTarget(input: TreeseedReconcileAdapterInput, { dryRun = false } = {}) {
	const target = toDeployTarget(input.context.target);
	const deployConfig = input.context.deployConfig;
	const state = loadDeployState(input.context.tenantRoot, deployConfig, { target });
	const env = buildCloudflareEnv(input);
	const kvNamespaces = dryRun ? [] : listKvNamespaces(input.context.tenantRoot, env);
	const d1Databases = dryRun ? [] : listD1Databases(input.context.tenantRoot, env);
	const queues = dryRun ? [] : listQueues(input.context.tenantRoot, env);
	const buckets = dryRun ? [] : listR2Buckets(input.context.tenantRoot, env);
	const pagesProjects = dryRun ? [] : listPagesProjects(input.context.tenantRoot, env);
	const runStep = <T>(label: string, fn: () => T): T => {
		try {
			return fn();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error ?? '');
			throw new Error(`Cloudflare reconcile step ${label} failed: ${message}`);
		}
	};

	const ensureKv = (binding) => {
		const current = state.kvNamespaces[binding];
		if (hasLiveResourceId(current?.id)) {
			const liveById = getCloudflareKvById(env, current.id);
			if (liveById?.id) {
				state.kvNamespaces[binding].previewId = current.previewId ?? current.id;
				return;
			}
		}
		const existing = kvNamespaces.find((entry) => entry?.title === current.name);
		if (existing?.id) {
			state.kvNamespaces[binding].id = existing.id;
			state.kvNamespaces[binding].previewId = existing.id;
			return;
		}
		if (dryRun) {
			state.kvNamespaces[binding].id = `dryrun-${current.name}`;
			state.kvNamespaces[binding].previewId = `dryrun-${current.name}`;
			return;
		}
		runWrangler(['kv', 'namespace', 'create', current.name], {
			cwd: input.context.tenantRoot,
			capture: true,
			env,
		});
		const created = listKvNamespaces(input.context.tenantRoot, env).find((entry) => entry?.title === current.name);
		if (!created?.id) {
			throw new Error(`Unable to resolve created KV namespace id for ${current.name}.`);
		}
		state.kvNamespaces[binding].id = created.id;
		state.kvNamespaces[binding].previewId = created.id;
	};

	const ensureD1 = () => {
		const current = state.d1Databases.SITE_DATA_DB;
		if (hasLiveResourceId(current?.databaseId)) {
			const liveById = getCloudflareD1ById(env, current.databaseId);
			if (liveById?.uuid || liveById?.id) {
				current.previewDatabaseId = current.previewDatabaseId ?? current.databaseId;
				return;
			}
		}
		const existing = d1Databases.find((entry) => entry?.name === current.databaseName);
		if (existing?.uuid) {
			current.databaseId = existing.uuid;
			current.previewDatabaseId = existing.previewDatabaseUuid ?? existing.uuid;
			return;
		}
		if (dryRun) {
			current.databaseId = `dryrun-${current.databaseName}`;
			current.previewDatabaseId = `dryrun-${current.databaseName}`;
			return;
		}
		try {
			const created = cloudflareApiRequest(`/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/d1/database`, {
				method: 'POST',
				env,
				body: {
					name: current.databaseName,
				},
			})?.result;
			if (created?.uuid) {
				current.databaseId = created.uuid;
				current.previewDatabaseId = created.previewDatabaseUuid ?? created.uuid;
				return;
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (!/already exists/i.test(message)) {
				throw error;
			}
		}
		const created = findCloudflareD1ByName(input, env, current.databaseName, { attempts: 12, delayMs: 500 });
		if (!created?.uuid) {
			throw new Error(`Unable to resolve created D1 database id for ${current.databaseName}.`);
		}
		current.databaseId = created.uuid;
		current.previewDatabaseId = created.previewDatabaseUuid ?? created.uuid;
	};

	const ensureQueue = () => {
		const current = state.queues?.agentWork;
		if (!current?.name) {
			return;
		}
		const liveQueue = findCloudflareQueueByName(input, env, current.name, { attempts: 1, delayMs: 0 });
		const liveDlq = current.dlqName
			? findCloudflareQueueByName(input, env, current.dlqName, { attempts: 1, delayMs: 0 })
			: null;
		if (liveQueue) {
			current.queueId = queueId(liveQueue);
			current.dlqId = current.dlqName ? queueId(liveDlq) : null;
			return;
		}
		let refreshedQueues = queues;
		const existing = refreshedQueues.find((entry) => queueName(entry) === current.name);
		if (existing) {
			current.queueId = queueId(existing);
			const existingDlq = current.dlqName ? refreshedQueues.find((entry) => queueName(entry) === current.dlqName) : null;
			current.dlqId = queueId(existingDlq);
			return;
		}
		if (dryRun) {
			current.queueId = `dryrun-${current.name}`;
			current.dlqId = current.dlqName ? `dryrun-${current.dlqName}` : null;
			return;
		}
		try {
			runWrangler(['queues', 'create', current.name], {
				cwd: input.context.tenantRoot,
				capture: true,
				env,
			});
		} catch (error) {
			if (!isWranglerAlreadyExistsError(error, [/Queue name .* is already taken/i, /\[code:\s*11009\]/i])) {
				throw error;
			}
		}
		refreshedQueues = listQueues(input.context.tenantRoot, env);
		if (current.dlqName && !refreshedQueues.find((entry) => queueName(entry) === current.dlqName)) {
			try {
				runWrangler(['queues', 'create', current.dlqName], {
					cwd: input.context.tenantRoot,
					capture: true,
					env,
				});
			} catch (error) {
				if (!isWranglerAlreadyExistsError(error, [/Queue name .* is already taken/i, /\[code:\s*11009\]/i])) {
					throw error;
				}
			}
		}
		const created = findCloudflareQueueByName(input, env, current.name);
		current.queueId = created ? queueId(created) : syntheticQueueLocator(current.name);
		const createdDlq = current.dlqName ? findCloudflareQueueByName(input, env, current.dlqName) : null;
		current.dlqId = current.dlqName
			? (createdDlq ? queueId(createdDlq) : syntheticQueueLocator(current.dlqName))
			: null;
	};

	const ensureR2Bucket = () => {
		const bucketName = state.content?.bucketName;
		if (!bucketName) {
			return;
		}
		let refreshedBuckets = buckets;
		const existing = refreshedBuckets.find((entry) => entry?.name === bucketName);
		if (existing || dryRun) {
			return;
		}
		try {
			runWrangler(['r2', 'bucket', 'create', bucketName], {
				cwd: input.context.tenantRoot,
				capture: true,
				env,
			});
		} catch (error) {
			if (!isWranglerAlreadyExistsError(error, [/bucket you tried to create already exists, and you own it/i, /\[code:\s*10004\]/i])) {
				throw error;
			}
		}
		refreshedBuckets = listR2Buckets(input.context.tenantRoot, env);
	};

	const ensurePagesProject = () => {
		const current = state.pages;
		if (!current?.projectName) {
			return;
		}
		const existing = pagesProjects.find((entry) => entry?.name === current.projectName);
		if (existing) {
			if (!dryRun && (existing.production_branch ?? 'main') !== (current.productionBranch ?? 'main')) {
				cloudflareApiRequest(
					`/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/pages/projects/${encodeURIComponent(current.projectName)}`,
					{
						method: 'PATCH',
						env,
						body: {
							production_branch: current.productionBranch ?? 'main',
						},
					},
				);
			}
			current.url = existing.subdomain ? `https://${existing.subdomain}` : current.url ?? `https://${current.projectName}.pages.dev`;
			return;
		}
		if (dryRun) {
			current.url = `https://${current.projectName}.pages.dev`;
			return;
		}
		try {
			runWrangler([
				'pages',
				'project',
				'create',
				current.projectName,
				'--production-branch',
				current.productionBranch ?? 'main',
			], {
				cwd: input.context.tenantRoot,
				capture: true,
				env,
			});
		} catch (error) {
			if (!isWranglerAlreadyExistsError(error, [/A project with this name already exists/i, /\[code:\s*8000002\]/i])) {
				throw error;
			}
		}
		current.url = `https://${current.projectName}.pages.dev`;
	};

	runStep('kv-form-guard', () => ensureKv('FORM_GUARD_KV'));
	runStep('kv-session', () => ensureKv('SESSION'));
	runStep('d1', ensureD1);
	runStep('queue', ensureQueue);
	runStep('r2', ensureR2Bucket);
	runStep('pages', ensurePagesProject);
	runStep('web-cache', () => reconcileCloudflareWebCacheRules(input.context.tenantRoot, deployConfig, state, target, { dryRun, env }));
	state.readiness.configured = true;
	state.readiness.provisioned = hasProvisionedCloudflareResources(state);
	state.readiness.deployable = state.readiness.provisioned === true;
	state.readiness.phase = state.readiness.provisioned === true ? 'provisioned' : 'config_complete';
	state.readiness.initialized = true;
	state.readiness.initializedAt = new Date().toISOString();
	state.readiness.lastValidatedAt = state.readiness.initializedAt;
	state.readiness.blockers = [];
	state.readiness.warnings = [];
	state.readiness.lastValidationSummary = {
		cloudflare: state.readiness.provisioned === true ? 'ready' : 'incomplete',
		railway: 'configured',
	};
	writeDeployState(input.context.tenantRoot, state, { target });
	return { state, summary: buildProvisioningSummary(deployConfig, state, target) };
}

function syncCloudflareSecretsForTarget(input: TreeseedReconcileAdapterInput, { dryRun = false } = {}) {
	const target = toDeployTarget(input.context.target);
	const deployConfig = input.context.deployConfig;
	const state = loadDeployState(input.context.tenantRoot, deployConfig, { target });
	const { secrets } = collectCloudflareEnvironmentSync(input);
	const synced = [];
	for (const [key, value] of Object.entries(secrets)) {
		if (!value) {
			continue;
		}
		synced.push(key);
	}
	state.generatedSecrets = {
		...(state.generatedSecrets ?? {}),
		TREESEED_FORM_TOKEN_SECRET: secrets.TREESEED_FORM_TOKEN_SECRET ?? state.generatedSecrets?.TREESEED_FORM_TOKEN_SECRET,
		TREESEED_EDITORIAL_PREVIEW_SECRET: secrets.TREESEED_EDITORIAL_PREVIEW_SECRET ?? state.generatedSecrets?.TREESEED_EDITORIAL_PREVIEW_SECRET,
	};
	writeDeployState(input.context.tenantRoot, state, { target });
	return synced;
}

function observeCloudflareUnit(input: TreeseedReconcileAdapterInput): TreeseedObservedUnitState {
	const snapshot = cloudflareObservationSnapshot(input);
	const { state, kvNamespaces, d1Databases, queues, buckets, pagesProjects } = snapshot;
	switch (input.unit.unitType) {
		case 'queue': {
			const liveQueue = queues.find((entry) => queueName(entry) === state.queues?.agentWork?.name);
			const liveDlq = queues.find((entry) => queueName(entry) === state.queues?.agentWork?.dlqName);
			return {
				exists: Boolean(liveQueue || state.queues?.agentWork?.queueId),
				status: liveQueue ? 'ready' : 'pending',
				live: { ...(state.queues?.agentWork ?? {}) },
				locators: {
					queueId: queueId(liveQueue) ?? state.queues?.agentWork?.queueId ?? null,
					dlqId: queueId(liveDlq) ?? state.queues?.agentWork?.dlqId ?? null,
				},
				warnings: [
					...(isSyntheticQueueLocator(state.queues?.agentWork?.queueId) ? ['Cloudflare queue id is pending propagation; using queue-name fallback.'] : []),
					...(isSyntheticQueueLocator(state.queues?.agentWork?.dlqId) ? ['Cloudflare dead-letter queue id is pending propagation; using queue-name fallback.'] : []),
				],
			};
		}
		case 'database': {
			const liveDatabase = d1Databases.find((entry) => entry?.name === state.d1Databases?.SITE_DATA_DB?.databaseName);
			return {
				exists: Boolean(liveDatabase || hasLiveResourceId(state.d1Databases?.SITE_DATA_DB?.databaseId)),
				status: liveDatabase ? 'ready' : 'pending',
				live: { ...(state.d1Databases?.SITE_DATA_DB ?? {}) },
				locators: {
					databaseId: liveDatabase?.uuid ?? state.d1Databases?.SITE_DATA_DB?.databaseId ?? null,
				},
				warnings: [],
			};
		}
		case 'content-store': {
			const liveBucket = buckets.find((entry) => entry?.name === state.content?.bucketName);
			return {
				exists: Boolean(liveBucket || state.content?.bucketName),
				status: liveBucket ? 'ready' : 'pending',
				live: { ...(state.content ?? {}) },
				locators: {
					bucketName: liveBucket?.name ?? state.content?.bucketName ?? null,
				},
				warnings: [],
			};
		}
		case 'kv-form-guard': {
			const liveNamespace = kvNamespaces.find((entry) => entry?.title === state.kvNamespaces?.FORM_GUARD_KV?.name);
			return {
				exists: Boolean(liveNamespace || hasLiveResourceId(state.kvNamespaces?.FORM_GUARD_KV?.id)),
				status: liveNamespace ? 'ready' : 'pending',
				live: { ...(state.kvNamespaces?.FORM_GUARD_KV ?? {}) },
				locators: { id: liveNamespace?.id ?? state.kvNamespaces?.FORM_GUARD_KV?.id ?? null },
				warnings: [],
			};
		}
		case 'kv-session': {
			const liveNamespace = kvNamespaces.find((entry) => entry?.title === state.kvNamespaces?.SESSION?.name);
			return {
				exists: Boolean(liveNamespace || hasLiveResourceId(state.kvNamespaces?.SESSION?.id)),
				status: liveNamespace ? 'ready' : 'pending',
				live: { ...(state.kvNamespaces?.SESSION ?? {}) },
				locators: { id: liveNamespace?.id ?? state.kvNamespaces?.SESSION?.id ?? null },
				warnings: [],
			};
		}
		case 'pages-project': {
			const liveProject = pagesProjects.find((entry) => entry?.name === state.pages?.projectName);
			return {
				exists: Boolean(liveProject || state.pages?.projectName),
				status: liveProject ? 'ready' : 'pending',
				live: { ...(state.pages ?? {}) },
				locators: {
					projectName: liveProject?.name ?? state.pages?.projectName ?? null,
					url: liveProject?.subdomain ? `https://${liveProject.subdomain}` : state.pages?.url ?? null,
				},
				warnings: [],
			};
		}
		case 'edge-worker':
			return {
				exists: Boolean(state.workerName),
				status: state.workerName ? 'ready' : 'pending',
				live: { workerName: state.workerName, lastDeployedUrl: state.lastDeployedUrl ?? null },
				locators: { workerName: state.workerName ?? null, url: state.lastDeployedUrl ?? null },
				warnings: [],
			};
		default:
			return noopObservedState(input);
	}
}

function verifyCloudflareUnitOnce(input: TreeseedReconcileAdapterInput, postconditions: TreeseedUnitPostcondition[]): TreeseedUnitVerificationResult {
	if (input.unit.unitType === 'edge-worker') {
		const target = toDeployTarget(input.context.target);
		const state = loadDeployState(input.context.tenantRoot, input.context.deployConfig, { target });
		return summarizeVerification(input.unit.unitId, [
			verificationCheck('edge-worker.generated', 'Generated Cloudflare worker config exists for the web runtime', 'sdk', {
				exists: Boolean(state.workerName),
				expected: state.workerName ?? null,
				observed: state.workerName ?? null,
				issues: state.workerName ? [] : ['Generated Cloudflare worker runtime metadata is missing.'],
			}),
		]);
	}
	const snapshot = cloudflareObservationSnapshot(input, true);
	const { state, kvNamespaces, d1Databases, queues, buckets, pagesProjects, env } = snapshot;
	switch (input.unit.unitType) {
		case 'queue': {
			const queue = state.queues?.agentWork;
			const liveQueue = findCloudflareQueueByName(input, env, queue?.name, { attempts: 12, delayMs: 500 });
			const liveDlq = queue?.dlqName
				? findCloudflareQueueByName(input, env, queue.dlqName, { attempts: 12, delayMs: 500 })
				: null;
			return summarizeVerification(input.unit.unitId, [
				verificationCheck('queue.exists', 'Queue exists by name and id', 'cli', {
					exists: Boolean(liveQueue && queueId(liveQueue)),
					expected: queue?.name ?? null,
					observed: liveQueue ? { name: queueName(liveQueue), id: queueId(liveQueue) } : null,
					issues: liveQueue && queueId(liveQueue) ? [] : [`Cloudflare queue ${queue?.name ?? '(unset)'} was not found after reconcile.`],
				}),
				verificationCheck('queue.dlq', 'Dead-letter queue exists by name and id', 'cli', {
					exists: !queue?.dlqName || Boolean(liveDlq && queueId(liveDlq)),
					expected: queue?.dlqName ?? null,
					observed: liveDlq ? { name: queueName(liveDlq), id: queueId(liveDlq) } : null,
					issues: !queue?.dlqName || (liveDlq && queueId(liveDlq)) ? [] : [`Cloudflare dead-letter queue ${queue.dlqName} was not found after reconcile.`],
				}),
				verificationCheck('queue.binding', 'Queue binding matches desired config', 'sdk', {
					exists: Boolean(queue?.binding),
					configured: queue?.binding === input.unit.spec.binding,
					expected: input.unit.spec.binding,
					observed: queue?.binding ?? null,
					issues: queue?.binding === input.unit.spec.binding ? [] : ['Configured queue binding does not match the desired value.'],
				}),
			], postconditions.length > 0 ? [] : []);
		}
		case 'database': {
			const db = state.d1Databases?.SITE_DATA_DB;
			const live = getCloudflareD1ById(env, db?.databaseId)
				?? findCloudflareD1ByName(input, env, db?.databaseName, { attempts: 12, delayMs: 500 });
			const liveDatabaseId = live?.uuid ?? live?.id ?? null;
			return summarizeVerification(input.unit.unitId, [
				verificationCheck('database.exists', 'D1 database exists by name and id', 'cli', {
					exists: Boolean(liveDatabaseId),
					expected: db?.databaseName ?? null,
					observed: live ? { name: live.name, id: liveDatabaseId } : null,
					issues: liveDatabaseId ? [] : [`Cloudflare D1 database ${db?.databaseName ?? '(unset)'} was not found after reconcile.`],
				}),
				verificationCheck('database.binding', 'Database binding matches desired config', 'sdk', {
					exists: Boolean(db?.binding),
					configured: db?.binding === input.unit.spec.binding,
					expected: input.unit.spec.binding,
					observed: db?.binding ?? null,
					issues: db?.binding === input.unit.spec.binding ? [] : ['Configured D1 binding does not match the desired value.'],
				}),
			]);
		}
		case 'kv-form-guard':
		case 'kv-session': {
			const binding = input.unit.unitType === 'kv-form-guard' ? 'FORM_GUARD_KV' : 'SESSION';
			const namespace = state.kvNamespaces?.[binding];
			const live = getCloudflareKvById(env, namespace?.id)
				?? kvNamespaces.find((entry) => entry?.title === namespace?.name);
			return summarizeVerification(input.unit.unitId, [
				verificationCheck('kv.exists', 'KV namespace exists by title and id', 'cli', {
					exists: Boolean(live?.id),
					expected: namespace?.name ?? null,
					observed: live ? { title: live.title, id: live.id } : null,
					issues: live?.id ? [] : [`Cloudflare KV namespace ${namespace?.name ?? '(unset)'} was not found after reconcile.`],
				}),
				verificationCheck('kv.binding', 'KV binding matches desired config', 'sdk', {
					exists: Boolean(namespace?.binding),
					configured: namespace?.binding === input.unit.spec.binding,
					expected: input.unit.spec.binding,
					observed: namespace?.binding ?? null,
					issues: namespace?.binding === input.unit.spec.binding ? [] : ['Configured KV binding does not match the desired value.'],
				}),
			]);
		}
		case 'content-store': {
			const bucketName = state.content?.bucketName;
			const live = buckets.find((entry) => entry?.name === bucketName);
			return summarizeVerification(input.unit.unitId, [
				verificationCheck('r2.exists', 'R2 bucket exists by name', 'cli', {
					exists: Boolean(live?.name),
					expected: bucketName ?? null,
					observed: live?.name ?? null,
					issues: live?.name ? [] : [`Cloudflare R2 bucket ${bucketName ?? '(unset)'} was not found after reconcile.`],
				}),
				verificationCheck('r2.binding', 'R2 binding matches desired config', 'sdk', {
					exists: Boolean(state.content?.r2Binding),
					configured: state.content?.r2Binding === input.unit.spec.binding,
					expected: input.unit.spec.binding,
					observed: state.content?.r2Binding ?? null,
					issues: state.content?.r2Binding === input.unit.spec.binding ? [] : ['Configured R2 binding does not match the desired value.'],
				}),
			]);
		}
		case 'pages-project': {
			const current = state.pages;
			const liveProject = pagesProjects.find((entry) => entry?.name === current?.projectName);
			if (!env.CLOUDFLARE_ACCOUNT_ID || !current?.projectName) {
				return unsupportedVerification(input.unit.unitId, 'Cloudflare Pages verification requires CLOUDFLARE_ACCOUNT_ID and a configured project name.');
			}
			const project = cloudflareApiRequest(
				`/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/pages/projects/${encodeURIComponent(current.projectName)}`,
				{ env, allowFailure: true },
			)?.result;
			const branchKey = input.context.target.kind === 'persistent' && input.context.target.scope === 'prod' ? 'production' : 'preview';
			const branchConfig = project?.deployment_configs?.[branchKey] ?? {};
			const envVars = branchConfig?.env_vars && typeof branchConfig.env_vars === 'object' ? branchConfig.env_vars : {};
			const sync = collectCloudflareEnvironmentSync(input);
			const expectedVars = Object.entries(sync.vars).filter(([, value]) => typeof value === 'string' && value.length > 0);
			const checks: TreeseedUnitVerificationCheck[] = [
				verificationCheck('pages.exists', 'Pages project exists', 'cli', {
					exists: Boolean(liveProject?.name || project?.name),
					expected: current.projectName,
					observed: liveProject?.name ?? project?.name ?? null,
					issues: liveProject?.name || project?.name ? [] : [`Cloudflare Pages project ${current.projectName} was not found after reconcile.`],
				}),
			];
			if (input.context.target.kind === 'persistent' && input.context.target.scope === 'prod') {
				checks.push(verificationCheck('pages.production-branch', 'Pages production branch matches desired config', 'api', {
					exists: typeof project?.production_branch === 'string' && project.production_branch.length > 0,
					configured: (project?.production_branch ?? current.productionBranch ?? 'main') === (current.productionBranch ?? 'main'),
					expected: current.productionBranch ?? 'main',
					observed: project?.production_branch ?? null,
					issues: (project?.production_branch ?? current.productionBranch ?? 'main') === (current.productionBranch ?? 'main') ? [] : ['Pages production branch does not match the desired value.'],
				}));
			}
			for (const [name, expectedValue] of expectedVars) {
				checks.push(verificationCheck(`pages.var:${name}`, `Pages variable ${name} exists with the expected value`, 'api', {
					exists: Boolean(envVars[name]),
					configured: envVars[name]?.value === expectedValue,
					expected: expectedValue,
					observed: envVars[name]?.value ?? null,
					issues: envVars[name]?.value === expectedValue ? [] : [`Pages variable ${name} does not match the expected value for ${branchKey}.`],
				}));
			}
			for (const name of sync.secretNames) {
				checks.push(verificationCheck(`pages.secret:${name}`, `Pages secret ${name} exists`, 'api', {
					exists: Boolean(envVars[name]),
					expected: true,
					observed: Boolean(envVars[name]),
					issues: envVars[name] ? [] : [`Pages secret ${name} is missing from the ${branchKey} deployment config.`],
				}));
			}
			return summarizeVerification(input.unit.unitId, checks);
		}
		default:
			return unsupportedVerification(input.unit.unitId, `Cloudflare unit type ${input.unit.unitType} does not declare verification logic.`);
	}
}

function verifyCloudflareUnit(input: TreeseedReconcileAdapterInput, postconditions: TreeseedUnitPostcondition[]): TreeseedUnitVerificationResult {
	let attempt = 0;
	for (;;) {
		try {
			return verifyCloudflareUnitOnce(input, postconditions);
		} catch (error) {
			if (attempt >= 2 || !isTransientCloudflareReconcileError(error)) {
				throw error;
			}
			attempt += 1;
			sleepMs(500 * attempt);
		}
	}
}

function buildCloudflareDiff(input: TreeseedReconcileAdapterInput, observed: TreeseedObservedUnitState): TreeseedReconcileUnitDiff {
	if (!observed.exists) {
		return {
			action: 'create',
			reasons: ['resource missing'],
			before: observed.live,
			after: input.unit.spec,
		};
	}
	const locatorValues = Object.values(observed.locators).filter(Boolean);
	return {
		action: locatorValues.length > 0 ? 'reuse' : 'update',
		reasons: locatorValues.length > 0 ? ['resource already present'] : ['resource partially configured'],
		before: observed.live,
		after: input.unit.spec,
	};
}

function reconcileCloudflareUnit(input: TreeseedReconcileAdapterInput, diff: TreeseedReconcileUnitDiff): TreeseedReconcileResult {
	const cacheKey = `cloudflare:reconcile:${input.unit.target.kind === 'persistent' ? input.unit.target.scope : input.unit.target.branchName}`;
	const { state } = providerCache(input, cacheKey, () => {
		let attempt = 0;
		for (;;) {
			try {
				const reconciled = reconcileCloudflareTarget(input);
				syncCloudflareSecretsForTarget(input);
				syncPagesEnvironmentVariablesForTarget(input);
				return reconciled;
			} catch (error) {
				if (attempt >= 2 || !isTransientCloudflareReconcileError(error)) {
					throw error;
				}
				attempt += 1;
				sleepMs(500 * attempt);
			}
		}
	});
	const refreshed = observeCloudflareUnit(input);
	return {
		unit: input.unit,
		observed: refreshed,
		diff,
		action: diff.action === 'create' || diff.action === 'update' ? 'drift_correct' : diff.action,
		warnings: refreshed.warnings,
		resourceLocators: refreshed.locators,
		state: input.unit.unitType === 'edge-worker'
			? { workerName: state.workerName, lastDeployedUrl: state.lastDeployedUrl ?? null }
			: refreshed.live,
	};
}

function buildCloudflareAdapter(unitType: TreeseedReconcileUnitType): TreeseedReconcileAdapter {
	return {
		providerId: 'cloudflare',
		unitTypes: [unitType],
		supports(candidateUnitType, providerId) {
			return providerId === 'cloudflare' && candidateUnitType === unitType;
		},
		observe(input) {
			return observeCloudflareUnit(input);
		},
		requiredPostconditions(input) {
			switch (input.unit.unitType) {
				case 'queue':
					return [
						{ key: 'queue.exists', description: 'Queue exists by name and id' },
						{ key: 'queue.dlq', description: 'Dead-letter queue exists by name and id when configured' },
						{ key: 'queue.binding', description: 'Queue binding matches desired config' },
					];
				case 'database':
					return [
						{ key: 'database.exists', description: 'D1 database exists by name and id' },
						{ key: 'database.binding', description: 'D1 binding matches desired config' },
					];
				case 'kv-form-guard':
				case 'kv-session':
					return [
						{ key: 'kv.exists', description: 'KV namespace exists by title and id' },
						{ key: 'kv.binding', description: 'KV binding matches desired config' },
					];
				case 'content-store':
					return [
						{ key: 'r2.exists', description: 'R2 bucket exists by name' },
						{ key: 'r2.binding', description: 'R2 binding matches desired config' },
					];
				case 'pages-project':
					return [
						{ key: 'pages.exists', description: 'Pages project exists' },
						{ key: 'pages.production-branch', description: 'Pages production branch matches desired config' },
					];
				case 'edge-worker':
					return [
						{ key: 'edge-worker.generated', description: 'Generated web runtime metadata exists' },
					];
				default:
					return [];
			}
		},
		plan(input) {
			return buildCloudflareDiff(input, input.observed);
		},
		reconcile(input) {
			return reconcileCloudflareUnit(input, input.diff);
		},
		verify(input) {
			return verifyCloudflareUnit(input, input.postconditions);
		},
		destroy(input) {
			const cacheKey = `cloudflare:destroy:${input.unit.target.kind === 'persistent' ? input.unit.target.scope : input.unit.target.branchName}`;
			providerCache(input, cacheKey, () => destroyCloudflareResources(input.context.tenantRoot, { target: toDeployTarget(input.context.target) }));
			return {
				unit: input.unit,
				observed: input.observed,
				diff: {
					action: 'destroy',
					reasons: ['target destroyed'],
					before: input.observed.live,
					after: {},
				},
				action: 'destroy',
				warnings: [],
				resourceLocators: {},
				state: {},
				verification: null,
			};
		},
	};
}

function relativeRailwayRootDir(tenantRoot: string, serviceRoot: string) {
	const resolved = relative(tenantRoot, serviceRoot).replace(/\\/gu, '/');
	return !resolved || resolved === '' ? '.' : resolved;
}

async function resolveRailwayTopologyForScope(
	input: TreeseedReconcileAdapterInput,
	scope: 'local' | 'staging' | 'prod',
	{
		ensure = false,
		refresh = false,
		serviceKeys,
		includeInstances = ensure,
		includeVariables = false,
	}: {
		ensure?: boolean;
		refresh?: boolean;
		serviceKeys?: string[];
		includeInstances?: boolean;
		includeVariables?: boolean;
	} = {},
) {
	const normalizedServiceKeys = Array.isArray(serviceKeys) && serviceKeys.length > 0
		? [...new Set(serviceKeys.map((value) => String(value).trim()).filter(Boolean))].sort()
		: ['__all__'];
	const cacheKey = `railway:topology:${scope}:${ensure ? 'ensure' : 'observe'}:${includeInstances ? 'instances' : 'no-instances'}:${includeVariables ? 'variables' : 'no-variables'}:${normalizedServiceKeys.join(',')}`;
	return await providerCache(input, cacheKey, async () => {
		const env = buildRailwayEnv(input, scope);
		const deployState = loadDeployState(input.context.tenantRoot, input.context.deployConfig, { target: toDeployTarget(input.context.target) });
		const services = configuredRailwayServices(input.context.tenantRoot, scope)
			.filter((service) => normalizedServiceKeys.includes('__all__') || normalizedServiceKeys.includes(service.key));
		let workspace = null as Awaited<ReturnType<typeof resolveRailwayWorkspaceContext>> | null;
		const knownProjects: Array<Awaited<ReturnType<typeof getRailwayProject>>> = [];
		const knownProjectIds = [...new Set(services
			.map((service) => service.projectId || deployState.services?.[service.key]?.projectId || '')
			.filter((value) => typeof value === 'string' && value.trim().length > 0)
			.map((value) => value.trim()))];
		for (const projectId of knownProjectIds) {
			const project = await getRailwayProject({ projectId, env });
			if (project) {
				knownProjects.push(project);
			}
		}
		if (knownProjects.length === 0 || services.some((service) => !(service.projectId || deployState.services?.[service.key]?.projectId))) {
			workspace = await resolveRailwayWorkspaceContext({ env });
			const listedProjects = await listRailwayProjects({
				env,
				workspaceId: workspace.id,
			});
			for (const project of listedProjects) {
				if (!knownProjects.find((entry) => entry?.id === project.id)) {
					knownProjects.push(project);
				}
			}
		}
		const projectsByKey = new Map<string, (typeof knownProjects)[number]>();
		for (const project of knownProjects) {
			if (!project) {
				continue;
			}
			projectsByKey.set(project.id, project);
			projectsByKey.set(project.name, project);
		}
		const resolvedServices = new Map<string, {
			configuredService: ReturnType<typeof configuredRailwayServices>[number];
			project: Awaited<ReturnType<typeof ensureRailwayProject>>['project'] | null;
			environment: Awaited<ReturnType<typeof ensureRailwayEnvironment>>['environment'] | null;
			service: Awaited<ReturnType<typeof ensureRailwayService>>['service'] | null;
			instance: Awaited<ReturnType<typeof getRailwayServiceInstance>> | null;
			currentVariables: Record<string, string | null>;
		}>();

		for (const service of services) {
			const persistedService = deployState.services?.[service.key] ?? {};
			const resolvedProjectId = service.projectId ?? persistedService.projectId ?? '';
			const resolvedProjectName = service.projectName ?? persistedService.projectName ?? '';
			const resolvedServiceId = service.serviceId ?? persistedService.serviceId ?? '';
			const resolvedServiceName = service.serviceName ?? persistedService.serviceName ?? '';
			let project = projectsByKey.get(resolvedProjectId)
				?? projectsByKey.get(resolvedProjectName)
				?? null;
			if (!project && ensure) {
				if (!workspace) {
					workspace = await resolveRailwayWorkspaceContext({ env });
				}
				const ensuredProject = await ensureRailwayProject({
					projectId: resolvedProjectId,
					projectName: resolvedProjectName,
					defaultEnvironmentName: service.railwayEnvironment || 'staging',
					env,
					workspace: workspace.name,
				});
				project = ensuredProject.project;
				projectsByKey.set(project.id, project);
				projectsByKey.set(project.name, project);
			}

			let environment = project?.environments.find((entry) => entry.name === service.railwayEnvironment || entry.id === service.railwayEnvironment) ?? null;
			if (project && !environment && ensure) {
				environment = (await ensureRailwayEnvironment({
					projectId: project.id,
					environmentName: service.railwayEnvironment,
					env,
				})).environment;
				project = {
					...project,
					environments: [...project.environments.filter((entry) => entry.id !== environment?.id), environment],
				};
				projectsByKey.set(project.id, project);
				projectsByKey.set(project.name, project);
			}

			let resolvedService = project?.services.find((entry) => entry.id === resolvedServiceId || entry.name === resolvedServiceName) ?? null;
			if (project && !resolvedService && ensure) {
				resolvedService = (await ensureRailwayService({
					projectId: project.id,
					serviceId: resolvedServiceId,
					serviceName: resolvedServiceName,
					env,
				})).service;
				project = {
					...project,
					services: [...project.services.filter((entry) => entry.id !== resolvedService?.id), resolvedService],
				};
				projectsByKey.set(project.id, project);
				projectsByKey.set(project.name, project);
			}

			let instance = null;
			if (includeInstances && resolvedService && environment) {
				if (ensure) {
					instance = (await ensureRailwayServiceInstanceConfiguration({
						serviceId: resolvedService.id,
						environmentId: environment.id,
						buildCommand: service.buildCommand,
						startCommand: service.startCommand,
						rootDirectory: relativeRailwayRootDir(input.context.tenantRoot, service.rootDir),
						healthcheckPath: service.healthcheckPath,
						healthcheckTimeoutSeconds: service.healthcheckTimeoutSeconds,
						healthcheckIntervalSeconds: service.healthcheckIntervalSeconds,
						restartPolicy: service.restartPolicy,
						runtimeMode: service.runtimeMode,
						env,
					})).instance;
				} else {
					instance = await getRailwayServiceInstance({
						serviceId: resolvedService.id,
						environmentId: environment.id,
						env,
					});
				}
			}

			const currentVariables = includeVariables && project && environment && resolvedService
				? await listRailwayVariables({
					projectId: project.id,
					environmentId: environment.id,
					serviceId: resolvedService.id,
					env,
				})
				: {};

			resolvedServices.set(service.key, {
				configuredService: service,
				project,
				environment,
				service: resolvedService,
				instance,
				currentVariables,
			});
		}

		return {
			scope,
			env,
			workspace: workspace ?? {
				id: '',
				name: String(env.TREESEED_RAILWAY_WORKSPACE ?? '').trim(),
			},
			services: resolvedServices,
		};
	}, refresh);
}

async function syncRailwayEnvironmentForScope(input: TreeseedReconcileAdapterInput, { dryRun = false } = {}) {
	const scope = input.context.target.kind === 'persistent' ? input.context.target.scope : 'staging';
	const sync = collectRailwayEnvironmentSync(input);
	const topology = await resolveRailwayTopologyForScope(input, scope, {
		ensure: !dryRun,
		includeInstances: !dryRun,
		includeVariables: false,
	});
	const workerEntry = topology.services.get('worker') ?? null;
	const railwayRuntimeVariables = Object.fromEntries(
		[
			['TREESEED_RAILWAY_PROJECT_ID', workerEntry?.project?.id],
			['TREESEED_RAILWAY_ENVIRONMENT_ID', workerEntry?.environment?.id],
			['TREESEED_RAILWAY_WORKER_SERVICE_ID', workerEntry?.service?.id],
		].filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0),
	);
	if (!dryRun) {
		const combinedVariables = {
			...sync.variables,
			...railwayRuntimeVariables,
			...sync.secrets,
		};
		for (const entry of topology.services.values()) {
			if (!entry.project || !entry.environment || !entry.service) {
				continue;
			}
			await upsertRailwayVariables({
				projectId: entry.project.id,
				environmentId: entry.environment.id,
				serviceId: entry.service.id,
				variables: combinedVariables,
				env: topology.env,
			});
		}
	}
	return {
		scope,
		services: [...topology.services.values()].map((entry) => entry.configuredService),
		secrets: Object.keys(sync.secrets),
		variables: Object.keys(sync.variables),
		dryRun,
		workspace: topology.workspace.name,
	};
}

async function observeRailwayUnit(input: TreeseedReconcileAdapterInput, { refresh = false }: { refresh?: boolean } = {}): Promise<TreeseedObservedUnitState> {
	let attempt = 0;
	for (;;) {
		try {
			const scope = input.context.target.kind === 'persistent' ? input.context.target.scope : 'staging';
			const serviceKey = String(input.unit.metadata.serviceKey ?? '').trim();
			const state = loadDeployState(input.context.tenantRoot, input.context.deployConfig, { target: toDeployTarget(input.context.target) });
			const persisted = state.services?.[serviceKey] ?? {};
			const topology = await resolveRailwayTopologyForScope(input, scope, {
				refresh,
				serviceKeys: [serviceKey],
				includeInstances: false,
				includeVariables: false,
			});
			const entry = topology.services.get(serviceKey) ?? null;
			const configured = Boolean(
				entry?.configuredService
				&& (entry.configuredService.serviceName || entry.configuredService.serviceId)
				&& (entry.configuredService.projectName || entry.configuredService.projectId)
				&& existsSync(resolve(entry.configuredService.rootDir)),
			);
			return {
				exists: Boolean(entry?.configuredService),
				status: entry?.project && entry?.environment && entry?.service && configured ? 'ready' : 'pending',
				live: {
					...(persisted ?? {}),
					...(entry?.configuredService ?? {}),
					project: entry?.project ?? null,
					environment: entry?.environment ?? null,
					service: entry?.service ?? null,
					instance: entry?.instance ?? null,
				},
				locators: {
					projectId: entry?.project?.id ?? entry?.configuredService.projectId ?? persisted.projectId ?? null,
					serviceId: entry?.service?.id ?? entry?.configuredService.serviceId ?? persisted.serviceId ?? null,
					serviceName: entry?.service?.name ?? entry?.configuredService.serviceName ?? persisted.serviceName ?? null,
					publicBaseUrl: entry?.configuredService.publicBaseUrl ?? persisted.publicBaseUrl ?? null,
					workspace: topology.workspace.name,
				},
				warnings: [],
			};
		} catch (error) {
			if (attempt >= 2 || !isTransientRailwayReconcileError(error)) {
				throw error;
			}
			attempt += 1;
			sleepMs(1000 * attempt);
		}
	}
}

function collectRailwayEnvironmentSync(input: TreeseedReconcileAdapterInput) {
	const scope = input.context.target.kind === 'persistent' ? input.context.target.scope : 'staging';
	const values = resolveTreeseedMachineEnvironmentValues(input.context.tenantRoot, scope);
	const registry = collectTreeseedEnvironmentContext(input.context.tenantRoot);
	const state = loadDeployState(input.context.tenantRoot, input.context.deployConfig, { target: toDeployTarget(input.context.target) });
	const secrets = Object.fromEntries(
		registry.entries
			.filter((entry) => entry.scopes.includes(scope) && entry.targets.includes('railway-secret'))
			.map((entry) => [entry.id, values[entry.id]])
			.filter(([, value]) => typeof value === 'string' && value.length > 0),
	);
	const variables = Object.fromEntries(
		registry.entries
			.filter((entry) => entry.scopes.includes(scope) && entry.targets.includes('railway-var'))
			.map((entry) => [entry.id, values[entry.id]])
			.filter(([, value]) => typeof value === 'string' && value.length > 0),
	);

	if (typeof values.CLOUDFLARE_API_TOKEN === 'string' && values.CLOUDFLARE_API_TOKEN.length > 0) {
		secrets.CLOUDFLARE_API_TOKEN = values.CLOUDFLARE_API_TOKEN;
	}
	if (typeof values.CLOUDFLARE_ACCOUNT_ID === 'string' && values.CLOUDFLARE_ACCOUNT_ID.length > 0) {
		variables.CLOUDFLARE_ACCOUNT_ID = values.CLOUDFLARE_ACCOUNT_ID;
	}
	const apiD1DatabaseId = state.d1Databases?.SITE_DATA_DB?.databaseId;
	if (typeof apiD1DatabaseId === 'string' && apiD1DatabaseId.length > 0) {
		variables.TREESEED_API_D1_DATABASE_ID = apiD1DatabaseId;
	}

	return { scope, secrets, variables };
}

function buildAttachmentDiff(input: TreeseedReconcileAdapterInput, observed: TreeseedObservedUnitState): TreeseedReconcileUnitDiff {
	if (!observed.exists) {
		return {
			action: 'create',
			reasons: ['attachment missing'],
			before: observed.live,
			after: input.unit.spec,
		};
	}
	return {
		action: observed.status === 'ready' ? 'reuse' : 'update',
		reasons: observed.status === 'ready' ? ['attachment already present'] : ['attachment requires update'],
		before: observed.live,
		after: input.unit.spec,
	};
}

function resolveDesiredDnsRecords(input: TreeseedReconcileAdapterInput) {
	if (typeof input.unit.spec.recordType === 'string' && typeof input.unit.spec.recordContent === 'string' && typeof input.unit.spec.recordName === 'string') {
		return [{
			type: String(input.unit.spec.recordType).toUpperCase(),
			name: String(input.unit.spec.recordName),
			content: String(input.unit.spec.recordContent),
			status: '',
			proxied: typeof input.unit.spec.proxied === 'boolean' ? input.unit.spec.proxied : undefined,
		}];
	}
	const domain = typeof input.unit.spec.domain === 'string' ? input.unit.spec.domain : '';
	if (!domain) {
		return [];
	}
	const railwayState = getCustomDomainState(input, 'railway', domain)
		?? (input.persistedState?.lastObservedState as Record<string, unknown> | undefined)
		?? (input.persistedState?.lastReconciledState as Record<string, unknown> | undefined);
	const records = Array.isArray(railwayState?.dnsRecords)
		? railwayState.dnsRecords.map((entry) => normalizeRailwayDomainDnsRecord(entry)).filter(Boolean)
		: [];
	const desiredRecords = records.map((record) => ({
		...record,
		proxied: false,
	}));
	const verificationDnsHost = typeof railwayState?.verificationDnsHost === 'string'
		? railwayState.verificationDnsHost.trim()
		: '';
	const verificationToken = typeof railwayState?.verificationToken === 'string'
		? railwayState.verificationToken.trim()
		: '';
	if (verificationDnsHost && verificationToken) {
		const verificationName = verificationDnsHost.endsWith(`.${domain}`)
			? verificationDnsHost
			: `${verificationDnsHost}.${domain.split('.').slice(-2).join('.')}`;
		desiredRecords.push({
			type: 'TXT',
			name: verificationName,
			content: verificationToken,
			status: '',
			proxied: false,
		});
	}
	return desiredRecords;
}

function observeCustomDomainUnit(input: TreeseedReconcileAdapterInput): TreeseedObservedUnitState {
	switch (input.unit.unitType) {
		case 'custom-domain:web': {
			const env = buildCloudflareEnv(input);
			const domain = String(input.unit.spec.domain ?? '').trim();
			const projectName = String(input.unit.spec.projectName ?? '').trim();
			const live = domain && projectName ? getCloudflarePagesDomain(env, projectName, domain) : null;
			if (live) {
				storeCustomDomainState(input, 'cloudflare', domain, live);
			}
			return {
				exists: Boolean(live?.name || live?.domain),
				status: live?.name || live?.domain ? 'ready' : 'pending',
				live: live ?? {},
				locators: {
					domain: domain || null,
					projectName: projectName || null,
				},
				warnings: [],
			};
		}
		case 'custom-domain:api': {
			const domain = String(input.unit.spec.domain ?? '').trim();
			const live = getCustomDomainState(input, 'railway', domain)
				?? (input.persistedState?.lastObservedState as Record<string, unknown> | undefined)
				?? (input.persistedState?.lastReconciledState as Record<string, unknown> | undefined)
				?? null;
			if (live?.domain) {
				storeCustomDomainState(input, 'railway', domain, live);
			}
			return {
				exists: Boolean(live?.domain),
				status: live?.domain ? 'ready' : 'pending',
				live: live ?? {},
				locators: {
					domain: domain || null,
					serviceDomain: typeof live?.serviceDomain === 'string' ? live.serviceDomain : null,
				},
				warnings: [],
			};
		}
		default:
			return noopObservedState(input);
	}
}

function observeDnsRecordUnit(input: TreeseedReconcileAdapterInput): TreeseedObservedUnitState {
	const env = buildCloudflareEnv(input);
	const domain = String(input.unit.spec.domain ?? '').trim();
	const zoneId = domain ? resolveCloudflareZoneIdForHost(input.context.deployConfig, domain, env) : null;
	const desiredRecords = resolveDesiredDnsRecords(input);
	const liveRecords = zoneId
		? desiredRecords.map((record) =>
			listCloudflareDnsRecords(env, zoneId, record.name)
				.find((entry) => entry?.name === record.name && entry?.type === record.type) ?? null,
		)
		: [];
	const matches = desiredRecords.length > 0 && liveRecords.every((entry, index) =>
		Boolean(entry)
		&& entry?.content === desiredRecords[index]?.content
		&& (
			desiredRecords[index]?.proxied === undefined
			|| Boolean(entry?.proxied) === Boolean(desiredRecords[index]?.proxied)
		),
	);
	return {
		exists: desiredRecords.length > 0 && liveRecords.every(Boolean),
		status: matches ? 'ready' : 'pending',
		live: {
			zoneId,
			records: liveRecords.filter(Boolean),
		},
		locators: {
			zoneId,
		},
		warnings: desiredRecords.length === 0 ? ['No desired DNS records were available for verification.'] : [],
	};
}

function verifyCustomDomainUnit(input: TreeseedReconcileAdapterInput): TreeseedUnitVerificationResult {
	switch (input.unit.unitType) {
		case 'custom-domain:web': {
			const domain = String(input.unit.spec.domain ?? '').trim();
			const projectName = String(input.unit.spec.projectName ?? '').trim();
			const env = buildCloudflareEnv(input);
			const live = domain && projectName ? getCloudflarePagesDomain(env, projectName, domain) : null;
			return summarizeVerification(input.unit.unitId, [
				verificationCheck('custom-domain.exists', 'Pages custom domain attachment exists', 'api', {
					exists: Boolean(live?.name || live?.domain),
					expected: domain || null,
					observed: live?.name ?? live?.domain ?? null,
					issues: live?.name || live?.domain ? [] : [`Cloudflare Pages custom domain ${domain || '(unset)'} is missing.`],
				}),
			]);
		}
		case 'custom-domain:api': {
			const domain = String(input.unit.spec.domain ?? '').trim();
			const live = getCustomDomainState(input, 'railway', domain)
				?? (input.persistedState?.lastObservedState as Record<string, unknown> | undefined)
				?? (input.persistedState?.lastReconciledState as Record<string, unknown> | undefined)
				?? null;
			const dnsRecords = Array.isArray(live?.dnsRecords) ? live.dnsRecords : [];
			return summarizeVerification(input.unit.unitId, [
				verificationCheck('custom-domain.exists', 'Railway custom domain attachment exists', 'cli', {
					exists: Boolean(live?.domain),
					expected: domain || null,
					observed: typeof live?.domain === 'string' ? live.domain : null,
					issues: live?.domain ? [] : [`Railway custom domain ${domain || '(unset)'} is missing.`],
				}),
				verificationCheck('custom-domain.dns-requirements', 'Railway custom domain exposes DNS requirements', 'api', {
					exists: dnsRecords.length > 0,
					expected: true,
					observed: dnsRecords.length,
					issues: dnsRecords.length > 0 ? [] : [`Railway custom domain ${domain || '(unset)'} did not expose DNS requirements.`],
				}),
			]);
		}
		default:
			return unsupportedVerification(input.unit.unitId, `Unsupported custom-domain unit type ${input.unit.unitType}.`);
	}
}

function verifyDnsRecordUnit(input: TreeseedReconcileAdapterInput): TreeseedUnitVerificationResult {
	const env = buildCloudflareEnv(input);
	const domain = String(input.unit.spec.domain ?? '').trim();
	const zoneId = domain ? resolveCloudflareZoneIdForHost(input.context.deployConfig, domain, env) : null;
	const desiredRecords = resolveDesiredDnsRecords(input);
	if (!zoneId) {
		return unsupportedVerification(input.unit.unitId, `Cloudflare DNS zone could not be resolved for ${domain || '(unset)'}.`);
	}
	if (desiredRecords.length === 0 && input.unit.spec.targetKind === 'railway-service') {
		return summarizeVerification(input.unit.unitId, [
			verificationCheck('dns-record.requirements', 'Railway custom domain exposes DNS requirements', 'api', {
				exists: false,
				expected: true,
				observed: 0,
				issues: [`Railway custom domain ${domain || '(unset)'} did not expose DNS requirements, so Cloudflare DNS records could not be created.`],
			}),
		]);
	}
	const checks = desiredRecords.map((record, index) => {
		const live = listCloudflareDnsRecords(env, zoneId, record.name)
			.find((entry) => entry?.name === record.name && entry?.type === record.type) ?? null;
		const proxiedMatches = record.proxied === undefined ? true : Boolean(live?.proxied) === Boolean(record.proxied);
		return verificationCheck(`dns-record:${index + 1}`, `DNS record ${record.type} ${record.name} matches the desired value`, 'api', {
			exists: Boolean(live?.id),
			configured: live?.content === record.content && proxiedMatches,
			expected: `${record.type} ${record.name} -> ${record.content}${record.proxied === undefined ? '' : ` proxied=${record.proxied}`}`,
			observed: live ? `${live.type} ${live.name} -> ${live.content}${typeof live.proxied === 'boolean' ? ` proxied=${live.proxied}` : ''}` : null,
			issues: live?.id
				? ((live.content === record.content && proxiedMatches) ? [] : [`DNS record ${record.name} does not match the expected value.`])
				: [`DNS record ${record.type} ${record.name} is missing.`],
		});
	});
	return summarizeVerification(input.unit.unitId, checks);
}

async function reconcileCustomDomainUnit(input: TreeseedReconcileAdapterInput, diff: TreeseedReconcileUnitDiff): Promise<TreeseedReconcileResult> {
	switch (input.unit.unitType) {
		case 'custom-domain:web': {
			const env = buildCloudflareEnv(input);
			const domain = String(input.unit.spec.domain ?? '').trim();
			const projectName = String(input.unit.spec.projectName ?? '').trim();
			const state = ensureCloudflarePagesDomain(env, projectName, domain) ?? { domain };
			storeCustomDomainState(input, 'cloudflare', domain, state);
			const observed = observeCustomDomainUnit(input);
			return {
				unit: input.unit,
				observed,
				diff,
				action: diff.action === 'create' || diff.action === 'update' ? 'drift_correct' : diff.action,
				warnings: observed.warnings,
				resourceLocators: observed.locators,
				state,
				verification: null,
			};
		}
		case 'custom-domain:api': {
			const scope = input.context.target.kind === 'persistent' ? input.context.target.scope : 'staging';
			const serviceKey = String(input.unit.metadata.serviceKey ?? 'api').trim();
			const topology = await resolveRailwayTopologyForScope(input, scope, {
				ensure: true,
				serviceKeys: [serviceKey],
				includeInstances: false,
				includeVariables: false,
			});
			const entry = topology.services.get(serviceKey) ?? null;
			if (!entry?.configuredService) {
				throw new Error(`Railway service ${serviceKey} is not configured for custom domain reconciliation.`);
			}
			const state = await ensureRailwayCustomDomain(
				input,
				entry.configuredService,
				String(input.unit.spec.domain ?? '').trim(),
				topology.env,
				{
					projectId: entry.project?.id ?? null,
					environmentId: entry.environment?.id ?? null,
					serviceId: entry.service?.id ?? null,
				},
			);
			storeCustomDomainState(input, 'railway', String(input.unit.spec.domain ?? '').trim(), state);
			const observed = observeCustomDomainUnit(input);
			return {
				unit: input.unit,
				observed,
				diff,
				action: diff.action === 'create' || diff.action === 'update' ? 'drift_correct' : diff.action,
				warnings: observed.warnings,
				resourceLocators: observed.locators,
				state,
				verification: null,
			};
		}
		default:
			throw new Error(`Unsupported custom-domain unit type ${input.unit.unitType}.`);
	}
}

function reconcileDnsRecordUnit(input: TreeseedReconcileAdapterInput, diff: TreeseedReconcileUnitDiff): TreeseedReconcileResult {
	let attempt = 0;
	for (;;) {
		try {
			const env = buildCloudflareEnv(input);
			const domain = String(input.unit.spec.domain ?? '').trim();
			const zoneId = resolveCloudflareZoneIdForHost(input.context.deployConfig, domain, env);
			if (!zoneId) {
				throw new Error(`Cloudflare DNS zone could not be resolved for ${domain || '(unset)'}.`);
			}
			const desiredRecords = resolveDesiredDnsRecords(input);
			const created = desiredRecords.map((record) => ensureCloudflareDnsRecord(env, zoneId, record));
			const observed = observeDnsRecordUnit(input);
			return {
				unit: input.unit,
				observed,
				diff,
				action: diff.action === 'create' || diff.action === 'update' ? 'drift_correct' : diff.action,
				warnings: observed.warnings,
				resourceLocators: observed.locators,
				state: {
					zoneId,
					records: created,
				},
				verification: null,
			};
		} catch (error) {
			if (attempt >= 2 || !isTransientCloudflareReconcileError(error)) {
				throw error;
			}
			attempt += 1;
			sleepMs(500 * attempt);
		}
	}
}

async function verifyRailwayUnit(input: TreeseedReconcileAdapterInput): Promise<TreeseedUnitVerificationResult> {
	let attempt = 0;
	for (;;) {
		try {
			const scope = input.context.target.kind === 'persistent' ? input.context.target.scope : 'staging';
			const serviceKey = String(input.unit.metadata.serviceKey ?? '').trim();
			const topology = await resolveRailwayTopologyForScope(input, scope, {
				serviceKeys: [serviceKey],
				includeInstances: true,
				includeVariables: true,
			});
			const entry = topology.services.get(serviceKey) ?? null;
			const service = entry?.configuredService ?? null;
			if (!service || !entry) {
				return summarizeVerification(input.unit.unitId, [
					verificationCheck('railway.service', 'Railway service exists in the desired topology', 'sdk', {
						exists: false,
						issues: [`Railway service ${serviceKey} is not configured for ${scope}.`],
					}),
				]);
			}
			const sync = collectRailwayEnvironmentSync(input);
			const checks: TreeseedUnitVerificationCheck[] = [
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
	if (service.startCommand) {
		checks.push(verificationCheck('railway.instance.start-command', 'Railway start command matches desired config', 'api', {
			exists: Boolean(entry.instance?.id),
			configured: entry.instance?.startCommand === service.startCommand,
			expected: service.startCommand,
			observed: entry.instance?.startCommand ?? null,
			issues: entry.instance?.startCommand === service.startCommand ? [] : ['Railway start command does not match the desired value.'],
		}));
	}
	const desiredRootDirectory = relativeRailwayRootDir(input.context.tenantRoot, service.rootDir);
	if (desiredRootDirectory) {
		checks.push(verificationCheck('railway.instance.root-directory', 'Railway root directory matches desired config', 'api', {
			exists: Boolean(entry.instance?.id),
			configured: entry.instance?.rootDirectory === desiredRootDirectory,
			expected: desiredRootDirectory,
			observed: entry.instance?.rootDirectory ?? null,
			issues: entry.instance?.rootDirectory === desiredRootDirectory ? [] : ['Railway root directory does not match the desired value.'],
		}));
	}
	if (service.key === 'api') {
		if (service.healthcheckPath || service.healthcheckIntervalSeconds || service.healthcheckTimeoutSeconds || service.restartPolicy || service.runtimeMode) {
			if (entry.instance?.runtimeConfigSupported !== true) {
				return unsupportedVerification(
					input.unit.unitId,
					'Railway API service runtime settings are unsupported by the current Railway API schema.',
				);
			}
		}
		if (service.healthcheckPath) {
			checks.push(verificationCheck('railway.instance.healthcheck-path', 'Railway API healthcheck path matches desired config', 'api', {
				exists: Boolean(entry.instance?.id),
				configured: entry.instance?.healthcheckPath === service.healthcheckPath,
				expected: service.healthcheckPath,
				observed: entry.instance?.healthcheckPath ?? null,
				issues: entry.instance?.healthcheckPath === service.healthcheckPath ? [] : ['Railway API healthcheck path does not match the desired value.'],
			}));
		}
		if (service.healthcheckTimeoutSeconds !== null && service.healthcheckTimeoutSeconds !== undefined) {
			checks.push(verificationCheck('railway.instance.healthcheck-timeout', 'Railway API healthcheck timeout matches desired config', 'api', {
				exists: Boolean(entry.instance?.id),
				configured: entry.instance?.healthcheckTimeoutSeconds === service.healthcheckTimeoutSeconds,
				expected: service.healthcheckTimeoutSeconds,
				observed: entry.instance?.healthcheckTimeoutSeconds ?? null,
				issues: entry.instance?.healthcheckTimeoutSeconds === service.healthcheckTimeoutSeconds ? [] : ['Railway API healthcheck timeout does not match the desired value.'],
			}));
		}
		if (service.healthcheckIntervalSeconds !== null && service.healthcheckIntervalSeconds !== undefined) {
			checks.push(verificationCheck('railway.instance.healthcheck-interval', 'Railway API healthcheck interval matches desired config', 'api', {
				exists: Boolean(entry.instance?.id),
				configured: entry.instance?.healthcheckIntervalSeconds === service.healthcheckIntervalSeconds,
				expected: service.healthcheckIntervalSeconds,
				observed: entry.instance?.healthcheckIntervalSeconds ?? null,
				issues: entry.instance?.healthcheckIntervalSeconds === service.healthcheckIntervalSeconds ? [] : ['Railway API healthcheck interval does not match the desired value.'],
			}));
		}
		if (service.restartPolicy) {
			checks.push(verificationCheck('railway.instance.restart-policy', 'Railway API restart policy matches desired config', 'api', {
				exists: Boolean(entry.instance?.id),
				configured: entry.instance?.restartPolicy === service.restartPolicy,
				expected: service.restartPolicy,
				observed: entry.instance?.restartPolicy ?? null,
				issues: entry.instance?.restartPolicy === service.restartPolicy ? [] : ['Railway API restart policy does not match the desired value.'],
			}));
		}
		if (service.runtimeMode) {
			checks.push(verificationCheck('railway.instance.runtime-mode', 'Railway API runtime mode matches desired config', 'api', {
				exists: Boolean(entry.instance?.id),
				configured: entry.instance?.runtimeMode === service.runtimeMode,
				expected: service.runtimeMode,
				observed: entry.instance?.runtimeMode ?? null,
				issues: entry.instance?.runtimeMode === service.runtimeMode ? [] : ['Railway API runtime mode does not match the desired value.'],
			}));
		}
	}
	for (const [key, value] of Object.entries(sync.variables)) {
		checks.push(verificationCheck(`railway.var:${key}`, `Railway variable ${key} exists with the expected value`, 'api', {
			exists: Object.hasOwn(entry.currentVariables, key),
			configured: entry.currentVariables[key] === value,
			expected: value,
			observed: entry.currentVariables[key] ?? null,
			issues: entry.currentVariables[key] === value ? [] : [`Railway variable ${key} does not match the expected value.`],
		}));
	}
	for (const key of Object.keys(sync.secrets)) {
		checks.push(verificationCheck(`railway.secret:${key}`, `Railway secret ${key} exists`, 'api', {
			exists: Object.hasOwn(entry.currentVariables, key),
			expected: true,
			observed: Object.hasOwn(entry.currentVariables, key),
			issues: Object.hasOwn(entry.currentVariables, key) ? [] : [`Railway secret ${key} is missing.`],
		}));
	}
			return summarizeVerification(input.unit.unitId, checks);
		} catch (error) {
			if (attempt >= 2 || !isTransientRailwayReconcileError(error)) {
				throw error;
			}
			attempt += 1;
			sleepMs(1000 * attempt);
		}
	}
}

function buildRailwayDiff(input: TreeseedReconcileAdapterInput, observed: TreeseedObservedUnitState): TreeseedReconcileUnitDiff {
	if (!observed.exists) {
		return {
			action: 'create',
			reasons: ['service missing from configured topology'],
			before: observed.live,
			after: input.unit.spec,
		};
	}
	return {
		action: observed.status === 'ready' ? 'reuse' : 'update',
		reasons: observed.status === 'ready' ? ['service already configured'] : ['service requires configuration sync'],
		before: observed.live,
		after: input.unit.spec,
	};
}

async function reconcileRailwayUnit(input: TreeseedReconcileAdapterInput, diff: TreeseedReconcileUnitDiff): Promise<TreeseedReconcileResult> {
	const scope = input.context.target.kind === 'persistent' ? input.context.target.scope : 'staging';
	const cacheKey = `railway:sync:${scope}`;
	await providerCache(input, cacheKey, async () => {
		const synced = await syncRailwayEnvironmentForScope(input);
		return synced;
	});
	for (const key of input.context.session.keys()) {
		if (key.startsWith(`railway:topology:${scope}:`)) {
			input.context.session.delete(key);
		}
	}
	const refreshed = await observeRailwayUnit(input, { refresh: true });
	return {
		unit: input.unit,
		observed: refreshed,
		diff,
		action: diff.action === 'update' || diff.action === 'create' ? 'drift_correct' : diff.action,
		warnings: refreshed.warnings,
		resourceLocators: refreshed.locators,
		state: refreshed.live,
		verification: null,
	};
}

function buildRailwayAdapter(unitType: TreeseedReconcileUnitType): TreeseedReconcileAdapter {
	return {
		providerId: 'railway',
		unitTypes: [unitType],
		supports(candidateUnitType, providerId) {
			return providerId === 'railway' && candidateUnitType === unitType;
		},
		validate(input) {
			const scope = input.context.target.kind === 'persistent' ? input.context.target.scope : 'staging';
			validateRailwayDeployPrerequisites(input.context.tenantRoot, scope, {
				env: buildRailwayEnv(input, scope),
			});
		},
		observe(input) {
			return observeRailwayUnit(input);
		},
		plan(input) {
			return buildRailwayDiff(input, input.observed);
		},
		reconcile(input) {
			return reconcileRailwayUnit(input, input.diff);
		},
		requiredPostconditions() {
			return [
				{ key: 'railway.project', description: 'Railway project exists' },
				{ key: 'railway.service', description: 'Railway service exists' },
				{ key: 'railway.environment', description: 'Railway environment exists' },
			];
		},
		verify(input) {
			return verifyRailwayUnit(input);
		},
	};
}

function buildCustomDomainAdapter(unitType: 'custom-domain:web' | 'custom-domain:api', providerId: 'cloudflare' | 'railway'): TreeseedReconcileAdapter {
	return {
		providerId,
		unitTypes: [unitType],
		supports(candidateUnitType, candidateProviderId) {
			return candidateUnitType === unitType && candidateProviderId === providerId;
		},
		validate(input) {
			if (providerId === 'railway') {
				const scope = input.context.target.kind === 'persistent' ? input.context.target.scope : 'staging';
				validateRailwayDeployPrerequisites(input.context.tenantRoot, scope, {
					env: buildRailwayEnv(input, scope),
				});
			}
		},
		observe(input) {
			return observeCustomDomainUnit(input);
		},
		requiredPostconditions() {
			return [
				{ key: 'custom-domain.exists', description: 'Custom domain attachment exists' },
				...(providerId === 'railway'
					? [{ key: 'custom-domain.dns-requirements', description: 'Custom domain exposes DNS requirements' }]
					: []),
			];
		},
		plan(input) {
			return buildAttachmentDiff(input, input.observed);
		},
		reconcile(input) {
			return reconcileCustomDomainUnit(input, input.diff);
		},
		verify(input) {
			return verifyCustomDomainUnit(input);
		},
	};
}

function buildDnsRecordAdapter(): TreeseedReconcileAdapter {
	return {
		providerId: 'cloudflare-dns',
		unitTypes: ['dns-record'],
		supports(candidateUnitType, providerId) {
			return candidateUnitType === 'dns-record' && providerId === 'cloudflare-dns';
		},
		observe(input) {
			return observeDnsRecordUnit(input);
		},
		requiredPostconditions(input) {
			const desired = resolveDesiredDnsRecords(input);
			return desired.map((record, index) => ({
				key: `dns-record:${index + 1}`,
				description: `DNS record ${record.type} ${record.name} matches the desired value`,
			}));
		},
		plan(input) {
			return buildAttachmentDiff(input, input.observed);
		},
		reconcile(input) {
			return reconcileDnsRecordUnit(input, input.diff);
		},
		verify(input) {
			return verifyDnsRecordUnit(input);
		},
	};
}

export function createCloudflareReconcileAdapters() {
	return [
		buildCloudflareAdapter('queue'),
		buildCloudflareAdapter('database'),
		buildCloudflareAdapter('content-store'),
		buildCloudflareAdapter('kv-form-guard'),
		buildCloudflareAdapter('kv-session'),
		buildCloudflareAdapter('pages-project'),
		buildCloudflareAdapter('edge-worker'),
		buildCustomDomainAdapter('custom-domain:web', 'cloudflare'),
		buildDnsRecordAdapter(),
		buildCompositeAdapter('web-ui'),
	];
}

export function createRailwayReconcileAdapters() {
	return [
		buildRailwayAdapter('railway-service:api'),
		buildRailwayAdapter('railway-service:manager'),
		buildRailwayAdapter('railway-service:worker'),
		buildRailwayAdapter('railway-service:workday-start'),
		buildRailwayAdapter('railway-service:workday-report'),
		buildCustomDomainAdapter('custom-domain:api', 'railway'),
		buildCompositeAdapter('api-runtime'),
		buildCompositeAdapter('manager-runtime'),
		buildCompositeAdapter('worker-runtime'),
		buildCompositeAdapter('workday-start-runtime'),
		buildCompositeAdapter('workday-report-runtime'),
	];
}
