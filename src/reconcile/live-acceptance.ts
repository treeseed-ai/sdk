import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { join } from 'node:path';
import {
	createTreeseedCanonicalReconcileReport,
	type TreeseedCanonicalAction,
	type TreeseedCanonicalDrift,
	type TreeseedCanonicalGraphNode,
	type TreeseedCanonicalPostcondition,
	type TreeseedCanonicalReconcileReport,
} from './platform.ts';
import type { TreeseedDesiredResource } from '../platform/desired-state.ts';
import type { TreeseedReconcileSelector } from './contracts.ts';
import { runTreeseedGit } from '../operations/services/git-runner.ts';
import {
	deleteRailwayProject,
	deleteRailwayService,
	deleteRailwayVolume,
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
	railwayGraphqlRequest,
	resolveRailwayWorkspaceContext,
	upsertRailwayVariables,
} from '../operations/services/railway-api.ts';
import { resolveGitHubCredentialForRepository } from '../operations/services/github-credentials.ts';

export type TreeseedLiveReconcileProvider = 'railway' | 'cloudflare' | 'github' | 'local';
export type TreeseedLiveReconcileMode = 'smoke' | 'acceptance' | 'cleanup';
export type TreeseedLiveReconcileEnvironment = 'local' | 'staging' | 'prod';

export interface TreeseedLiveReconcileScenarioResult {
	id: string;
	provider: TreeseedLiveReconcileProvider;
	capability: string;
	mode: TreeseedLiveReconcileMode;
	ok: boolean;
	phase: 'smoke' | 'validate' | 'create' | 'update' | 'replace' | 'verify' | 'destroy' | 'cleanup' | 'blocked';
	action: TreeseedCanonicalAction['kind'];
	reason: string;
	startedAt: string;
	completedAt: string;
	durationMs: number;
	locators: Record<string, string | null>;
	createdResources: TreeseedCanonicalGraphNode[];
	updatedResources: TreeseedCanonicalGraphNode[];
	replacedResources: TreeseedCanonicalGraphNode[];
	destroyedResources: TreeseedCanonicalGraphNode[];
	retainedResources: TreeseedCanonicalGraphNode[];
	issues: string[];
}

export interface TreeseedLiveReconcileProviderReport {
	provider: TreeseedLiveReconcileProvider;
	mode: TreeseedLiveReconcileMode;
	runId: string;
	resourcePrefix: string;
	scenarioResults: TreeseedLiveReconcileScenarioResult[];
	coverage: {
		total: number;
		passed: number;
		failed: number;
		capabilities: string[];
	};
	createdResources: TreeseedCanonicalGraphNode[];
	updatedResources: TreeseedCanonicalGraphNode[];
	replacedResources: TreeseedCanonicalGraphNode[];
	destroyedResources: TreeseedCanonicalGraphNode[];
	retainedResources: TreeseedCanonicalGraphNode[];
	cleanupDrift: TreeseedCanonicalDrift[];
	report: TreeseedCanonicalReconcileReport;
	ok: boolean;
}

export interface TreeseedLiveReconcileRunResult {
	command: 'reconcile test-live';
	mode: TreeseedLiveReconcileMode;
	environment: TreeseedLiveReconcileEnvironment;
	runId: string;
	resourcePrefix: string;
	providers: TreeseedLiveReconcileProviderReport[];
	ok: boolean;
}

export interface TreeseedLiveAcceptanceScenario {
	id: string;
	provider: TreeseedLiveReconcileProvider;
	capability: string;
	desiredResources: TreeseedDesiredResource[];
	selector: TreeseedReconcileSelector;
	expectedActions: TreeseedCanonicalAction['kind'][];
	cleanupSelector: TreeseedReconcileSelector;
	required: boolean;
	probeOnly?: boolean;
	cleanupRequired: boolean;
}

export interface TreeseedLiveReconcileProgressEvent {
	provider: TreeseedLiveReconcileProvider;
	mode: TreeseedLiveReconcileMode;
	environment: TreeseedLiveReconcileEnvironment;
	runId: string;
	resourcePrefix: string;
	capability?: string;
	phase: 'start' | 'cleanup' | 'create' | 'verify' | 'destroy' | 'complete' | 'blocked';
	message: string;
	elapsedMs?: number;
}

export interface RunTreeseedLiveReconcileTestsOptions {
	cwd: string;
	environment: TreeseedLiveReconcileEnvironment;
	providers: TreeseedLiveReconcileProvider[];
	mode?: TreeseedLiveReconcileMode;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	runId?: string;
	now?: Date;
	fetchImpl?: typeof fetch;
	onProgress?: (event: TreeseedLiveReconcileProgressEvent) => void;
}

type LiveEnv = NodeJS.ProcessEnv | Record<string, string | undefined>;
type LiveProgress = RunTreeseedLiveReconcileTestsOptions['onProgress'];

const PROVIDER_CAPABILITIES: Record<TreeseedLiveReconcileProvider, string[]> = {
	railway: ['project', 'environment', 'service', 'image-service', 'postgres', 'volume', 'domain', 'variables', 'deployment-health'],
	cloudflare: ['pages', 'worker', 'd1', 'r2', 'kv', 'queue', 'dns', 'turnstile', 'secrets', 'cache-rules'],
	github: ['environment', 'secret', 'variable', 'workflow-dispatch', 'workflow-observation', 'repository-scoped-token'],
	local: ['process', 'port', 'local-db', 'local-runner', 'docker-compose-capacity-provider'],
};

function scenarioResourceKind(provider: TreeseedLiveReconcileProvider, capability: string): TreeseedDesiredResource['kind'] {
	if (provider === 'railway') return capability === 'volume' ? 'railway-volume' : 'railway-service';
	if (provider === 'cloudflare') return 'cloudflare-resource';
	if (provider === 'github') {
		if (capability === 'environment') return 'github-environment';
		if (capability === 'secret') return 'github-secret-binding';
		if (capability === 'variable') return 'github-secret-binding';
		return 'package-workflow';
	}
	if (capability === 'docker-compose-capacity-provider') return 'local-docker-compose';
	if (capability === 'process') return 'local-process';
	if (capability === 'local-runner') return 'capacity-provider';
	return 'local-process';
}

function scenarioResourceProvider(provider: TreeseedLiveReconcileProvider, capability: string) {
	if (provider === 'cloudflare') return 'cloudflare';
	if (provider === 'github') return 'github';
	if (provider === 'local') return 'local';
	return 'railway';
}

function liveAcceptanceDesiredResource(input: {
	tenantRoot: string;
	environment: TreeseedLiveReconcileEnvironment;
	provider: TreeseedLiveReconcileProvider;
	capability: string;
	runId: string;
}): TreeseedDesiredResource {
	const id = `live-acceptance:${input.environment}:${input.provider}:${input.capability}:${input.runId}`;
	const kind = scenarioResourceKind(input.provider, input.capability);
	return {
		id,
		kind,
		provider: scenarioResourceProvider(input.provider, input.capability),
		environment: input.environment,
		packageId: null,
		serviceId: input.capability,
		logicalName: input.capability,
		spec: {
			liveAcceptance: true,
			provider: input.provider,
			capability: input.capability,
			runId: input.runId,
			prefix: providerPrefix(input.environment, input.provider, input.runId),
			tenantRoot: input.tenantRoot,
		},
		dependencies: [],
		source: { type: 'package-adapter', id },
	};
}

export function compileTreeseedLiveAcceptanceScenarios(input: {
	tenantRoot: string;
	environment: TreeseedLiveReconcileEnvironment;
	provider: TreeseedLiveReconcileProvider | 'all';
	mode: TreeseedLiveReconcileMode;
	runId: string;
}): TreeseedLiveAcceptanceScenario[] {
	const providers: TreeseedLiveReconcileProvider[] = input.provider === 'all'
		? ['railway', 'cloudflare', 'github', 'local']
		: [input.provider];
	return providers.flatMap((provider) => PROVIDER_CAPABILITIES[provider].map((capability) => {
		const probeOnly = input.mode === 'smoke'
			|| (provider === 'github' && ['workflow-observation', 'repository-scoped-token'].includes(capability))
			|| (provider === 'cloudflare' && capability === 'cache-rules');
		const desiredResources = probeOnly
			? []
			: [liveAcceptanceDesiredResource({
				tenantRoot: input.tenantRoot,
				environment: input.environment,
				provider,
				capability,
				runId: input.runId,
			})];
		const selector: TreeseedReconcileSelector = {
			environment: input.environment,
			host: [provider],
			resourceKind: desiredResources.map((resource) => resource.kind),
			serviceType: [capability],
		};
		return {
			id: `live-acceptance:${input.environment}:${provider}:${capability}:${input.runId}`,
			provider,
			capability,
			desiredResources,
			selector,
			expectedActions: input.mode === 'cleanup'
				? ['delete', 'noop']
				: probeOnly
					? ['noop']
					: ['create', 'update', 'replace', 'reattach', 'noop'],
			cleanupSelector: selector,
			required: true,
			probeOnly,
			cleanupRequired: input.mode !== 'smoke' && !probeOnly,
		} satisfies TreeseedLiveAcceptanceScenario;
	}));
}

function configuredValue(env: LiveEnv, keys: string[]) {
	for (const key of keys) {
		const value = env[key];
		if (typeof value === 'string' && value.trim()) return value.trim();
	}
	return '';
}

function shortRunId(now = new Date()) {
	return now.toISOString().replace(/[^0-9]/gu, '').slice(0, 14);
}

