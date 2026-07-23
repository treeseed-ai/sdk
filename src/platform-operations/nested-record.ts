import {
	TREESEED_REMOTE_CONTRACT_HEADER,
	TREESEED_REMOTE_CONTRACT_VERSION,
} from '../remote.ts';
import { PlatformOperation, PlatformOperationEvent, PlatformOperationExecutor, PlatformOperationExecutorContext, PlatformOperationNavigationResult, PlatformOperationPollOptions, PlatformOperationPollResult, PlatformOperationRunOnceResult, PlatformOperationRunnerCoreOptions, isPlatformOperationTerminal } from './platform-operation-endpoints.ts';

export function nestedRecord(value: unknown, keys: string[]): Record<string, unknown> | null {
	let current: unknown = value;
	for (const key of keys) {
		if (!isRecord(current)) return null;
		current = current[key];
	}
	return isRecord(current) ? current : null;
}

export function firstString(...values: unknown[]) {
	for (const value of values) {
		if (typeof value === 'string' && value.trim()) return value.trim();
	}
	return null;
}

export function stringArray(value: unknown) {
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

export function normalizeBaseUrl(value: string) {
	return value.trim().replace(/\/+$/u, '');
}

export function isRecord(value: unknown): value is Record<string, unknown> {
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
