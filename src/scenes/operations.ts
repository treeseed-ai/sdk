import { sceneErrorDiagnostic } from './diagnostics.ts';
import type { TreeseedSceneOperationWaitOptions, TreeseedSceneOperationWaitReport } from './types.ts';

const FAILURE_STATUSES = new Set(['failed', 'cancelled', 'timed_out', 'error']);

function sleep(ms: number) {
	return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function valueAt(record: Record<string, unknown>, path: string[]) {
	let current: unknown = record;
	for (const key of path) {
		if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
		current = (current as Record<string, unknown>)[key];
	}
	return current;
}

function operationStatus(operation: Record<string, unknown>) {
	return String(operation.status ?? valueAt(operation, ['operation', 'status']) ?? valueAt(operation, ['payload', 'operation', 'status']) ?? '').trim();
}

function operationKind(operation: Record<string, unknown>) {
	return String(operation.kind ?? operation.operation ?? valueAt(operation, ['operation', 'kind']) ?? valueAt(operation, ['payload', 'operation', 'kind']) ?? '').trim() || null;
}

function operationIdFrom(input: TreeseedSceneOperationWaitOptions) {
	if (input.spec.id) return input.spec.id;
	if (input.spec.source === 'explicit') return null;
	return input.linkedOperationIds?.at(-1) ?? null;
}

async function defaultFetchOperation(input: TreeseedSceneOperationWaitOptions, operationId: string) {
	if (input.fetchOperation) return input.fetchOperation(operationId);
	const serviceId = process.env.TREESEED_ACCEPTANCE_SERVICE_ID ?? process.env.TREESEED_WEB_SERVICE_ID ?? process.env.TREESEED_API_WEB_SERVICE_ID ?? 'web';
	const serviceSecret = process.env.TREESEED_ACCEPTANCE_SERVICE_SECRET ?? process.env.TREESEED_WEB_SERVICE_SECRET ?? process.env.TREESEED_API_WEB_SERVICE_SECRET;
	if (!serviceSecret) throw sceneErrorDiagnostic('scene.operation_unavailable', 'Missing service credentials for platform operation polling.', 'workflow.operation');
	const response = await fetch(`${input.baseUrl.replace(/\/+$/u, '')}/v1/platform/operations/${encodeURIComponent(operationId)}`, {
		headers: {
			accept: 'application/json',
			'x-treeseed-service-id': serviceId,
			'x-treeseed-service-secret': serviceSecret,
		},
	});
	const payload = await response.json().catch(() => ({}));
	if (!response.ok) throw new Error(`Operation polling failed with HTTP ${response.status}.`);
	return payload as Record<string, unknown>;
}

async function defaultFetchEvents(input: TreeseedSceneOperationWaitOptions, operationId: string) {
	if (input.fetchEvents) return input.fetchEvents(operationId);
	return [];
}

export async function waitForTreeseedSceneOperation(input: TreeseedSceneOperationWaitOptions): Promise<TreeseedSceneOperationWaitReport> {
	const started = Date.now();
	const operationId = operationIdFrom(input);
	const acceptedStatuses = input.spec.status ?? [];
	if (!operationId) {
		return {
			ok: false,
			operationId: null,
			kind: input.spec.kind ?? null,
			finalStatus: null,
			acceptedStatuses,
			events: [],
			durationMs: 0,
			diagnostics: [sceneErrorDiagnostic('scene.operation_id_unresolved', 'No operation id was provided or observed for operation polling.', 'workflow.operation')],
		};
	}
	const timeoutMs = Math.max(1000, Math.floor((input.spec.timeoutSeconds ?? 300) * 1000));
	const pollMs = Math.max(250, Math.floor((input.spec.pollIntervalSeconds ?? 2) * 1000));
	const wait = input.sleep ?? sleep;
	let latestStatus: string | null = null;
	let latestKind: string | null = input.spec.kind ?? null;
	let events: unknown[] = [];
	while (Date.now() - started <= timeoutMs) {
		try {
			const payload = await defaultFetchOperation(input, operationId);
			const operation = (payload.operation ?? (payload.payload as Record<string, unknown> | undefined)?.operation ?? payload) as Record<string, unknown>;
			latestStatus = operationStatus(operation);
			latestKind = operationKind(operation) ?? latestKind;
			events = await defaultFetchEvents(input, operationId);
			const tick: TreeseedSceneOperationWaitReport = {
				ok: acceptedStatuses.includes(latestStatus),
				operationId,
				kind: latestKind,
				finalStatus: latestStatus,
				acceptedStatuses,
				events,
				durationMs: Date.now() - started,
				diagnostics: [],
			};
			await input.onUpdate?.(tick);
			if (acceptedStatuses.includes(latestStatus)) return tick;
			if (FAILURE_STATUSES.has(latestStatus)) {
				return { ...tick, ok: false, diagnostics: [sceneErrorDiagnostic('scene.operation_failed', `Operation ${operationId} ended with status ${latestStatus}.`, 'workflow.operation')] };
			}
		} catch (error) {
			const diagnostic = error && typeof error === 'object' && 'code' in error
				? error as ReturnType<typeof sceneErrorDiagnostic>
				: sceneErrorDiagnostic('scene.operation_unavailable', error instanceof Error ? error.message : String(error ?? 'Operation polling failed.'), 'workflow.operation');
			return {
				ok: false,
				operationId,
				kind: latestKind,
				finalStatus: latestStatus,
				acceptedStatuses,
				events,
				durationMs: Date.now() - started,
				diagnostics: [diagnostic],
			};
		}
		await wait(pollMs);
	}
	return {
		ok: false,
		operationId,
		kind: latestKind,
		finalStatus: latestStatus,
		acceptedStatuses,
		events,
		durationMs: Date.now() - started,
		diagnostics: [sceneErrorDiagnostic('scene.operation_poll_timeout', `Operation ${operationId} did not reach an accepted status within ${timeoutMs}ms.`, 'workflow.operation')],
	};
}

export function extractTreeseedSceneOperationIds(value: unknown): string[] {
	if (!value || typeof value !== 'object') return [];
	const record = value as Record<string, unknown>;
	const candidates = [
		record.operationId,
		valueAt(record, ['operation', 'id']),
		valueAt(record, ['payload', 'operation', 'id']),
	];
	return candidates.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}