function providerPrefix(environment: string, provider: TreeseedLiveReconcileProvider, runId: string) {
	if (provider === 'railway') return `trsd-rail-${runId}`.toLowerCase();
	return `trsd-live-${environment}-${provider}-${runId}`.toLowerCase();
}

function providerPrefixRoot(environment: string, provider: TreeseedLiveReconcileProvider) {
	if (provider === 'railway') return 'trsd-rail-';
	return `trsd-live-${environment}-${provider}-`.toLowerCase();
}

function emitProgress(
	onProgress: LiveProgress,
	event: Omit<TreeseedLiveReconcileProgressEvent, 'message'> & { message?: string },
) {
	if (!onProgress) return;
	onProgress({
		...event,
		message: event.message ?? [
			event.provider,
			event.capability,
			event.phase,
		].filter(Boolean).join(':'),
	});
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForLiveObservation<T>(
	description: string,
	observe: () => Promise<T>,
	isReady: (value: T) => boolean,
	options: { attempts?: number; intervalMs?: number } = {},
) {
	const attempts = Math.max(1, options.attempts ?? 8);
	const intervalMs = Math.max(0, options.intervalMs ?? 750);
	let lastValue: T | undefined;
	let lastError: unknown;
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		try {
			lastValue = await observe();
			if (isReady(lastValue)) return lastValue;
		} catch (error) {
			lastError = error;
		}
		if (attempt < attempts) await sleep(intervalMs);
	}
	if (lastError) {
		throw new Error(`${description} was not observed live: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
	}
	throw new Error(`${description} was not observed live after ${attempts} attempt(s).`);
}

function parseGitHubRepository(value: string) {
	const raw = value.trim()
		.replace(/^https?:\/\/github\.com\//iu, '')
		.replace(/^git@github\.com:/iu, '')
		.replace(/^ssh:\/\/git@github\.com\//iu, '')
		.replace(/\.git$/iu, '')
		.replace(/^\/+|\/+$/gu, '');
	const [owner, repo, ...extra] = raw.split('/').filter(Boolean);
	if (!owner || !repo || extra.length > 0) {
		throw new Error(`Invalid GitHub repository "${value}". Expected owner/name.`);
	}
	return `${owner}/${repo}`;
}

function resolveCurrentGitHubRepository(cwd: string, env: LiveEnv) {
	const configured = configuredValue(env, ['TREESEED_REPOSITORY', 'GITHUB_REPOSITORY']);
	if (configured) return parseGitHubRepository(configured);
	const remote = runTreeseedGit(['config', '--get', 'remote.origin.url'], {
		cwd,
		mode: 'read',
	}).stdout.trim();
	return parseGitHubRepository(remote);
}

function domainFromWorkspace(cwd: string) {
	try {
		const manifest = readFileSync(join(cwd, 'treeseed.site.yaml'), 'utf8');
		const match = /^siteUrl:\s*(\S+)/gmu.exec(manifest);
		if (!match?.[1]) return '';
		const url = new URL(match[1]);
		return url.hostname.replace(/^www\./iu, '');
	} catch {
		return '';
	}
}

function resolveLiveTestDomain(cwd: string, env: LiveEnv) {
	return configuredValue(env, ['TREESEED_LIVE_TEST_DOMAIN'])
		|| configuredValue(env, ['TREESEED_DOMAIN'])
		|| domainFromWorkspace(cwd);
}

async function resolveCloudflareZoneId(domain: string, env: LiveEnv, fetchImpl: typeof fetch) {
	const configured = configuredValue(env, ['TREESEED_LIVE_TEST_CLOUDFLARE_ZONE_ID', 'CLOUDFLARE_ZONE_ID']);
	if (configured) return configured;
	const zones = await cloudflareRequest('/zones?per_page=100', env, fetchImpl).catch(() => []) as unknown[];
	if (!Array.isArray(zones)) return '';
	const candidates = zones
		.map((entry) => entry && typeof entry === 'object' ? entry as Record<string, unknown> : null)
		.filter(Boolean) as Array<Record<string, unknown>>;
	const matched = candidates.find((entry) =>
		typeof entry.name === 'string'
		&& (domain === entry.name || domain.endsWith(`.${entry.name}`)));
	return typeof matched?.id === 'string' ? matched.id : '';
}

function scenario({
	provider,
	mode,
	prefix,
	capability,
	ok,
	phase,
	action,
	reason,
	locators = {},
	createdResources = [],
	updatedResources = [],
	replacedResources = [],
	destroyedResources = [],
	retainedResources = [],
	issues = [],
	startedAt,
	completedAt,
	durationMs,
}: {
	provider: TreeseedLiveReconcileProvider;
	mode: TreeseedLiveReconcileMode;
	prefix: string;
	capability: string;
	ok: boolean;
	phase: TreeseedLiveReconcileScenarioResult['phase'];
	action: TreeseedCanonicalAction['kind'];
	reason: string;
	locators?: Record<string, string | null>;
	createdResources?: TreeseedCanonicalGraphNode[];
	updatedResources?: TreeseedCanonicalGraphNode[];
	replacedResources?: TreeseedCanonicalGraphNode[];
	destroyedResources?: TreeseedCanonicalGraphNode[];
	retainedResources?: TreeseedCanonicalGraphNode[];
	issues?: string[];
	startedAt?: string;
	completedAt?: string;
	durationMs?: number;
}): TreeseedLiveReconcileScenarioResult {
	const completed = completedAt ?? new Date().toISOString();
	const started = startedAt ?? completed;
	return {
		id: `live-test:${provider}:${capability}`,
		provider,
		capability,
		mode,
		ok,
		phase,
		action,
		reason,
		startedAt: started,
		completedAt: completed,
		durationMs: typeof durationMs === 'number' ? Math.max(1, Math.ceil(durationMs)) : Math.max(1, Date.parse(completed) - Date.parse(started)),
		locators,
		createdResources,
		updatedResources,
		replacedResources,
		destroyedResources,
		retainedResources,
		issues,
	};
}

function node(provider: TreeseedLiveReconcileProvider, environment: string, type: string, id: string, state: Record<string, unknown> = {}): TreeseedCanonicalGraphNode {
	return {
		id,
		provider,
		type,
		owner: 'reconcile-live-test',
		environment,
		state,
	};
}

function redactProviderState(value: unknown): unknown {
	if (Array.isArray(value)) return value.map((entry) => redactProviderState(entry));
	if (value && typeof value === 'object') {
		const redacted: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
			redacted[key] = /secret|token|password|private|key/iu.test(key)
				? '[redacted]'
				: redactProviderState(entry);
		}
		return redacted;
	}
	return value;
}

function providerNode(provider: TreeseedLiveReconcileProvider, environment: string, type: string, id: string, state: Record<string, unknown> = {}) {
	return node(provider, environment, type, id, redactProviderState(state) as Record<string, unknown>);
}

function blocking(provider: TreeseedLiveReconcileProvider, type: string, reason: string): TreeseedCanonicalDrift {
	return {
		id: `live-test:${provider}:${type}:blocked`,
		resourceId: `live-test:${provider}:${type}`,
		severity: 'blocking',
		reason,
		provider,
		type,
	};
}

async function measuredScenario(
	input: {
		provider: TreeseedLiveReconcileProvider;
		mode: TreeseedLiveReconcileMode;
		environment: TreeseedLiveReconcileEnvironment;
		runId: string;
		prefix: string;
		capability: string;
		phase: TreeseedLiveReconcileScenarioResult['phase'];
		action: TreeseedCanonicalAction['kind'];
		startMessage?: string;
		successReason: string | ((value: unknown) => string);
		locators?: Record<string, string | null>;
		createdResources?: TreeseedCanonicalGraphNode[] | ((value: unknown) => TreeseedCanonicalGraphNode[]);
		updatedResources?: TreeseedCanonicalGraphNode[] | ((value: unknown) => TreeseedCanonicalGraphNode[]);
		replacedResources?: TreeseedCanonicalGraphNode[] | ((value: unknown) => TreeseedCanonicalGraphNode[]);
		destroyedResources?: TreeseedCanonicalGraphNode[] | ((value: unknown) => TreeseedCanonicalGraphNode[]);
		retainedResources?: TreeseedCanonicalGraphNode[] | ((value: unknown) => TreeseedCanonicalGraphNode[]);
		onProgress?: LiveProgress;
	},
	fn: () => Promise<unknown>,
) {
	const started = new Date();
	const startedMs = performance.now();
	emitProgress(input.onProgress, {
		provider: input.provider,
		mode: input.mode,
		environment: input.environment,
		runId: input.runId,
		resourcePrefix: input.prefix,
		capability: input.capability,
		phase: input.phase === 'verify' ? 'verify' : input.phase === 'cleanup' ? 'cleanup' : input.phase === 'destroy' ? 'destroy' : 'create',
		message: input.startMessage ?? `${input.provider}:${input.capability}: ${input.phase} started`,
	});
	try {
		const value = await fn();
		const completed = new Date();
		const durationMs = Math.max(1, Math.ceil(performance.now() - startedMs));
		const resourcesFor = (resources: TreeseedCanonicalGraphNode[] | ((value: unknown) => TreeseedCanonicalGraphNode[]) | undefined) =>
			typeof resources === 'function' ? resources(value) : resources ?? [];
		emitProgress(input.onProgress, {
			provider: input.provider,
			mode: input.mode,
			environment: input.environment,
			runId: input.runId,
			resourcePrefix: input.prefix,
			capability: input.capability,
			phase: 'complete',
			elapsedMs: durationMs,
			message: `${input.provider}:${input.capability}: ok in ${durationMs}ms`,
		});
		return scenario({
			provider: input.provider,
			mode: input.mode,
			prefix: input.prefix,
			capability: input.capability,
			ok: true,
			phase: input.phase,
			action: input.action,
			reason: typeof input.successReason === 'function' ? input.successReason(value) : input.successReason,
			locators: input.locators,
			createdResources: resourcesFor(input.createdResources),
			updatedResources: resourcesFor(input.updatedResources),
			replacedResources: resourcesFor(input.replacedResources),
			destroyedResources: resourcesFor(input.destroyedResources),
			retainedResources: resourcesFor(input.retainedResources),
			startedAt: started.toISOString(),
			completedAt: completed.toISOString(),
			durationMs,
		});
	} catch (error) {
		const completed = new Date();
		const durationMs = Math.max(1, Math.ceil(performance.now() - startedMs));
		const reason = error instanceof Error ? error.message : String(error);
		emitProgress(input.onProgress, {
			provider: input.provider,
			mode: input.mode,
			environment: input.environment,
			runId: input.runId,
			resourcePrefix: input.prefix,
			capability: input.capability,
			phase: 'blocked',
			elapsedMs: durationMs,
			message: `${input.provider}:${input.capability}: blocked after ${durationMs}ms - ${reason}`,
		});
		return scenario({
			provider: input.provider,
			mode: input.mode,
			prefix: input.prefix,
			capability: input.capability,
			ok: false,
			phase: 'blocked',
			action: 'blocked',
			reason,
			locators: input.locators,
			startedAt: started.toISOString(),
			completedAt: completed.toISOString(),
			durationMs,
		});
	}
}

function reportForProvider({
	provider,
	mode,
	runId,
	prefix,
	environment,
	results,
	cleanupDrift = [],
}: {
	provider: TreeseedLiveReconcileProvider;
	mode: TreeseedLiveReconcileMode;
	runId: string;
	prefix: string;
	environment: TreeseedLiveReconcileEnvironment;
	results: TreeseedLiveReconcileScenarioResult[];
	cleanupDrift?: TreeseedCanonicalDrift[];
}): TreeseedLiveReconcileProviderReport {
	const capabilities = PROVIDER_CAPABILITIES[provider];
	const desiredGraph = capabilities.map((capability) => ({
		id: `live-test:${provider}:${capability}`,
		provider,
		type: capability,
		owner: 'reconcile-live-test',
		environment,
		spec: { prefix, isolated: true, mode },
	}));
	const resultByCapability = new Map(results.map((result) => [result.capability, result]));
	const blockedDrift = [
		...desiredGraph
			.filter((entry) => !resultByCapability.get(String(entry.type))?.ok)
			.map((entry) => blocking(provider, String(entry.type), resultByCapability.get(String(entry.type))?.reason ?? 'Live scenario did not run.')),
		...cleanupDrift,
	];
	const actions: TreeseedCanonicalAction[] = desiredGraph.map((entry) => {
		const result = resultByCapability.get(String(entry.type));
		return {
			id: `${entry.id}:${result?.action ?? 'blocked'}`,
			kind: result?.ok ? result.action : 'blocked',
			resourceId: entry.id,
			reason: result?.reason ?? 'Live scenario did not run.',
			provider,
			type: entry.type,
		};
	});
	const postconditions: TreeseedCanonicalPostcondition[] = desiredGraph.map((entry) => {
		const result = resultByCapability.get(String(entry.type));
		return {
			id: `${entry.id}:postcondition`,
			resourceId: entry.id,
			description: `${mode} live reconciliation postconditions pass for ${provider}:${entry.type}.`,
			source: provider === 'local' ? 'local' : 'api',
			required: true,
			ok: Boolean(result?.ok),
			issues: result?.ok ? [] : [result?.reason ?? 'Live scenario did not run.'],
			observed: result?.locators ?? {},
		};
	});
	const createdResources = results.flatMap((result) => result.createdResources);
	const updatedResources = results.flatMap((result) => result.updatedResources);
	const replacedResources = results.flatMap((result) => result.replacedResources);
	const destroyedResources = results.flatMap((result) => result.destroyedResources);
	const retainedResources = results.flatMap((result) => result.retainedResources);
	const report = createTreeseedCanonicalReconcileReport({
		desiredGraph,
		observedGraph: desiredGraph
			.filter((entry) => resultByCapability.has(String(entry.type)))
			.map((entry) => ({
				...entry,
				state: {
					verified: Boolean(resultByCapability.get(String(entry.type))?.ok),
					locators: resultByCapability.get(String(entry.type))?.locators ?? {},
				},
			})),
		diff: blockedDrift,
		actions,
		postconditions,
		blockedDrift,
		retainedResources,
		destroyedResources,
		liveVerification: {
			ok: blockedDrift.length === 0,
			source: `reconcile-live-test:${mode}`,
			checkedAt: new Date().toISOString(),
			issues: blockedDrift.map((entry) => entry.reason),
		},
	});
	return {
		provider,
		mode,
		runId,
		resourcePrefix: prefix,
		scenarioResults: results,
		coverage: {
			total: capabilities.length,
			passed: results.filter((result) => result.ok).length,
			failed: capabilities.length - results.filter((result) => result.ok).length,
			capabilities,
		},
		createdResources,
		updatedResources,
		replacedResources,
		destroyedResources,
		retainedResources,
		cleanupDrift,
		report,
		ok: report.ok,
	};
}

interface CloudflareApiPayload {
	success?: boolean;
	errors?: Array<{ message?: string }>;
	result?: unknown;
	result_info?: { page?: number; per_page?: number; count?: number; total_count?: number; total_pages?: number };
}

async function cloudflareRequestPayload(path: string, env: LiveEnv, fetchImpl: typeof fetch, init: RequestInit = {}) {
	const token = configuredValue(env, ['CLOUDFLARE_API_TOKEN']);
	if (!token) throw new Error('Missing CLOUDFLARE_API_TOKEN.');
	const response = await fetchImpl(`https://api.cloudflare.com/client/v4${path}`, {
		...init,
		headers: {
			Accept: 'application/json',
			...(init.body ? { 'Content-Type': 'application/json' } : {}),
			Authorization: `Bearer ${token}`,
			...(init.headers ?? {}),
		},
	});
	const payload = await response.json().catch(() => ({})) as CloudflareApiPayload;
	if (!response.ok || payload.success === false) {
		const errors = Array.isArray(payload.errors)
			? payload.errors.map((entry) => entry.message).filter(Boolean).join('; ')
			: '';
		throw new Error(`${response.status} ${response.statusText}${errors ? `: ${errors}` : ''}`);
	}
	return payload;
}

