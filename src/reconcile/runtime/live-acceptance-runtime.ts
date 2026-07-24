import { performance } from 'node:perf_hooks';
import { createCanonicalReconcileReport, type CanonicalAction, type CanonicalDrift, type CanonicalGraphNode, type CanonicalPostcondition } from '../support/state/platform.ts';
import type { RunLiveReconcileTestsOptions, LiveReconcileEnvironment, LiveReconcileMode, LiveReconcileProgressEvent, LiveReconcileProvider, LiveReconcileProviderReport, LiveReconcileScenarioResult } from '../support/acceptance/live-acceptance.ts';

type LiveProgress = RunLiveReconcileTestsOptions['onProgress'];

export const PROVIDER_CAPABILITIES: Record<LiveReconcileProvider, string[]> = {
	railway: ['project', 'environment', 'service', 'image-service', 'postgres', 'volume', 'domain', 'variables', 'deployment-health', 'capacity-provider-runtime-assignment-proof'],
	cloudflare: ['pages', 'worker', 'd1', 'r2', 'kv', 'queue', 'dns', 'turnstile', 'secrets', 'cache-rules'],
	github: ['environment', 'secret', 'variable', 'workflow-dispatch', 'workflow-observation', 'repository-scoped-token'],
	local: ['process', 'port', 'local-db', 'local-runner', 'docker-compose-capacity-provider', 'capacity-provider-assignment-proof'],
};
export function shortRunId(now = new Date()) {
	return now.toISOString().replace(/[^0-9]/gu, '').slice(0, 14);
}

export function providerPrefix(environment: string, provider: LiveReconcileProvider, runId: string) {
	if (provider === 'railway') return `trsd-rail-${runId}`.toLowerCase();
	return `trsd-live-${environment}-${provider}-${runId}`.toLowerCase();
}

export function providerPrefixRoot(environment: string, provider: LiveReconcileProvider) {
	if (provider === 'railway') return 'trsd-rail-';
	return `trsd-live-${environment}-${provider}-`.toLowerCase();
}

export function emitProgress(
	onProgress: LiveProgress,
	event: Omit<LiveReconcileProgressEvent, 'message'> & { message?: string },
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
	provider: LiveReconcileProvider;
	mode: LiveReconcileMode;
	prefix: string;
	capability: string;
	ok: boolean;
	phase: LiveReconcileScenarioResult['phase'];
	action: CanonicalAction['kind'];
	reason: string;
	locators?: Record<string, string | null>;
	createdResources?: CanonicalGraphNode[];
	updatedResources?: CanonicalGraphNode[];
	replacedResources?: CanonicalGraphNode[];
	destroyedResources?: CanonicalGraphNode[];
	retainedResources?: CanonicalGraphNode[];
	issues?: string[];
	startedAt?: string;
	completedAt?: string;
	durationMs?: number;
}): LiveReconcileScenarioResult {
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

export function node(provider: LiveReconcileProvider, environment: string, type: string, id: string, state: Record<string, unknown> = {}): CanonicalGraphNode {
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

export function providerNode(provider: LiveReconcileProvider, environment: string, type: string, id: string, state: Record<string, unknown> = {}) {
	return node(provider, environment, type, id, redactProviderState(state) as Record<string, unknown>);
}

export function blocking(provider: LiveReconcileProvider, type: string, reason: string): CanonicalDrift {
	return {
		id: `live-test:${provider}:${type}:blocked`,
		resourceId: `live-test:${provider}:${type}`,
		severity: 'blocking',
		reason,
		provider,
		type,
	};
}

export function describeLiveAcceptanceError(error: unknown): string {
	if (!(error instanceof Error)) return String(error);
	if (!(error instanceof AggregateError) || error.errors.length === 0) return error.message;
	return `${error.message} [${error.errors.map(describeLiveAcceptanceError).join('; ')}]`;
}

export async function measuredScenario(
	input: {
		provider: LiveReconcileProvider;
		mode: LiveReconcileMode;
		environment: LiveReconcileEnvironment;
		runId: string;
		prefix: string;
		capability: string;
		phase: LiveReconcileScenarioResult['phase'];
		action: CanonicalAction['kind'];
		startMessage?: string;
		successReason: string | ((value: unknown) => string);
		locators?: Record<string, string | null>;
		createdResources?: CanonicalGraphNode[] | ((value: unknown) => CanonicalGraphNode[]);
		updatedResources?: CanonicalGraphNode[] | ((value: unknown) => CanonicalGraphNode[]);
		replacedResources?: CanonicalGraphNode[] | ((value: unknown) => CanonicalGraphNode[]);
		destroyedResources?: CanonicalGraphNode[] | ((value: unknown) => CanonicalGraphNode[]);
		retainedResources?: CanonicalGraphNode[] | ((value: unknown) => CanonicalGraphNode[]);
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
		const resourcesFor = (resources: CanonicalGraphNode[] | ((value: unknown) => CanonicalGraphNode[]) | undefined) =>
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
		const reason = describeLiveAcceptanceError(error);
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
	provider: LiveReconcileProvider;
	mode: LiveReconcileMode;
	runId: string;
	prefix: string;
	environment: LiveReconcileEnvironment;
	results: LiveReconcileScenarioResult[];
	cleanupDrift?: CanonicalDrift[];
}): LiveReconcileProviderReport {
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
	const actions: CanonicalAction[] = desiredGraph.map((entry) => {
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
	const postconditions: CanonicalPostcondition[] = desiredGraph.map((entry) => {
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
	const report = createCanonicalReconcileReport({
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
