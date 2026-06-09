import {
	TREESEED_REMOTE_CONTRACT_HEADER,
	TREESEED_REMOTE_CONTRACT_VERSION,
} from './remote.ts';

export const PLATFORM_OPERATION_ENDPOINTS = {
	operations: '/v1/platform/operations',
	operation: (operationId: string) => `/v1/platform/operations/${encodeURIComponent(operationId)}`,
	operationEvents: (operationId: string) => `/v1/platform/operations/${encodeURIComponent(operationId)}/events`,
	cancelOperation: (operationId: string) => `/v1/platform/operations/${encodeURIComponent(operationId)}/cancel`,
	retryOperation: (operationId: string) => `/v1/platform/operations/${encodeURIComponent(operationId)}/retry`,
	registerRunner: '/v1/platform/runners/register',
	heartbeatRunner: '/v1/platform/runners/heartbeat',
	claimJob: '/v1/platform/runners/jobs/claim',
	runnerJob: (operationId: string) => `/v1/platform/runners/jobs/${encodeURIComponent(operationId)}`,
	jobEvents: (operationId: string) => `/v1/platform/runners/jobs/${encodeURIComponent(operationId)}/events`,
	renewLeaseJob: (operationId: string) => `/v1/platform/runners/jobs/${encodeURIComponent(operationId)}/renew-lease`,
	checkpointJob: (operationId: string) => `/v1/platform/runners/jobs/${encodeURIComponent(operationId)}/checkpoint`,
	completeJob: (operationId: string) => `/v1/platform/runners/jobs/${encodeURIComponent(operationId)}/complete`,
	failJob: (operationId: string) => `/v1/platform/runners/jobs/${encodeURIComponent(operationId)}/fail`,
} as const;

export const PLATFORM_OPERATION_SCOPES = [
	'platform:runners:register',
	'platform:runners:claim',
	'platform:runners:update',
	'platform:operations:create',
	'platform:operations:read',
	'platform:operations:cancel',
	'platform:operations:retry',
	'platform:repository:write',
	'platform:deploy:write',
	'platform:database:migrate',
] as const;

export const PLATFORM_OPERATION_NAMESPACES = [
	'market',
	'repository',
	'deploy',
	'database',
	'seed',
	'infrastructure',
	'catalog',
] as const;

export const PLATFORM_OPERATION_STATUSES = [
	'queued',
	'leased',
	'running',
	'waiting_for_approval',
	'succeeded',
	'failed',
	'cancelled',
] as const;

export const PLATFORM_OPERATION_TARGETS = [
	'market_operations_runner',
	'github_actions',
	'cli',
	'railway_job',
] as const;

export type PlatformOperationScope = (typeof PLATFORM_OPERATION_SCOPES)[number];
export type PlatformOperationNamespace = (typeof PLATFORM_OPERATION_NAMESPACES)[number] | string;
export type PlatformOperationStatus = (typeof PLATFORM_OPERATION_STATUSES)[number] | string;
export type PlatformOperationTarget = (typeof PLATFORM_OPERATION_TARGETS)[number] | string;

export interface PlatformOperationRequestedBy {
	type: 'user' | 'service' | 'team_api_key' | 'platform_runner' | string;
	id?: string | null;
}

export interface PlatformOperation {
	id: string;
	namespace: PlatformOperationNamespace;
	operation: string;
	status: PlatformOperationStatus;
	target: PlatformOperationTarget;
	idempotencyKey?: string | null;
	input: Record<string, unknown>;
	output?: unknown;
	error?: unknown;
	requestedByType: string;
	requestedById?: string | null;
	assignedRunnerId?: string | null;
	leaseExpiresAt?: string | null;
	createdAt: string;
	updatedAt: string;
	startedAt?: string | null;
	finishedAt?: string | null;
	cancelledAt?: string | null;
}

export interface PlatformOperationEvent {
	id: string;
	operationId: string;
	seq: number;
	kind: string;
	data: Record<string, unknown>;
	createdAt: string;
}

export interface PlatformOperationInput {
	namespace: PlatformOperationNamespace;
	operation: string;
	target?: PlatformOperationTarget;
	idempotencyKey?: string | null;
	input?: Record<string, unknown>;
	requestedBy?: PlatformOperationRequestedBy;
	status?: PlatformOperationStatus;
}