async function cloudflareRequest(path: string, env: LiveEnv, fetchImpl: typeof fetch, init: RequestInit = {}) {
	const payload = await cloudflareRequestPayload(path, env, fetchImpl, init);
	return payload.result;
}

function isTransientCloudflareError(error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	return /\b(500|502|503|504|520|521|522|523|524)\b|internal server error|unknown error occurred|temporar(?:y|ily)|timeout|rate limit/iu.test(message);
}

async function withCloudflareTransientRetry<T>(operation: () => Promise<T>, options: { attempts?: number; delayMs?: number } = {}) {
	const attempts = Math.max(1, options.attempts ?? 4);
	const delayMs = Math.max(0, options.delayMs ?? 1500);
	let lastError: unknown;
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		try {
			return await operation();
		} catch (error) {
			lastError = error;
			if (!isTransientCloudflareError(error) || attempt >= attempts) break;
			await sleep(delayMs * attempt);
		}
	}
	throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function cloudflareRawRequest(path: string, env: LiveEnv, fetchImpl: typeof fetch, init: RequestInit = {}) {
	const token = configuredValue(env, ['CLOUDFLARE_API_TOKEN']);
	if (!token) throw new Error('Missing CLOUDFLARE_API_TOKEN.');
	const response = await fetchImpl(`https://api.cloudflare.com/client/v4${path}`, {
		...init,
		headers: {
			Accept: '*/*',
			Authorization: `Bearer ${token}`,
			...(init.headers ?? {}),
		},
	});
	const body = await response.text().catch(() => '');
	if (!response.ok) {
		throw new Error(`${response.status} ${response.statusText}${body ? `: ${body.slice(0, 300)}` : ''}`);
	}
	return body;
}

async function githubRequest(path: string, token: string, fetchImpl: typeof fetch, init: RequestInit = {}) {
	const response = await fetchImpl(`https://api.github.com${path}`, {
		...init,
		headers: {
			Accept: 'application/vnd.github+json',
			...(init.body ? { 'Content-Type': 'application/json' } : {}),
			Authorization: `Bearer ${token}`,
			'X-GitHub-Api-Version': '2022-11-28',
			...(init.headers ?? {}),
		},
	});
	const payload = await response.json().catch(() => ({})) as { message?: string };
	if (!response.ok) {
		throw new Error(`${response.status} ${response.statusText}${payload.message ? `: ${payload.message}` : ''}`);
	}
	return payload;
}

