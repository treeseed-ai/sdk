import { performance } from 'node:perf_hooks';
import { createTreeseedCanonicalReconcileReport, type TreeseedCanonicalAction, type TreeseedCanonicalDrift, type TreeseedCanonicalGraphNode, type TreeseedCanonicalPostcondition } from './platform.ts';
import type { RunTreeseedLiveReconcileTestsOptions, TreeseedLiveReconcileEnvironment, TreeseedLiveReconcileMode, TreeseedLiveReconcileProgressEvent, TreeseedLiveReconcileProvider, TreeseedLiveReconcileProviderReport, TreeseedLiveReconcileScenarioResult } from './live-acceptance.ts';

type LiveProgress = RunTreeseedLiveReconcileTestsOptions['onProgress'];

export const PROVIDER_CAPABILITIES: Record<TreeseedLiveReconcileProvider, string[]> = {
	railway: ['project', 'environment', 'service', 'image-service', 'postgres', 'volume', 'domain', 'variables', 'deployment-health', 'capacity-provider-runtime-assignment-proof'],
	cloudflare: ['pages', 'worker', 'd1', 'r2', 'kv', 'queue', 'dns', 'turnstile', 'secrets', 'cache-rules'],
	github: ['environment', 'secret', 'variable', 'workflow-dispatch', 'workflow-observation', 'repository-scoped-token'],
	local: ['process', 'port', 'local-db', 'local-runner', 'docker-compose-capacity-provider', 'capacity-provider-assignment-proof'],
};
export function shortRunId(now = new Date()) {
	return now.toISOString().replace(/[^0-9]/gu, '').slice(0, 14);
}

export function providerPrefix(environment: string, provider: TreeseedLiveReconcileProvider, runId: string) {
	if (provider === 'railway') return `trsd-rail-${runId}`.toLowerCase();
	return `trsd-live-${environment}-${provider}-${runId}`.toLowerCase();
}

export function providerPrefixRoot(environment: string, provider: TreeseedLiveReconcileProvider) {
	if (provider === 'railway') return 'trsd-rail-';
	return `trsd-live-${environment}-${provider}-`.toLowerCase();
}

export function emitProgress(
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

export async function waitForLiveObservation<T>(
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
export function scenario({
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

export function node(provider: TreeseedLiveReconcileProvider, environment: string, type: string, id: string, state: Record<string, unknown> = {}): TreeseedCanonicalGraphNode {
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

export function providerNode(provider: TreeseedLiveReconcileProvider, environment: string, type: string, id: string, state: Record<string, unknown> = {}) {
	return node(provider, environment, type, id, redactProviderState(state) as Record<string, unknown>);
}

export function blocking(provider: TreeseedLiveReconcileProvider, type: string, reason: string): TreeseedCanonicalDrift {
	return {
		id: `live-test:${provider}:${type}:blocked`,
		resourceId: `live-test:${provider}:${type}`,
		severity: 'blocking',
		reason,
		provider,
		type,
	};
}

export async function measuredScenario(
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

export function reportForProvider({
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
