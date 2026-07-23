import {
	TREESEED_REMOTE_CONTRACT_HEADER,
	TREESEED_REMOTE_CONTRACT_VERSION,
} from '../remote.ts';


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