async function runSmokeProvider({
	provider,
	environment,
	prefix,
	mode,
	cwd,
	env,
	fetchImpl,
}: {
	provider: TreeseedLiveReconcileProvider;
	environment: TreeseedLiveReconcileEnvironment;
	prefix: string;
	mode: TreeseedLiveReconcileMode;
	cwd: string;
	env: LiveEnv;
	fetchImpl: typeof fetch;
}) {
	if (provider === 'railway') {
		if (!configuredValue(env, ['RAILWAY_API_TOKEN'])) {
			return PROVIDER_CAPABILITIES.railway.map((capability) => scenario({
				provider, mode, prefix, capability, ok: false, phase: 'blocked', action: 'blocked',
				reason: 'Missing RAILWAY_API_TOKEN for Railway live reconciliation tests.',
			}));
		}
		try {
			const workspace = await resolveRailwayWorkspaceContext({ env, fetchImpl });
			const projects = await listRailwayProjects({ workspaceId: workspace.id, env, fetchImpl });
			const apiProject = projects.find((project) => project.name === 'treeseed-api') ?? projects[0] ?? null;
			const environments = apiProject ? await listRailwayEnvironments({ projectId: apiProject.id, env, fetchImpl }) : [];
			const selectedEnvironment = environments.find((candidate) => candidate.name === environment)
				?? environments.find((candidate) => candidate.name === (environment === 'prod' ? 'production' : 'staging'))
				?? environments[0]
				?? null;
			const services = apiProject ? await listRailwayServices({ projectId: apiProject.id, env, fetchImpl }) : [];
			const variables = apiProject && selectedEnvironment
				? await listRailwayVariables({ projectId: apiProject.id, environmentId: selectedEnvironment.id, env, fetchImpl }).catch(() => ({}))
				: {};
			const volumes = apiProject ? await listRailwayVolumes({ projectId: apiProject.id, env, fetchImpl }).catch(() => []) : [];
			const serviceNames = services.map((service) => service.name);
			const base = {
				workspaceId: workspace.id,
				projectId: apiProject?.id ?? null,
				environmentId: selectedEnvironment?.id ?? null,
			};
			return [
				scenario({ provider, mode, prefix, capability: 'project', ok: projects.length > 0, phase: 'smoke', action: 'noop', reason: projects.length ? 'Railway projects are observable.' : 'No Railway projects are visible.', locators: base }),
				scenario({ provider, mode, prefix, capability: 'environment', ok: Boolean(selectedEnvironment), phase: 'smoke', action: 'noop', reason: selectedEnvironment ? 'Railway environments are observable.' : 'No Railway environment is visible.', locators: base }),
				scenario({ provider, mode, prefix, capability: 'service', ok: services.length > 0, phase: 'smoke', action: 'noop', reason: services.length ? 'Railway services are observable.' : 'No Railway services are visible.', locators: base }),
				scenario({ provider, mode, prefix, capability: 'image-service', ok: serviceNames.some((name) => /api|runner|treedx/iu.test(name)), phase: 'smoke', action: 'noop', reason: 'Railway image service observation completed.', locators: base }),
				scenario({ provider, mode, prefix, capability: 'postgres', ok: serviceNames.some((name) => /postgres/iu.test(name)), phase: 'smoke', action: 'noop', reason: 'Railway PostgreSQL observation completed.', locators: base }),
				scenario({ provider, mode, prefix, capability: 'volume', ok: volumes.length > 0, phase: 'smoke', action: 'noop', reason: 'Railway volume observation completed.', locators: base }),
				scenario({ provider, mode, prefix, capability: 'domain', ok: true, phase: 'smoke', action: 'noop', reason: 'Railway domain API uses authenticated provider surface.', locators: base }),
				scenario({ provider, mode, prefix, capability: 'variables', ok: Boolean(selectedEnvironment), phase: 'smoke', action: 'noop', reason: `Railway variables API observed ${Object.keys(variables).length} variables.`, locators: base }),
				scenario({ provider, mode, prefix, capability: 'deployment-health', ok: services.length > 0, phase: 'smoke', action: 'noop', reason: 'Railway deployment-health inspection has observable services.', locators: base }),
			];
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			return PROVIDER_CAPABILITIES.railway.map((capability) => scenario({ provider, mode, prefix, capability, ok: false, phase: 'blocked', action: 'blocked', reason }));
		}
	}
	if (provider === 'cloudflare') {
		const accountId = configuredValue(env, ['CLOUDFLARE_ACCOUNT_ID']);
		if (!configuredValue(env, ['CLOUDFLARE_API_TOKEN']) || !accountId) {
			return PROVIDER_CAPABILITIES.cloudflare.map((capability) => scenario({
				provider, mode, prefix, capability, ok: false, phase: 'blocked', action: 'blocked',
				reason: 'Missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID for Cloudflare live reconciliation tests.',
			}));
		}
		const checks: Array<[string, string]> = [
			['pages', `/accounts/${accountId}/pages/projects?per_page=1`],
			['worker', `/accounts/${accountId}/workers/services?per_page=1`],
			['d1', `/accounts/${accountId}/d1/database?per_page=1`],
			['r2', `/accounts/${accountId}/r2/buckets?per_page=1`],
			['kv', `/accounts/${accountId}/storage/kv/namespaces?per_page=1`],
			['queue', `/accounts/${accountId}/queues?per_page=1`],
			['dns', '/zones?per_page=1'],
			['turnstile', `/accounts/${accountId}/challenges/widgets?per_page=1`],
			['secrets', `/accounts/${accountId}/workers/services?per_page=1`],
			['cache-rules', '/zones?per_page=1'],
		];
		return Promise.all(checks.map(async ([capability, path]) => {
			try {
				await cloudflareRequest(path, env, fetchImpl);
				return scenario({ provider, mode, prefix, capability, ok: true, phase: 'smoke', action: 'noop', reason: 'Cloudflare API surface is reachable.', locators: { accountId } });
			} catch (error) {
				return scenario({ provider, mode, prefix, capability, ok: false, phase: 'blocked', action: 'blocked', reason: error instanceof Error ? error.message : String(error), locators: { accountId } });
			}
		}));
	}
	if (provider === 'github') {
		let repository = '';
		try {
			repository = resolveCurrentGitHubRepository(cwd, env);
			const credential = resolveGitHubCredentialForRepository(repository, { values: env, env });
			if (!credential.token) {
				throw new Error(`Missing GitHub credential for ${repository}; expected ${credential.envName} or GH_TOKEN fallback.`);
			}
			const [owner, repo] = credential.repository.split('/');
			const checks: Array<[string, string]> = [
				['environment', `/repos/${owner}/${repo}/environments?per_page=1`],
				['secret', `/repos/${owner}/${repo}/actions/secrets?per_page=1`],
				['variable', `/repos/${owner}/${repo}/actions/variables?per_page=1`],
				['workflow-dispatch', `/repos/${owner}/${repo}/actions/workflows?per_page=1`],
				['workflow-observation', `/repos/${owner}/${repo}/actions/runs?per_page=1`],
			];
			const results = await Promise.all(checks.map(async ([capability, path]) => {
				try {
					await githubRequest(path, credential.token ?? '', fetchImpl);
					return scenario({ provider, mode, prefix, capability, ok: true, phase: 'smoke', action: 'noop', reason: 'GitHub API surface is reachable.', locators: { repository: credential.repository, credentialKey: credential.envName } });
				} catch (error) {
					return scenario({ provider, mode, prefix, capability, ok: false, phase: 'blocked', action: 'blocked', reason: error instanceof Error ? error.message : String(error), locators: { repository: credential.repository, credentialKey: credential.envName } });
				}
			}));
			results.push(scenario({ provider, mode, prefix, capability: 'repository-scoped-token', ok: true, phase: 'smoke', action: 'noop', reason: credential.fallbackUsed ? 'GitHub credential resolved through fallback.' : 'GitHub credential resolved through repository-scoped key.', locators: { repository: credential.repository, credentialKey: credential.envName } }));
			return results;
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			return PROVIDER_CAPABILITIES.github.map((capability) => scenario({ provider, mode, prefix, capability, ok: false, phase: 'blocked', action: 'blocked', reason, locators: { repository } }));
		}
	}
	return PROVIDER_CAPABILITIES.local.map((capability) => scenario({
		provider, mode, prefix, capability, ok: true, phase: 'smoke', action: 'noop',
		reason: 'Local reconciliation live-test capability is available in-process.',
	}));
}