export interface PlatformOperationEventInput {
	kind: string;
	data?: Record<string, unknown>;
}

export interface PlatformRunnerRegistrationRequest {
	runnerId: string;
	runnerKey?: string;
	name?: string;
	environment: string;
	version?: string;
	capabilities?: string[];
	maxConcurrentJobs?: number;
	metadata?: Record<string, unknown>;
}

export interface PlatformRunnerHeartbeatRequest {
	runnerId: string;
	status?: 'online' | 'offline' | 'degraded' | string;
	activeJobCount?: number;
	maxConcurrentJobs?: number;
	capabilities?: string[];
	metadata?: Record<string, unknown>;
	version?: string;
	environment?: string;
}

export interface PlatformRunnerClaimRequest {
	runnerId: string;
	limit?: number;
	leaseSeconds?: number;
	operationId?: string;
	namespaces?: string[];
	capabilities?: string[];
}

export interface PlatformRunnerJobUpdateRequest {
	runnerId: string;
	output?: unknown;
	error?: unknown;
	event?: PlatformOperationEventInput;
}

export interface PlatformRunnerClientOptions {
	marketUrl: string;
	marketId: string;
	runnerSecret: string;
	fetchImpl?: typeof fetch;
	userAgent?: string;
}

export interface PlatformOperationExecutorContext {
	operation: PlatformOperation;
	operationId: string;
	workspaceRoot: string;
	environment: string;
	emit(event: PlatformOperationEventInput): Promise<void>;
	checkpoint(output: unknown, event?: PlatformOperationEventInput): Promise<void>;
	renewLease(leaseSeconds?: number): Promise<PlatformOperation>;
	throwIfCancelled(): Promise<void>;
}

export interface PlatformOperationExecutor<TInput = Record<string, unknown>, TOutput = unknown> {
	namespace: PlatformOperationNamespace;
	operation: string;
	run(input: TInput, context: PlatformOperationExecutorContext): Promise<TOutput>;
}

export interface PlatformOperationRunnerCoreClient {
	claimJob(request: PlatformRunnerClaimRequest): Promise<{ ok: true; operation: PlatformOperation | null }>;
	getOperation?(operationId: string): Promise<{ ok: true; operation: PlatformOperation }>;
	appendEvent(operationId: string, request: PlatformRunnerJobUpdateRequest): Promise<{ ok: true; event: PlatformOperationEvent }>;
	renewLease?(operationId: string, request: PlatformRunnerJobUpdateRequest & { leaseSeconds?: number }): Promise<{ ok: true; operation: PlatformOperation }>;
	checkpoint(operationId: string, request: PlatformRunnerJobUpdateRequest): Promise<{ ok: true; operation: PlatformOperation }>;
	complete(operationId: string, request: PlatformRunnerJobUpdateRequest): Promise<{ ok: true; operation: PlatformOperation }>;
	fail(operationId: string, request: PlatformRunnerJobUpdateRequest): Promise<{ ok: true; operation: PlatformOperation }>;
	cancel?(operationId: string, request: PlatformRunnerJobUpdateRequest): Promise<{ ok: true; operation: PlatformOperation }>;
}

export interface PlatformOperationRunnerCoreOptions {
	client: PlatformOperationRunnerCoreClient;
	runnerId: string;
	workspaceRoot: string;
	environment: string;
	executors: PlatformOperationExecutor[];
	operationId?: string | null;
	leaseSeconds?: number;
	limit?: number;
	throwIfCancelled?: (operation: PlatformOperation) => Promise<void>;
}

export interface PlatformOperationRunOnceResult {
	ok: boolean;
	claimed: boolean;
	operation: PlatformOperation | null;
	output?: unknown;
	error?: unknown;
}

export interface PlatformOperationNavigationResult {
	href: string | null;
	changedPaths: string[];
	branch: string | null;
	commitSha: string | null;
}

export interface PlatformOperationPollOptions {
	operationId: string;
	fetchOperation(operationId: string): Promise<PlatformOperation>;
	fetchEvents?(operationId: string): Promise<PlatformOperationEvent[]>;
	onUpdate?(snapshot: { operation: PlatformOperation; events: PlatformOperationEvent[]; terminal: boolean }): void | Promise<void>;
	intervalMs?: number;
	timeoutMs?: number;
	sleep?(ms: number): Promise<void>;
}

export interface PlatformOperationPollResult {
	operation: PlatformOperation;
	events: PlatformOperationEvent[];
	terminal: boolean;
	navigation: PlatformOperationNavigationResult;
}

export function buildPlatformRunnerAuthHeaders(secret: string): Record<string, string> {
	return {
		authorization: `Bearer ${secret}`,
	};
}

export function isPlatformOperationTerminal(operation: Pick<PlatformOperation, 'status'> | null | undefined) {
	return ['succeeded', 'failed', 'cancelled'].includes(String(operation?.status ?? ''));
}

export function isPlatformOperationSuccessful(operation: Pick<PlatformOperation, 'status'> | null | undefined) {
	return String(operation?.status ?? '') === 'succeeded';
}

function nestedRecord(value: unknown, keys: string[]): Record<string, unknown> | null {
	let current: unknown = value;
	for (const key of keys) {
		if (!isRecord(current)) return null;
		current = current[key];
	}
	return isRecord(current) ? current : null;
}

function firstString(...values: unknown[]) {
	for (const value of values) {
		if (typeof value === 'string' && value.trim()) return value.trim();
	}
	return null;
}

function stringArray(value: unknown) {
	return Array.isArray(value) ? value.map((entry) => String(entry).trim()).filter(Boolean) : [];
}

export function derivePlatformOperationNavigation(operation: PlatformOperation): PlatformOperationNavigationResult {
	const output = isRecord(operation.output) ? operation.output : {};
	const nestedOutput = nestedRecord(output, ['output']) ?? {};
	const record = nestedRecord(output, ['record']) ?? nestedRecord(nestedOutput, ['record']);
	const child = nestedRecord(output, ['child']) ?? nestedRecord(nestedOutput, ['child']);
	const decision = nestedRecord(output, ['decision']) ?? nestedRecord(nestedOutput, ['decision']);
	const changedPaths = [
		...stringArray(output.changedPaths),
		...stringArray(nestedOutput.changedPaths),
	];
	return {
		href: firstString(output.href, nestedOutput.href, record?.href, child?.href, decision?.href),
		changedPaths: [...new Set(changedPaths)],
		branch: firstString(output.branch, nestedOutput.branch),
		commitSha: firstString(output.commitSha, nestedOutput.commitSha),
	};
}

export async function pollPlatformOperation(options: PlatformOperationPollOptions): Promise<PlatformOperationPollResult> {
	const intervalMs = Math.max(0, options.intervalMs ?? 1000);
	const timeoutMs = Math.max(intervalMs, options.timeoutMs ?? 120_000);
	const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
	const startedAt = Date.now();
	let latestOperation: PlatformOperation | null = null;
	let latestEvents: PlatformOperationEvent[] = [];
	while (Date.now() - startedAt <= timeoutMs) {
		latestOperation = await options.fetchOperation(options.operationId);
		latestEvents = options.fetchEvents ? await options.fetchEvents(options.operationId) : [];
		const terminal = isPlatformOperationTerminal(latestOperation);
		await options.onUpdate?.({ operation: latestOperation, events: latestEvents, terminal });
		if (terminal) {
			return {
				operation: latestOperation,
				events: latestEvents,
				terminal,
				navigation: derivePlatformOperationNavigation(latestOperation),
			};
		}
		await sleep(intervalMs);
	}
	if (!latestOperation) {
		throw new Error(`Platform operation "${options.operationId}" was not found before polling timed out.`);
	}
	return {
		operation: latestOperation,
		events: latestEvents,
		terminal: false,
		navigation: derivePlatformOperationNavigation(latestOperation),
	};
}