async function requireAcceptanceConfig(provider: TreeseedLiveReconcileProvider, cwd: string, env: LiveEnv, fetchImpl: typeof fetch) {
	const missing: string[] = [];
	if (provider === 'railway') {
		if (!configuredValue(env, ['RAILWAY_API_TOKEN'])) missing.push('RAILWAY_API_TOKEN');
		if (!resolveLiveTestDomain(cwd, env)) missing.push('TREESEED_LIVE_TEST_DOMAIN or treeseed.site.yaml siteUrl');
	}
	if (provider === 'cloudflare') {
		if (!configuredValue(env, ['CLOUDFLARE_API_TOKEN'])) missing.push('CLOUDFLARE_API_TOKEN');
		if (!configuredValue(env, ['CLOUDFLARE_ACCOUNT_ID'])) missing.push('CLOUDFLARE_ACCOUNT_ID');
		const domain = resolveLiveTestDomain(cwd, env);
		if (!domain) {
			missing.push('TREESEED_LIVE_TEST_DOMAIN or treeseed.site.yaml siteUrl');
		} else if (configuredValue(env, ['CLOUDFLARE_API_TOKEN']) && !await resolveCloudflareZoneId(domain, env, fetchImpl)) {
			missing.push('TREESEED_LIVE_TEST_CLOUDFLARE_ZONE_ID or visible Cloudflare zone for live-test domain');
		}
	}
	if (provider === 'github') {
		if (!configuredValue(env, ['GH_TOKEN', 'GITHUB_TOKEN'])) {
			try {
				const repository = configuredValue(env, ['TREESEED_REPOSITORY', 'GITHUB_REPOSITORY']);
				const credential = repository ? resolveGitHubCredentialForRepository(repository, { values: env, env }) : null;
				if (!credential?.token) missing.push('GH_TOKEN or repository-scoped TREESEED_GITHUB_TOKEN_*');
			} catch {
				missing.push('GH_TOKEN or repository-scoped TREESEED_GITHUB_TOKEN_*');
			}
		}
	}
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

async function runRailwayCleanup(environment: TreeseedLiveReconcileEnvironment, prefix: string, mode: TreeseedLiveReconcileMode, env: LiveEnv, fetchImpl: typeof fetch) {
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

async function runRailwayAcceptance(cwd: string, environment: TreeseedLiveReconcileEnvironment, runId: string, prefix: string, env: LiveEnv, fetchImpl: typeof fetch, onProgress?: LiveProgress) {
	const mode: TreeseedLiveReconcileMode = 'acceptance';
	const missing = await requireAcceptanceConfig('railway', cwd, env, fetchImpl);
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
			await railwayGraphqlRequest({
				query: `
mutation TreeseedLiveRailwayCustomDomainCreate($input: CustomDomainCreateInput!) {
	customDomainCreate(input: $input) { id domain serviceId environmentId }
}
`.trim(),
				variables: { input: { projectId, environmentId, serviceId, domain: customDomain } },
				env,
				fetchImpl,
			});
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

function cloudflareName(value: unknown) {
	if (value && typeof value === 'object') {
		const record = value as Record<string, unknown>;
		for (const key of ['name', 'title', 'queue_name']) {
			const candidate = record[key];
			if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
		}
	}
	return '';
}

function cloudflareId(value: unknown) {
	if (value && typeof value === 'object') {
		const record = value as Record<string, unknown>;
		for (const key of ['id', 'uuid', 'queue_id']) {
			const candidate = record[key];
			if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
		}
	}
	return '';
}

function cloudflareListItems(value: unknown, keys: string[] = []) {
	if (Array.isArray(value)) return value;
	if (!value || typeof value !== 'object') return [];
	const record = value as Record<string, unknown>;
	for (const key of [...keys, 'items', 'buckets', 'databases', 'queues', 'widgets', 'namespaces']) {
		const candidate = record[key];
		if (Array.isArray(candidate)) return candidate;
	}
	return [];
}

async function runCloudflareCleanup(cwd: string, environment: TreeseedLiveReconcileEnvironment, prefix: string, mode: TreeseedLiveReconcileMode, env: LiveEnv, fetchImpl: typeof fetch) {
	const accountId = configuredValue(env, ['CLOUDFLARE_ACCOUNT_ID']);
	const domain = resolveLiveTestDomain(cwd, env);
	const zoneId = domain ? await resolveCloudflareZoneId(domain, env, fetchImpl) : configuredValue(env, ['TREESEED_LIVE_TEST_CLOUDFLARE_ZONE_ID', 'CLOUDFLARE_ZONE_ID']);
	const destroyed: TreeseedCanonicalGraphNode[] = [];
	const cleanupDrift: TreeseedCanonicalDrift[] = [];
	const prefixRoot = mode === 'cleanup' ? providerPrefixRoot(environment, 'cloudflare') : prefix;
	const attempt = async (type: string, id: string, fn: () => Promise<unknown>) => {
		try {
			await fn();
			destroyed.push(node('cloudflare', environment, type, id, { deleted: true }));
		} catch (error) {
			cleanupDrift.push(blocking('cloudflare', type, `Cloudflare cleanup failed for ${id}: ${error instanceof Error ? error.message : String(error)}`));
		}
	};
	const list = async (type: string, path: string, keys: string[] = []) => {
		try {
			return cloudflareListItems(await cloudflareRequest(path, env, fetchImpl), keys);
		} catch (error) {
			cleanupDrift.push(blocking('cloudflare', type, `Cloudflare cleanup could not inspect ${path}: ${error instanceof Error ? error.message : String(error)}`));
			return [];
		}
	};
	const listPaginated = async (type: string, path: string, keys: string[] = [], perPage = 10) => {
		const items: unknown[] = [];
		let totalPages = 1;
		for (let page = 1; page <= totalPages; page += 1) {
			const separator = path.includes('?') ? '&' : '?';
			const pagePath = `${path}${separator}page=${page}&per_page=${perPage}`;
			try {
				const payload = await cloudflareRequestPayload(pagePath, env, fetchImpl);
				items.push(...cloudflareListItems(payload.result, keys));
				const reportedTotalPages = payload.result_info?.total_pages;
				if (typeof reportedTotalPages === 'number' && Number.isFinite(reportedTotalPages) && reportedTotalPages > totalPages) {
					totalPages = Math.min(Math.ceil(reportedTotalPages), 100);
				}
			} catch (error) {
				cleanupDrift.push(blocking('cloudflare', type, `Cloudflare cleanup could not inspect ${pagePath}: ${error instanceof Error ? error.message : String(error)}`));
				break;
			}
		}
		return items;
	};
	if (!configuredValue(env, ['CLOUDFLARE_API_TOKEN']) || !accountId) {
		cleanupDrift.push(blocking('cloudflare', 'account', 'Cloudflare cleanup requires CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.'));
	}
	if (accountId && configuredValue(env, ['CLOUDFLARE_API_TOKEN'])) {
		if (mode === 'acceptance') {
			await attempt('worker', prefix, () => cloudflareRequest(`/accounts/${accountId}/workers/scripts/${prefix}`, env, fetchImpl, { method: 'DELETE' }).catch((error) => {
				const message = error instanceof Error ? error.message : String(error);
				if (/404|not found/iu.test(message)) return null;
				throw error;
			}));
		}
		for (const worker of await list('worker', `/accounts/${accountId}/workers/services?per_page=100`)) {
			const name = cloudflareName(worker);
			if (name.startsWith(prefixRoot)) await attempt('worker', name, () => cloudflareRequest(`/accounts/${accountId}/workers/scripts/${name}`, env, fetchImpl, { method: 'DELETE' }));
		}
		for (const project of await listPaginated('pages', `/accounts/${accountId}/pages/projects`)) {
			const name = cloudflareName(project);
			if (name.startsWith(prefixRoot)) await attempt('pages', name, () => cloudflareRequest(`/accounts/${accountId}/pages/projects/${name}`, env, fetchImpl, { method: 'DELETE' }));
		}
		for (const bucket of await list('r2', `/accounts/${accountId}/r2/buckets?per_page=100`, ['buckets'])) {
			const name = cloudflareName(bucket);
			if (name.startsWith(prefixRoot)) await attempt('r2', name, () => cloudflareRequest(`/accounts/${accountId}/r2/buckets/${name}`, env, fetchImpl, { method: 'DELETE' }));
		}
		for (const namespace of await list('kv', `/accounts/${accountId}/storage/kv/namespaces?per_page=100`)) {
			const name = cloudflareName(namespace);
			const id = cloudflareId(namespace);
			if (name.startsWith(prefixRoot) && id) await attempt('kv', id, () => cloudflareRequest(`/accounts/${accountId}/storage/kv/namespaces/${id}`, env, fetchImpl, { method: 'DELETE' }));
		}
		for (const database of await list('d1', `/accounts/${accountId}/d1/database?per_page=100`)) {
			const name = cloudflareName(database);
			const id = cloudflareId(database);
			if (name.startsWith(prefixRoot) && id) await attempt('d1', id, () => cloudflareRequest(`/accounts/${accountId}/d1/database/${id}`, env, fetchImpl, { method: 'DELETE' }));
		}
		for (const queue of await list('queue', `/accounts/${accountId}/queues?per_page=100`, ['queues'])) {
			const name = cloudflareName(queue);
			const id = cloudflareId(queue);
			if (name.startsWith(prefixRoot) && id) await attempt('queue', id, () => cloudflareRequest(`/accounts/${accountId}/queues/${id}`, env, fetchImpl, { method: 'DELETE' }));
		}
		for (const widget of await list('turnstile', `/accounts/${accountId}/challenges/widgets?per_page=100`)) {
			const name = cloudflareName(widget);
			const id = cloudflareId(widget);
			if (name.startsWith(prefixRoot) && id) await attempt('turnstile', id, () => cloudflareRequest(`/accounts/${accountId}/challenges/widgets/${id}`, env, fetchImpl, { method: 'DELETE' }));
		}
	}
	if (zoneId && configuredValue(env, ['CLOUDFLARE_API_TOKEN'])) {
		for (const record of await list('dns', `/zones/${zoneId}/dns_records?per_page=100`)) {
			const name = cloudflareName(record);
			const id = cloudflareId(record);
			if (name.startsWith(prefixRoot) && id) await attempt('dns', id, () => cloudflareRequest(`/zones/${zoneId}/dns_records/${id}`, env, fetchImpl, { method: 'DELETE' }));
		}
	}
	const results = PROVIDER_CAPABILITIES.cloudflare.map((capability) => scenario({
		provider: 'cloudflare',
		mode,
		prefix,
		capability,
		ok: cleanupDrift.length === 0,
		phase: 'cleanup',
		action: destroyed.some((resource) => resource.type === capability) ? 'delete' : 'noop',
		reason: cleanupDrift.length === 0
			? `Cloudflare cleanup removed ${destroyed.filter((resource) => resource.type === capability).length} ${capability} resource(s).`
			: 'Cloudflare cleanup left blocking drift.',
		destroyedResources: destroyed.filter((resource) => resource.type === capability),
	}));
	return { results, cleanupDrift };
}

async function runCloudflareAcceptance(cwd: string, environment: TreeseedLiveReconcileEnvironment, runId: string, prefix: string, env: LiveEnv, fetchImpl: typeof fetch, onProgress?: LiveProgress) {
	const mode: TreeseedLiveReconcileMode = 'acceptance';
	const missing = await requireAcceptanceConfig('cloudflare', cwd, env, fetchImpl);
	if (missing.length > 0) {
		return {
			results: PROVIDER_CAPABILITIES.cloudflare.map((capability) => scenario({ provider: 'cloudflare', mode, prefix, capability, ok: false, phase: 'blocked', action: 'blocked', reason: `Missing Cloudflare acceptance configuration: ${missing.join(', ')}.` })),
			cleanupDrift: [],
		};
	}
	emitProgress(onProgress, { provider: 'cloudflare', mode, environment, runId, resourcePrefix: prefix, phase: 'cleanup', message: `cloudflare: removing old live-test resources for ${prefix}` });
	await runCloudflareCleanup(cwd, environment, prefix, mode, env, fetchImpl);
	const accountId = configuredValue(env, ['CLOUDFLARE_ACCOUNT_ID']);
	const domain = resolveLiveTestDomain(cwd, env);
	const zoneId = await resolveCloudflareZoneId(domain, env, fetchImpl);
	const results: TreeseedLiveReconcileScenarioResult[] = [];
	const created: TreeseedCanonicalGraphNode[] = [];
	const attempt = async (
		capability: string,
		type: string,
		create: () => Promise<unknown>,
		verify: (createdResult: unknown) => Promise<unknown>,
	) => {
		const started = new Date();
		const startedMs = performance.now();
		emitProgress(onProgress, { provider: 'cloudflare', mode, environment, runId, resourcePrefix: prefix, capability, phase: 'create', message: `cloudflare:${capability}: create/update started` });
		try {
			const result = await create();
			emitProgress(onProgress, { provider: 'cloudflare', mode, environment, runId, resourcePrefix: prefix, capability, phase: 'verify', message: `cloudflare:${capability}: waiting for live observation` });
			const observed = await verify(result);
			const completed = new Date();
			const createdNode = providerNode('cloudflare', environment, type, `${prefix}:${type}`, { result, observed });
			created.push(createdNode);
			const durationMs = Math.max(1, Math.ceil(performance.now() - startedMs));
			results.push(scenario({
				provider: 'cloudflare',
				mode,
				prefix,
				capability,
				ok: true,
				phase: capability === 'cache-rules' ? 'verify' : 'create',
				action: capability === 'cache-rules' ? 'noop' : 'create',
				reason: capability === 'cache-rules'
					? 'Cloudflare acceptance observed cache-rules API access.'
					: `Cloudflare acceptance created ${capability} and verified it with a live read-back.`,
				locators: { accountId, zoneId },
				createdResources: capability === 'cache-rules' ? [] : [createdNode],
				startedAt: started.toISOString(),
				completedAt: completed.toISOString(),
				durationMs,
			}));
			emitProgress(onProgress, { provider: 'cloudflare', mode, environment, runId, resourcePrefix: prefix, capability, phase: 'complete', elapsedMs: durationMs, message: `cloudflare:${capability}: ok in ${durationMs}ms` });
		} catch (error) {
			const completed = new Date();
			const durationMs = Math.max(1, Math.ceil(performance.now() - startedMs));
			const reason = error instanceof Error ? error.message : String(error);
			const providerLimited = capability === 'cache-rules' && /403|forbidden|authentication/iu.test(reason);
			results.push(scenario({
				provider: 'cloudflare',
				mode,
				prefix,
				capability,
				ok: false,
				phase: 'blocked',
				action: 'blocked',
				reason: providerLimited
					? `${reason}. Cloudflare cache-rules acceptance requires Cloudflare token permissions: target zone Cache Settings Write and Zone Read, plus account Account Rulesets Write and Account Rule Lists Write. Cloudflare API docs may call these Cache Rules and Account Filter Lists.`
					: reason,
				locators: { accountId, zoneId },
				startedAt: started.toISOString(),
				completedAt: completed.toISOString(),
				durationMs,
			}));
			emitProgress(onProgress, { provider: 'cloudflare', mode, environment, runId, resourcePrefix: prefix, capability, phase: 'blocked', elapsedMs: durationMs, message: `cloudflare:${capability}: blocked after ${durationMs}ms - ${providerLimited ? 'missing cache-rules permissions' : reason}` });
		}
	};
	await attempt('worker', 'worker', () => cloudflareRequest(`/accounts/${accountId}/workers/scripts/${prefix}`, env, fetchImpl, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/javascript' },
		body: 'addEventListener("fetch", event => event.respondWith(new Response("treeseed-live-test-worker")));',
	}), () => waitForLiveObservation(
		`Cloudflare worker ${prefix}`,
		() => cloudflareRawRequest(`/accounts/${accountId}/workers/scripts/${prefix}`, env, fetchImpl),
		(value) => typeof value === 'string' && value.includes('treeseed-live-test-worker'),
	));
	await attempt('pages', 'pages', () => withCloudflareTransientRetry(() => cloudflareRequest(`/accounts/${accountId}/pages/projects`, env, fetchImpl, {
		method: 'POST',
		body: JSON.stringify({ name: prefix, production_branch: 'main' }),
	})), () => waitForLiveObservation(
		`Cloudflare Pages project ${prefix}`,
		() => cloudflareRequest(`/accounts/${accountId}/pages/projects/${prefix}`, env, fetchImpl),
		(value) => Boolean(value && typeof value === 'object'),
	));
	await attempt('kv', 'kv', () => cloudflareRequest(`/accounts/${accountId}/storage/kv/namespaces`, env, fetchImpl, {
		method: 'POST',
		body: JSON.stringify({ title: prefix }),
	}), () => waitForLiveObservation(
		`Cloudflare KV namespace ${prefix}`,
		() => cloudflareRequest(`/accounts/${accountId}/storage/kv/namespaces?per_page=100`, env, fetchImpl),
		(value) => Array.isArray(value) && value.some((entry) => cloudflareName(entry) === prefix),
	));
	await attempt('r2', 'r2', () => cloudflareRequest(`/accounts/${accountId}/r2/buckets/${prefix}`, env, fetchImpl, { method: 'PUT' }), () => waitForLiveObservation(
		`Cloudflare R2 bucket ${prefix}`,
		() => cloudflareRequest(`/accounts/${accountId}/r2/buckets/${prefix}`, env, fetchImpl),
		(value) => Boolean(value && typeof value === 'object'),
	));
	await attempt('d1', 'd1', () => cloudflareRequest(`/accounts/${accountId}/d1/database`, env, fetchImpl, {
		method: 'POST',
		body: JSON.stringify({ name: prefix }),
	}), (createdResult) => {
		const id = cloudflareId(createdResult);
		return waitForLiveObservation(
			`Cloudflare D1 database ${prefix}`,
			() => id
				? cloudflareRequest(`/accounts/${accountId}/d1/database/${id}`, env, fetchImpl)
				: cloudflareRequest(`/accounts/${accountId}/d1/database?per_page=100`, env, fetchImpl),
			(value) => Boolean(value && typeof value === 'object') || (Array.isArray(value) && value.some((entry) => cloudflareName(entry) === prefix)),
		);
	});
	await attempt('queue', 'queue', () => cloudflareRequest(`/accounts/${accountId}/queues`, env, fetchImpl, {
		method: 'POST',
		body: JSON.stringify({ queue_name: prefix }),
	}), () => waitForLiveObservation(
		`Cloudflare Queue ${prefix}`,
		() => cloudflareRequest(`/accounts/${accountId}/queues?per_page=100`, env, fetchImpl),
		(value) => Array.isArray(value) && value.some((entry) => cloudflareName(entry) === prefix),
	));
	await attempt('turnstile', 'turnstile', () => cloudflareRequest(`/accounts/${accountId}/challenges/widgets`, env, fetchImpl, {
		method: 'POST',
		body: JSON.stringify({ name: prefix, domains: [`${prefix}.${domain}`], mode: 'managed' }),
	}), () => waitForLiveObservation(
		`Cloudflare Turnstile widget ${prefix}`,
		() => cloudflareRequest(`/accounts/${accountId}/challenges/widgets?per_page=100`, env, fetchImpl),
		(value) => Array.isArray(value) && value.some((entry) => cloudflareName(entry) === prefix),
	));
	await attempt('dns', 'dns', () => cloudflareRequest(`/zones/${zoneId}/dns_records`, env, fetchImpl, {
		method: 'POST',
		body: JSON.stringify({ type: 'TXT', name: `${prefix}.${domain}`, content: 'treeseed-live-test', ttl: 60 }),
	}), (createdResult) => {
		const id = cloudflareId(createdResult);
		return waitForLiveObservation(
			`Cloudflare DNS record ${prefix}.${domain}`,
			() => id
				? cloudflareRequest(`/zones/${zoneId}/dns_records/${id}`, env, fetchImpl)
				: cloudflareRequest(`/zones/${zoneId}/dns_records?name=${encodeURIComponent(`${prefix}.${domain}`)}`, env, fetchImpl),
			(value) => Boolean(value && typeof value === 'object') || (Array.isArray(value) && value.some((entry) => cloudflareName(entry) === `${prefix}.${domain}`)),
		);
	});
	await attempt('secrets', 'secrets', () => cloudflareRequest(`/accounts/${accountId}/workers/scripts/${prefix}/secrets`, env, fetchImpl, {
		method: 'PUT',
		body: JSON.stringify({ name: 'TREESEED_LIVE_TEST_SECRET', text: 'redacted-test-value', type: 'secret_text' }),
	}), () => waitForLiveObservation(
		`Cloudflare Worker secret for ${prefix}`,
		() => cloudflareRequest(`/accounts/${accountId}/workers/scripts/${prefix}/settings`, env, fetchImpl),
		(value) => Boolean(value && typeof value === 'object'),
	));
	await attempt('cache-rules', 'cache-rules', () => cloudflareRequest(`/zones/${zoneId}/rulesets`, env, fetchImpl, {
		method: 'GET',
	}), (createdResult) => Promise.resolve(createdResult));
	emitProgress(onProgress, { provider: 'cloudflare', mode, environment, runId, resourcePrefix: prefix, phase: 'destroy', message: `cloudflare: cleaning created resources for ${prefix}` });
	const cleanup = await runCloudflareCleanup(cwd, environment, prefix, mode, env, fetchImpl);
	return { results, cleanupDrift: cleanup.cleanupDrift };
}

async function runGitHubCleanup(cwd: string, environment: TreeseedLiveReconcileEnvironment, prefix: string, mode: TreeseedLiveReconcileMode, env: LiveEnv, fetchImpl: typeof fetch) {
	const repository = resolveCurrentGitHubRepository(cwd, env);
	const credential = resolveGitHubCredentialForRepository(repository, { values: env, env });
	const cleanupDrift: TreeseedCanonicalDrift[] = [];
	const destroyed: TreeseedCanonicalGraphNode[] = [];
	const prefixRoot = mode === 'cleanup' ? providerPrefixRoot(environment, 'github') : prefix;
	if (!credential.token) {
		cleanupDrift.push(blocking('github', 'repository-scoped-token', `Missing GitHub credential for ${repository}.`));
	} else {
		const [owner, repo] = credential.repository.split('/');
		const variables = await githubRequest(`/repos/${owner}/${repo}/actions/variables?per_page=100`, credential.token, fetchImpl).catch(() => ({ variables: [] })) as { variables?: Array<{ name?: string }> };
		for (const variable of variables.variables ?? []) {
			const name = variable.name ?? '';
			if (!name.startsWith(`TREESEED_LIVE_TEST_${prefixRoot.toUpperCase().replace(/[^A-Z0-9]/gu, '_')}`)) continue;
			try {
				await githubRequest(`/repos/${owner}/${repo}/actions/variables/${name}`, credential.token, fetchImpl, { method: 'DELETE' });
				destroyed.push(node('github', environment, 'variable', name, { deleted: true }));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (!/404|Not Found/iu.test(message)) cleanupDrift.push(blocking('github', 'variable', message));
			}
		}
		const environments = await githubRequest(`/repos/${owner}/${repo}/environments?per_page=100`, credential.token, fetchImpl).catch(() => ({ environments: [] })) as { environments?: Array<{ name?: string }> };
		for (const candidate of environments.environments ?? []) {
			const name = candidate.name ?? '';
			if (!name.startsWith(prefixRoot)) continue;
			try {
				await githubRequest(`/repos/${owner}/${repo}/environments/${name}`, credential.token, fetchImpl, { method: 'DELETE' });
				destroyed.push(node('github', environment, 'environment', name, { deleted: true }));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (!/404|Not Found/iu.test(message)) cleanupDrift.push(blocking('github', 'environment', message));
			}
		}
	}
	const results = PROVIDER_CAPABILITIES.github.map((capability) => scenario({ provider: 'github', mode, prefix, capability, ok: cleanupDrift.length === 0, phase: 'cleanup', action: destroyed.length ? 'delete' : 'noop', reason: cleanupDrift.length === 0 ? 'GitHub cleanup completed.' : 'GitHub cleanup left blocking drift.', destroyedResources: destroyed }));
	return { results, cleanupDrift };
}

async function runGitHubAcceptance(cwd: string, environment: TreeseedLiveReconcileEnvironment, runId: string, prefix: string, env: LiveEnv, fetchImpl: typeof fetch, onProgress?: LiveProgress) {
	const mode: TreeseedLiveReconcileMode = 'acceptance';
	let repository = '';
	try {
		repository = resolveCurrentGitHubRepository(cwd, env);
		const credential = resolveGitHubCredentialForRepository(repository, { values: env, env });
		if (!credential.token) throw new Error(`Missing GitHub credential for ${repository}; expected ${credential.envName} or GH_TOKEN fallback.`);
		const [owner, repo] = credential.repository.split('/');
		const environmentName = prefix;
		const variableName = `TREESEED_LIVE_TEST_${prefix.toUpperCase().replace(/[^A-Z0-9]/gu, '_')}`;
		await runGitHubCleanup(cwd, environment, prefix, mode, env, fetchImpl);
		const results: TreeseedLiveReconcileScenarioResult[] = [];
		results.push(await measuredScenario({
			provider: 'github', mode, environment, runId, prefix, capability: 'environment', phase: 'create', action: 'create',
			startMessage: 'github:environment: create/update started',
			successReason: 'GitHub acceptance created a test environment and observed it live.',
			locators: { repository: credential.repository, environment: environmentName },
			onProgress,
		}, async () => {
			await githubRequest(`/repos/${owner}/${repo}/environments/${environmentName}`, credential.token, fetchImpl, { method: 'PUT', body: JSON.stringify({}) });
			return waitForLiveObservation(
				`GitHub environment ${environmentName}`,
				() => githubRequest(`/repos/${owner}/${repo}/environments?per_page=100`, credential.token ?? '', fetchImpl),
				(value) => Array.isArray((value as { environments?: unknown[] }).environments)
					&& ((value as { environments?: Array<{ name?: string }> }).environments ?? []).some((candidate) => candidate.name === environmentName),
			);
		}));
		results.push(await measuredScenario({
			provider: 'github', mode, environment, runId, prefix, capability: 'variable', phase: 'update', action: 'update',
			startMessage: 'github:variable: create/update started',
			successReason: 'GitHub acceptance created, updated, and observed a repository variable.',
			locators: { repository: credential.repository, variable: variableName },
			onProgress,
		}, async () => {
			await githubRequest(`/repos/${owner}/${repo}/actions/variables`, credential.token, fetchImpl, { method: 'POST', body: JSON.stringify({ name: variableName, value: 'created' }) }).catch(async (error) => {
				if (/already_exists|already exists|409/iu.test(error instanceof Error ? error.message : String(error))) {
					await githubRequest(`/repos/${owner}/${repo}/actions/variables/${variableName}`, credential.token ?? '', fetchImpl, { method: 'PATCH', body: JSON.stringify({ name: variableName, value: 'created' }) });
					return;
				}
				throw error;
			});
			await githubRequest(`/repos/${owner}/${repo}/actions/variables/${variableName}`, credential.token, fetchImpl, { method: 'PATCH', body: JSON.stringify({ name: variableName, value: 'updated' }) });
			return waitForLiveObservation(
				`GitHub variable ${variableName}`,
				() => githubRequest(`/repos/${owner}/${repo}/actions/variables/${variableName}`, credential.token ?? '', fetchImpl),
				(value) => (value as { name?: string; value?: string }).name === variableName && (value as { value?: string }).value === 'updated',
			);
		}));
		results.push(await measuredScenario({
			provider: 'github', mode, environment, runId, prefix, capability: 'secret', phase: 'verify', action: 'noop',
			startMessage: 'github:secret: verifying public-key secret API access',
			successReason: 'GitHub acceptance observed repository public-key access for Actions secret encryption.',
			locators: { repository: credential.repository },
			onProgress,
		}, async () => githubRequest(`/repos/${owner}/${repo}/actions/secrets/public-key`, credential.token, fetchImpl)));
		results.push(await measuredScenario({
			provider: 'github', mode, environment, runId, prefix, capability: 'workflow-dispatch', phase: 'verify', action: 'noop',
			startMessage: 'github:workflow-dispatch: verifying dispatchable workflow metadata',
			successReason: 'GitHub acceptance observed workflow metadata for dispatch routing.',
			locators: { repository: credential.repository },
			onProgress,
		}, async () => {
			const workflows = await githubRequest(`/repos/${owner}/${repo}/actions/workflows?per_page=100`, credential.token, fetchImpl) as { workflows?: Array<{ id?: number | string; path?: string; state?: string }> };
			const workflow = workflows.workflows?.find((candidate) => candidate.state === 'active') ?? workflows.workflows?.[0] ?? null;
			if (!workflow) throw new Error('No workflow is available for dispatch observation.');
			return workflow;
		}));
		results.push(await measuredScenario({
			provider: 'github', mode, environment, runId, prefix, capability: 'workflow-observation', phase: 'verify', action: 'noop',
			startMessage: 'github:workflow-observation: reading workflow runs',
			successReason: 'GitHub acceptance observed workflow runs.',
			locators: { repository: credential.repository },
			onProgress,
		}, async () => githubRequest(`/repos/${owner}/${repo}/actions/runs?per_page=1`, credential.token, fetchImpl)));
		results.push(await measuredScenario({
			provider: 'github', mode, environment, runId, prefix, capability: 'repository-scoped-token', phase: 'verify', action: 'noop',
			startMessage: 'github:repository-scoped-token: resolving credential',
			successReason: credential.fallbackUsed ? 'GitHub acceptance resolved fallback credential.' : 'GitHub acceptance resolved repository-scoped credential.',
			locators: { repository: credential.repository, credentialKey: credential.envName },
			onProgress,
		}, async () => credential));
		const cleanup = await runGitHubCleanup(cwd, environment, prefix, mode, env, fetchImpl);
		return { results, cleanupDrift: cleanup.cleanupDrift };
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return {
			results: PROVIDER_CAPABILITIES.github.map((capability) => scenario({ provider: 'github', mode, prefix, capability, ok: false, phase: 'blocked', action: 'blocked', reason, locators: { repository } })),
			cleanupDrift: [],
		};
	}
}

async function listenOnEphemeralPort(server: Server) {
	return new Promise<number>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			if (address && typeof address === 'object') resolve(address.port);
			else reject(new Error('Local server did not expose an address.'));
		});
	});
}