function normalizeBaseUrl(value: string) {
	return value.trim().replace(/\/+$/u, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export class PlatformOperationApiError extends Error {
	readonly status: number;
	readonly payload: unknown;

	constructor(message: string, status: number, payload: unknown) {
		super(message);
		this.name = 'PlatformOperationApiError';
		this.status = status;
		this.payload = payload;
	}
}

export function assertPlatformOperationOkEnvelope(value: unknown, label = 'Platform operation response') {
	if (!isRecord(value) || value.ok !== true) {
		throw new Error(`${label} is missing ok: true.`);
	}
}

export function assertPlatformOperation(value: unknown, label = 'Platform operation'): asserts value is PlatformOperation {
	if (!isRecord(value)) throw new Error(`${label} must be an object.`);
	for (const key of ['id', 'namespace', 'operation', 'status', 'target', 'createdAt', 'updatedAt']) {
		if (typeof value[key] !== 'string' || !String(value[key]).trim()) {
			throw new Error(`${label} is missing ${key}.`);
		}
	}
	if (!isRecord(value.input)) throw new Error(`${label} is missing input.`);
}

export function assertPlatformOperationEvent(value: unknown, label = 'Platform operation event'): asserts value is PlatformOperationEvent {
	if (!isRecord(value)) throw new Error(`${label} must be an object.`);
	for (const key of ['id', 'operationId', 'kind', 'createdAt']) {
		if (typeof value[key] !== 'string' || !String(value[key]).trim()) {
			throw new Error(`${label} is missing ${key}.`);
		}
	}
	if (!Number.isFinite(Number(value.seq))) throw new Error(`${label} is missing seq.`);
	if (!isRecord(value.data)) throw new Error(`${label} is missing data.`);
}

export function createPlatformOperationExecutorRegistry(executors: PlatformOperationExecutor[]) {
	const registry = new Map<string, PlatformOperationExecutor>();
	for (const executor of executors) {
		registry.set(`${executor.namespace}:${executor.operation}`, executor);
	}
	return {
		get(operation: PlatformOperation) {
			return registry.get(`${operation.namespace}:${operation.operation}`) ?? null;
		},
		keys() {
			return [...registry.keys()];
		},
	};
}

export async function runPlatformOperationOnce(options: PlatformOperationRunnerCoreOptions): Promise<PlatformOperationRunOnceResult> {
	const registry = createPlatformOperationExecutorRegistry(options.executors);
	const claimed = await options.client.claimJob({
		runnerId: options.runnerId,
		operationId: options.operationId ?? undefined,
		capabilities: registry.keys(),
		limit: options.limit ?? 1,
		leaseSeconds: options.leaseSeconds ?? 300,
	});
	let operation = claimed.operation;
	if (!operation) {
		return { ok: true, claimed: false, operation: null };
	}
	const executor = registry.get(operation);
	if (!executor) {
		const message = `No executor registered for platform operation "${operation.namespace}:${operation.operation}".`;
		const failed = await options.client.fail(operation.id, {
			runnerId: options.runnerId,
			error: { message },
			event: { kind: 'runner.executor_missing', data: { namespace: operation.namespace, operation: operation.operation } },
		});
		return { ok: false, claimed: true, operation: failed.operation, error: { message } };
	}
	const context: PlatformOperationExecutorContext = {
		operation,
		operationId: operation.id,
		workspaceRoot: options.workspaceRoot,
		environment: options.environment,
		emit: async (event) => {
			await options.client.appendEvent(operation.id, {
				runnerId: options.runnerId,
				event,
			});
		},
		checkpoint: async (output, event) => {
			await context.throwIfCancelled();
			await options.client.checkpoint(operation.id, {
				runnerId: options.runnerId,
				output,
				event,
			});
		},
		renewLease: async (leaseSeconds) => {
			if (!options.client.renewLease) return operation;
			const renewed = await options.client.renewLease(operation.id, {
				runnerId: options.runnerId,
				leaseSeconds,
				event: { kind: 'runner.lease_renewed', data: { leaseSeconds: leaseSeconds ?? options.leaseSeconds ?? 300 } },
			});
			operation = renewed.operation;
			return renewed.operation;
		},
		throwIfCancelled: async () => {
			const latest = options.client.getOperation ? (await options.client.getOperation(operation.id)).operation : operation;
			operation = latest;
			if (latest.status === 'cancelled') throw new Error('Platform operation was cancelled.');
			await options.throwIfCancelled?.(operation);
		},
	};
	try {
		await context.emit({ kind: 'runner.started', data: { namespace: operation.namespace, operation: operation.operation } });
		await context.throwIfCancelled();
		await context.renewLease(options.leaseSeconds);
		const output = await executor.run(operation.input, context);
		await context.throwIfCancelled();
		const completed = await options.client.complete(operation.id, {
			runnerId: options.runnerId,
			output,
		});
		return { ok: true, claimed: true, operation: completed.operation, output };
	} catch (error) {
		const failure = {
			message: error instanceof Error ? error.message : String(error),
		};
		const eventKind = failure.message.toLowerCase().includes('cancel')
			? 'runner.cancelled'
			: 'runner.retry_safe_failure';
		if (eventKind === 'runner.cancelled' && options.client.cancel) {
			const cancelled = await options.client.cancel(operation.id, {
				runnerId: options.runnerId,
				error: failure,
				event: { kind: eventKind, data: failure },
			});
			return { ok: false, claimed: true, operation: cancelled.operation, error: failure };
		}
		if (eventKind === 'runner.cancelled' && options.client.getOperation) {
			await options.client.appendEvent(operation.id, {
				runnerId: options.runnerId,
				event: { kind: eventKind, data: failure },
			}).catch(() => {});
			const latest = await options.client.getOperation(operation.id);
			return { ok: false, claimed: true, operation: latest.operation, error: failure };
		}
		const failed = await options.client.fail(operation.id, {
			runnerId: options.runnerId,
			error: failure,
			event: { kind: eventKind, data: failure },
		});
		return { ok: false, claimed: true, operation: failed.operation, error: failure };
	}
}

export class PlatformRunnerClient {
	private readonly marketUrl: string;
	private readonly marketId: string;
	private readonly runnerSecret: string;
	private readonly fetchImpl: typeof fetch;
	private readonly userAgent?: string;

	constructor(options: PlatformRunnerClientOptions) {
		this.marketUrl = normalizeBaseUrl(options.marketUrl);
		this.marketId = options.marketId.trim();
		this.runnerSecret = options.runnerSecret.trim();
		if (!this.marketUrl) throw new Error('API URL is required.');
		if (!this.marketId) throw new Error('Market ID is required.');
		if (!this.runnerSecret) throw new Error('Platform runner secret is required.');
		this.fetchImpl = options.fetchImpl ?? fetch;
		this.userAgent = options.userAgent;
	}

	private async requestJson<T>(path: string, options: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<T> {
		const headers: Record<string, string> = {
			accept: 'application/json',
			[TREESEED_REMOTE_CONTRACT_HEADER]: String(TREESEED_REMOTE_CONTRACT_VERSION),
			...buildPlatformRunnerAuthHeaders(this.runnerSecret),
		};
		if (this.userAgent) headers['user-agent'] = this.userAgent;
		if (options.body !== undefined) headers['content-type'] = 'application/json';
		const response = await this.fetchImpl(`${this.marketUrl}${path}`, {
			method: options.method ?? 'GET',
			headers,
			body: options.body === undefined ? undefined : JSON.stringify(options.body),
		});
		const payload = await response.json().catch(() => ({}));
		if (!response.ok) {
			const message = isRecord(payload) && typeof payload.error === 'string'
				? payload.error
				: `Platform operation request failed with ${response.status}.`;
			throw new PlatformOperationApiError(message, response.status, payload);
		}
		return payload as T;
	}

	register(request: PlatformRunnerRegistrationRequest) {
		return this.requestJson<{ ok: true; runner: Record<string, unknown> }>(PLATFORM_OPERATION_ENDPOINTS.registerRunner, {
			method: 'POST',
			body: { ...request, marketId: this.marketId },
		}).then((response) => {
			assertPlatformOperationOkEnvelope(response, 'Platform runner registration response');
			return response;
		});
	}

	heartbeat(request: PlatformRunnerHeartbeatRequest) {
		return this.requestJson<{ ok: true; runner: Record<string, unknown> }>(PLATFORM_OPERATION_ENDPOINTS.heartbeatRunner, {
			method: 'POST',
			body: { ...request, marketId: this.marketId },
		}).then((response) => {
			assertPlatformOperationOkEnvelope(response, 'Platform runner heartbeat response');
			return response;
		});
	}

	claimJob(request: PlatformRunnerClaimRequest) {
		return this.requestJson<{ ok: true; operation: PlatformOperation | null }>(PLATFORM_OPERATION_ENDPOINTS.claimJob, {
			method: 'POST',
			body: { ...request, marketId: this.marketId },
		}).then((response) => {
			assertPlatformOperationOkEnvelope(response, 'Platform runner claim response');
			if (response.operation !== null) assertPlatformOperation(response.operation, 'Claimed platform operation');
			return response;
		});
	}

	getOperation(operationId: string) {
		return this.requestJson<{ ok: true; operation: PlatformOperation }>(PLATFORM_OPERATION_ENDPOINTS.runnerJob(operationId), {
			method: 'GET',
		}).then((response) => {
			assertPlatformOperationOkEnvelope(response, 'Platform operation response');
			assertPlatformOperation(response.operation);
			return response;
		});
	}

	appendEvent(operationId: string, request: PlatformRunnerJobUpdateRequest) {
		return this.requestJson<{ ok: true; event: PlatformOperationEvent }>(PLATFORM_OPERATION_ENDPOINTS.jobEvents(operationId), {
			method: 'POST',
			body: { ...request, marketId: this.marketId },
		}).then((response) => {
			assertPlatformOperationOkEnvelope(response, 'Platform operation event response');
			assertPlatformOperationEvent(response.event);
			return response;
		});
	}

	renewLease(operationId: string, request: PlatformRunnerJobUpdateRequest & { leaseSeconds?: number }) {
		return this.requestJson<{ ok: true; operation: PlatformOperation }>(PLATFORM_OPERATION_ENDPOINTS.renewLeaseJob(operationId), {
			method: 'POST',
			body: { ...request, marketId: this.marketId },
		}).then((response) => {
			assertPlatformOperationOkEnvelope(response, 'Platform operation lease renewal response');
			assertPlatformOperation(response.operation);
			return response;
		});
	}

	checkpoint(operationId: string, request: PlatformRunnerJobUpdateRequest) {
		return this.requestJson<{ ok: true; operation: PlatformOperation }>(PLATFORM_OPERATION_ENDPOINTS.checkpointJob(operationId), {
			method: 'POST',
			body: { ...request, marketId: this.marketId },
		}).then((response) => {
			assertPlatformOperationOkEnvelope(response, 'Platform operation checkpoint response');
			assertPlatformOperation(response.operation);
			return response;
		});
	}

	complete(operationId: string, request: PlatformRunnerJobUpdateRequest) {
		return this.requestJson<{ ok: true; operation: PlatformOperation }>(PLATFORM_OPERATION_ENDPOINTS.completeJob(operationId), {
			method: 'POST',
			body: { ...request, marketId: this.marketId },
		}).then((response) => {
			assertPlatformOperationOkEnvelope(response, 'Platform operation completion response');
			assertPlatformOperation(response.operation);
			return response;
		});
	}

	fail(operationId: string, request: PlatformRunnerJobUpdateRequest) {
		return this.requestJson<{ ok: true; operation: PlatformOperation }>(PLATFORM_OPERATION_ENDPOINTS.failJob(operationId), {
			method: 'POST',
			body: { ...request, marketId: this.marketId },
		}).then((response) => {
			assertPlatformOperationOkEnvelope(response, 'Platform operation failure response');
			assertPlatformOperation(response.operation);
			return response;
		});
	}

	cancel(operationId: string, request: PlatformRunnerJobUpdateRequest) {
		return this.requestJson<{ ok: true; operation: PlatformOperation }>(`${PLATFORM_OPERATION_ENDPOINTS.runnerJob(operationId)}/cancel`, {
			method: 'POST',
			body: { ...request, marketId: this.marketId },
		}).then((response) => {
			assertPlatformOperationOkEnvelope(response, 'Platform operation cancellation response');
			assertPlatformOperation(response.operation);
			return response;
		});
	}
}