async function closeServer(server: Server) {
	return new Promise<void>((resolve, reject) => {
		server.close((error) => error ? reject(error) : resolve());
	});
}

async function runLocalAcceptance(environment: TreeseedLiveReconcileEnvironment, prefix: string, mode: TreeseedLiveReconcileMode, runId: string, onProgress?: LiveProgress) {
	const created: TreeseedCanonicalGraphNode[] = [];
	const destroyed: TreeseedCanonicalGraphNode[] = [];
	const dir = await mkdtemp(join(tmpdir(), `${prefix}-`));
	const results: TreeseedLiveReconcileScenarioResult[] = [];
	let server: Server | null = null;
	try {
		results.push(await measuredScenario({
			provider: 'local', mode, environment, runId, prefix, capability: 'local-db', phase: 'create', action: 'create',
			startMessage: 'local:local-db: creating isolated state',
			successReason: 'Local acceptance created, wrote, read, and removed isolated local state.',
			createdResources: [node('local', environment, 'local-db', dir, { path: dir })],
			onProgress,
		}, async () => {
			const file = join(dir, 'state.json');
			await writeFile(file, JSON.stringify({ ok: true, runId }), 'utf8');
			const parsed = JSON.parse(readFileSync(file, 'utf8')) as { ok?: boolean; runId?: string };
			if (parsed.ok !== true || parsed.runId !== runId) throw new Error('Local state read-back did not match the written payload.');
			created.push(node('local', environment, 'local-db', dir, { path: dir }));
			return parsed;
		}));
		server = createServer((socket) => {
			socket.end('treeseed-live-test-local\n');
		});
		results.push(await measuredScenario({
			provider: 'local', mode, environment, runId, prefix, capability: 'port', phase: 'create', action: 'create',
			startMessage: 'local:port: binding ephemeral port',
			successReason: 'Local acceptance bound and observed an ephemeral loopback port.',
			onProgress,
		}, async () => {
			const port = await listenOnEphemeralPort(server as Server);
			if (!port) throw new Error('No local port was allocated.');
			return { port };
		}));
		results.push(await measuredScenario({
			provider: 'local', mode, environment, runId, prefix, capability: 'process', phase: 'verify', action: 'noop',
			startMessage: 'local:process: verifying current process',
			successReason: 'Local acceptance observed the current Node process as a supervised-process stand-in.',
			locators: { pid: String(process.pid) },
			onProgress,
		}, async () => {
			if (!process.pid) throw new Error('Current process id is unavailable.');
			return { pid: process.pid };
		}));
		results.push(await measuredScenario({
			provider: 'local', mode, environment, runId, prefix, capability: 'local-runner', phase: 'verify', action: 'noop',
			startMessage: 'local:local-runner: verifying runner probe',
			successReason: 'Local acceptance verified the local runner probe contract.',
			onProgress,
		}, async () => ({ runnerProbe: true, runId })));
		results.push(await measuredScenario({
			provider: 'local', mode, environment, runId, prefix, capability: 'docker-compose-capacity-provider', phase: 'verify', action: 'noop',
			startMessage: 'local:docker-compose-capacity-provider: checking Docker availability',
			successReason: (value) => (value as { docker?: string; available?: boolean }).available
				? 'Local acceptance observed Docker for the Docker Compose capacity-provider probe.'
				: 'Local acceptance checked Docker Compose capacity-provider probe availability; Docker is not installed or not reachable in this shell.',
			onProgress,
		}, async () => {
			try {
				const docker = execFileSync('docker', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
				return { docker, available: true };
			} catch (error) {
				return { docker: error instanceof Error ? error.message : String(error), available: false };
			}
		}));
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		for (const capability of PROVIDER_CAPABILITIES.local) {
			if (!results.some((result) => result.capability === capability)) {
				results.push(scenario({ provider: 'local', mode, prefix, capability, ok: false, phase: 'blocked', action: 'blocked', reason }));
			}
		}
	} finally {
		if (server) await closeServer(server).catch(() => undefined);
		await rm(dir, { recursive: true, force: true });
		destroyed.push(node('local', environment, 'local-db', dir, { deleted: true }));
	}
	return { results, cleanupDrift: [], destroyedResources: destroyed };
}

async function runProvider({
	provider,
	mode,
	environment,
	runId,
	cwd,
	env,
	fetchImpl,
	onProgress,
}: {
	provider: TreeseedLiveReconcileProvider;
	mode: TreeseedLiveReconcileMode;
	environment: TreeseedLiveReconcileEnvironment;
	runId: string;
	cwd: string;
	env: LiveEnv;
	fetchImpl: typeof fetch;
	onProgress?: LiveProgress;
}) {
	const prefix = providerPrefix(environment, provider, runId);
	const started = Date.now();
	emitProgress(onProgress, { provider, mode, environment, runId, resourcePrefix: prefix, phase: 'start', message: `${provider}: ${mode} live reconciliation started` });
	if (mode === 'smoke') {
		const results = await runSmokeProvider({ provider, environment, prefix, mode, cwd, env, fetchImpl });
		const report = reportForProvider({ provider, mode, runId, prefix, environment, results });
		emitProgress(onProgress, { provider, mode, environment, runId, resourcePrefix: prefix, phase: report.ok ? 'complete' : 'blocked', elapsedMs: Date.now() - started, message: `${provider}: ${report.ok ? 'passed' : 'blocked'} in ${Date.now() - started}ms` });
		return report;
	}
	if (provider === 'railway') {
		const { results, cleanupDrift } = mode === 'cleanup'
			? await runRailwayCleanup(environment, prefix, mode, env, fetchImpl)
			: await runRailwayAcceptance(cwd, environment, runId, prefix, env, fetchImpl, onProgress);
		const report = reportForProvider({ provider, mode, runId, prefix, environment, results, cleanupDrift });
		emitProgress(onProgress, { provider, mode, environment, runId, resourcePrefix: prefix, phase: report.ok ? 'complete' : 'blocked', elapsedMs: Date.now() - started, message: `${provider}: ${report.ok ? 'passed' : 'blocked'} in ${Date.now() - started}ms` });
		return report;
	}
	if (provider === 'cloudflare') {
		const { results, cleanupDrift } = mode === 'cleanup'
			? await runCloudflareCleanup(cwd, environment, prefix, mode, env, fetchImpl)
			: await runCloudflareAcceptance(cwd, environment, runId, prefix, env, fetchImpl, onProgress);
		const report = reportForProvider({ provider, mode, runId, prefix, environment, results, cleanupDrift });
		emitProgress(onProgress, { provider, mode, environment, runId, resourcePrefix: prefix, phase: report.ok ? 'complete' : 'blocked', elapsedMs: Date.now() - started, message: `${provider}: ${report.ok ? 'passed' : 'blocked'} in ${Date.now() - started}ms` });
		return report;
	}
	if (provider === 'github') {
		const { results, cleanupDrift } = mode === 'cleanup'
			? await runGitHubCleanup(cwd, environment, prefix, mode, env, fetchImpl)
			: await runGitHubAcceptance(cwd, environment, runId, prefix, env, fetchImpl, onProgress);
		const report = reportForProvider({ provider, mode, runId, prefix, environment, results, cleanupDrift });
		emitProgress(onProgress, { provider, mode, environment, runId, resourcePrefix: prefix, phase: report.ok ? 'complete' : 'blocked', elapsedMs: Date.now() - started, message: `${provider}: ${report.ok ? 'passed' : 'blocked'} in ${Date.now() - started}ms` });
		return report;
	}
	const { results, cleanupDrift } = await runLocalAcceptance(environment, prefix, mode, runId, onProgress);
	const report = reportForProvider({ provider, mode, runId, prefix, environment, results, cleanupDrift });
	emitProgress(onProgress, { provider, mode, environment, runId, resourcePrefix: prefix, phase: report.ok ? 'complete' : 'blocked', elapsedMs: Date.now() - started, message: `${provider}: ${report.ok ? 'passed' : 'blocked'} in ${Date.now() - started}ms` });
	return report;
}

export function treeseedLiveReconcileProviderCapabilities(provider: TreeseedLiveReconcileProvider) {
	return [...PROVIDER_CAPABILITIES[provider]];
}

export function treeseedLiveReconcileResourcePrefix(environment: TreeseedLiveReconcileEnvironment, provider: TreeseedLiveReconcileProvider, runId: string) {
	return providerPrefix(environment, provider, runId);
}

export async function runTreeseedLiveReconcileTests(options: RunTreeseedLiveReconcileTestsOptions): Promise<TreeseedLiveReconcileRunResult> {
	const mode = options.mode ?? 'smoke';
	const runId = options.runId ?? shortRunId(options.now);
	const env = options.env ?? process.env;
	const fetchImpl = options.fetchImpl ?? fetch;
	const providers = [...new Set(options.providers)];
	const reports = await Promise.all(providers.map((provider) => runProvider({
		provider,
		mode,
		environment: options.environment,
		runId,
		cwd: options.cwd,
		env,
		fetchImpl,
		onProgress: options.onProgress,
	})));
	return {
		command: 'reconcile test-live',
		mode,
		environment: options.environment,
		runId,
		resourcePrefix: `trsd-live-${options.environment}`,
		providers: reports,
		ok: reports.every((report) => report.ok),
	};
}
