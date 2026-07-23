import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
	PLATFORM_OPERATION_ENDPOINTS,
	PLATFORM_OPERATION_SCOPES,
	PlatformOperationApiError,
	PlatformRunnerClient,
	TREESEED_REMOTE_CONTRACT_HEADER,
	TREESEED_REMOTE_CONTRACT_VERSION,
	assertPlatformOperation,
	assertPlatformOperationEvent,
	buildPlatformRunnerAuthHeaders,
	derivePlatformOperationNavigation,
	isPlatformOperationSuccessful,
	isPlatformOperationTerminal,
	pollPlatformOperation,
	runPlatformOperationOnce,
} from '../../../src/index.ts';
import {
	PlatformOperationStore,
	createSqliteRelationalAdapter,
} from '../../../src/platform-operation-store.ts';

function jsonResponse(payload: unknown, status = 200) {
	return new Response(JSON.stringify(payload), {
		status,
		headers: {
			'content-type': 'application/json',
			[TREESEED_REMOTE_CONTRACT_HEADER]: String(TREESEED_REMOTE_CONTRACT_VERSION),
		},
	});
}

function operation(overrides: Record<string, unknown> = {}) {
	return {
		id: 'op_123',
		namespace: 'repository',
		operation: 'write_content_record',
		status: 'leased',
		target: 'market_operations_runner',
		input: { collection: 'notes' },
		requestedByType: 'user',
		requestedById: 'user-1',
		assignedRunnerId: 'runner-1',
		idempotencyKey: 'write:notes:one',
		leaseExpiresAt: '2026-01-01T00:05:00.000Z',
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		startedAt: null,
		finishedAt: null,
		cancelledAt: null,
		...overrides,
	};
}

describe('platform operation SDK contracts', () => {
	it('exposes platform scopes and runner auth headers', () => {
		expect(PLATFORM_OPERATION_SCOPES).toContain('platform:runners:claim');
		expect(PLATFORM_OPERATION_SCOPES).toContain('platform:repository:write');
		expect(buildPlatformRunnerAuthHeaders('secret')).toEqual({ authorization: 'Bearer secret' });
	});

	it('validates operation and event shapes', () => {
		const op = operation();
		expect(() => assertPlatformOperation(op)).not.toThrow();
		expect(() => assertPlatformOperation({ ...op, input: null })).toThrow(/input/u);
		expect(() => assertPlatformOperationEvent({
			id: 'evt_1',
			operationId: 'op_123',
			seq: 1,
			kind: 'claimed',
			data: {},
			createdAt: '2026-01-01T00:00:00.000Z',
		})).not.toThrow();
	});

	it('maps runner client requests to API service-auth endpoints', async () => {
		const calls: Array<{ url: string; init: RequestInit }> = [];
		const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
			calls.push({ url, init });
			if (url.endsWith(PLATFORM_OPERATION_ENDPOINTS.claimJob)) {
				return jsonResponse({ ok: true, operation: operation() });
			}
			if (url.endsWith(PLATFORM_OPERATION_ENDPOINTS.runnerJob('op_123'))) {
				return jsonResponse({ ok: true, operation: operation() });
			}
			if (url.endsWith(PLATFORM_OPERATION_ENDPOINTS.renewLeaseJob('op_123'))) {
				return jsonResponse({ ok: true, operation: operation({ leaseExpiresAt: '2026-01-01T00:10:00.000Z' }) });
			}
			if (url.endsWith('/events')) {
				return jsonResponse({
					ok: true,
					event: {
						id: 'evt_1',
						operationId: 'op_123',
						seq: 1,
						kind: 'runner.progress',
						data: {},
						createdAt: '2026-01-01T00:00:00.000Z',
					},
				});
			}
			return jsonResponse({ ok: true, runner: { id: 'runner-1' } });
		});
		const client = new PlatformRunnerClient({
			marketUrl: 'https://api.example.com/',
			marketId: 'staging',
			runnerSecret: 'platform-secret',
			fetchImpl: fetchImpl as unknown as typeof fetch,
			userAgent: 'platform-runner-test',
		});

		await client.register({ runnerId: 'runner-1', environment: 'staging' });
		const claimed = await client.claimJob({ runnerId: 'runner-1', limit: 1, leaseSeconds: 60 });
		await client.getOperation('op_123');
		await client.renewLease('op_123', { runnerId: 'runner-1', leaseSeconds: 120 });
		await client.appendEvent('op_123', { runnerId: 'runner-1', event: { kind: 'runner.progress', data: {} } });

		expect(claimed.operation?.id).toBe('op_123');
		expect(calls.map((call) => call.url)).toEqual([
			'https://api.example.com/v1/platform/runners/register',
			'https://api.example.com/v1/platform/runners/jobs/claim',
			'https://api.example.com/v1/platform/runners/jobs/op_123',
			'https://api.example.com/v1/platform/runners/jobs/op_123/renew-lease',
			'https://api.example.com/v1/platform/runners/jobs/op_123/events',
		]);
		for (const call of calls) {
			expect(call.init.headers).toMatchObject({
				authorization: 'Bearer platform-secret',
				accept: 'application/json',
				'user-agent': 'platform-runner-test',
				[TREESEED_REMOTE_CONTRACT_HEADER]: String(TREESEED_REMOTE_CONTRACT_VERSION),
			});
		}
		expect(JSON.parse(String(calls[1]?.init.body))).toMatchObject({
			marketId: 'staging',
			runnerId: 'runner-1',
			limit: 1,
		});
	});

	it('throws typed API errors for non-ok responses', async () => {
		const client = new PlatformRunnerClient({
			marketUrl: 'https://api.example.com',
			marketId: 'prod',
			runnerSecret: 'secret',
			fetchImpl: (async () => jsonResponse({ ok: false, error: 'nope' }, 403)) as typeof fetch,
		});
		await expect(client.claimJob({ runnerId: 'runner-1' })).rejects.toMatchObject({
			name: 'PlatformOperationApiError',
			status: 403,
			message: 'nope',
		} satisfies Partial<PlatformOperationApiError>);
	});

	it('derives terminal state and navigation metadata for job-aware UI polling', async () => {
		const events = [{
			id: 'evt_1',
			operationId: 'op_123',
			seq: 1,
			kind: 'repository.written',
			data: {},
			createdAt: '2026-01-01T00:00:00.000Z',
		}];
		let attempt = 0;
		const result = await pollPlatformOperation({
			operationId: 'op_123',
			intervalMs: 0,
			timeoutMs: 100,
			sleep: async () => {},
			async fetchOperation() {
				attempt += 1;
				return operation(attempt === 1
					? { status: 'running', output: { phase: 'repository.sync' } }
					: {
						status: 'succeeded',
						output: {
							href: '/app/work/notes/runner-note',
							changedPaths: ['src/content/notes/runner-note.mdx'],
							branch: 'staging',
							commitSha: null,
						},
					});
			},
			async fetchEvents() {
				return events;
			},
		});
		expect(result.terminal).toBe(true);
		expect(result.events).toEqual(events);
		expect(isPlatformOperationTerminal(result.operation)).toBe(true);
		expect(isPlatformOperationSuccessful(result.operation)).toBe(true);
		expect(result.navigation).toEqual({
			href: '/app/work/notes/runner-note',
			changedPaths: ['src/content/notes/runner-note.mdx'],
			branch: 'staging',
			commitSha: null,
		});
		expect(derivePlatformOperationNavigation(operation({
			status: 'succeeded',
			output: { output: { record: { href: '/nested' }, changedPaths: ['src/content/notes/nested.mdx'] } },
		}))).toMatchObject({
			href: '/nested',
			changedPaths: ['src/content/notes/nested.mdx'],
		});
	});

	it('runs generic executor lifecycle for no-job, success, failure, and missing executor cases', async () => {
		const calls: string[] = [];
		const baseOperation = operation({ id: 'op_success', status: 'leased', input: { value: 1 } });
		const client = {
			claimJob: vi.fn(async () => ({ ok: true as const, operation: null })),
			appendEvent: vi.fn(async () => {
				calls.push('event');
				return {
					ok: true as const,
					event: {
						id: 'evt',
						operationId: 'op_success',
						seq: calls.length,
						kind: 'runner.started',
						data: {},
						createdAt: '2026-01-01T00:00:00.000Z',
					},
				};
			}),
			checkpoint: vi.fn(async () => ({ ok: true as const, operation: baseOperation })),
			complete: vi.fn(async (_id, request) => ({ ok: true as const, operation: operation({ status: 'succeeded', output: request.output }) })),
			fail: vi.fn(async (_id, request) => ({ ok: true as const, operation: operation({ status: 'failed', error: request.error }) })),
		};
		const noJob = await runPlatformOperationOnce({
			client,
			runnerId: 'runner-1',
			workspaceRoot: '/tmp/workspace',
			environment: 'test',
			executors: [],
		});
		expect(noJob).toMatchObject({ ok: true, claimed: false, operation: null });

		client.claimJob.mockResolvedValueOnce({ ok: true, operation: baseOperation });
		const success = await runPlatformOperationOnce({
			client,
			runnerId: 'runner-1',
			workspaceRoot: '/tmp/workspace',
			environment: 'test',
			executors: [{
				namespace: 'repository',
				operation: 'write_content_record',
				async run(input, context) {
					await context.checkpoint({ phase: 'mid' }, { kind: 'midpoint', data: {} });
					return { echoed: input.value };
				},
			}],
		});
		expect(success).toMatchObject({ ok: true, claimed: true, output: { echoed: 1 } });
		expect(client.checkpoint).toHaveBeenCalledWith('op_success', expect.objectContaining({
			event: { kind: 'midpoint', data: {} },
		}));

		client.claimJob.mockResolvedValueOnce({ ok: true, operation: operation({ id: 'op_missing' }) });
		const missing = await runPlatformOperationOnce({
			client,
			runnerId: 'runner-1',
			workspaceRoot: '/tmp/workspace',
			environment: 'test',
			executors: [],
		});
		expect(missing.ok).toBe(false);
		expect(client.fail).toHaveBeenCalledWith('op_missing', expect.objectContaining({
			event: expect.objectContaining({ kind: 'runner.executor_missing' }),
		}));

		client.claimJob.mockResolvedValueOnce({ ok: true, operation: operation({ id: 'op_fail' }) });
		const failed = await runPlatformOperationOnce({
			client,
			runnerId: 'runner-1',
			workspaceRoot: '/tmp/workspace',
			environment: 'test',
			executors: [{
				namespace: 'repository',
				operation: 'write_content_record',
				async run() {
					throw new Error('boom');
				},
			}],
		});
		expect(failed).toMatchObject({ ok: false, claimed: true, error: { message: 'boom' } });

		client.claimJob.mockResolvedValueOnce({ ok: true, operation: operation({ id: 'op_cancel' }) });
		const cancelled = await runPlatformOperationOnce({
			client,
			runnerId: 'runner-1',
			workspaceRoot: '/tmp/workspace',
			environment: 'test',
			executors: [{
				namespace: 'repository',
				operation: 'write_content_record',
				async run() {
					return { unreachable: true };
				},
			}],
			async throwIfCancelled() {
				throw new Error('cancelled externally');
			},
		});
		expect(cancelled).toMatchObject({ ok: false, claimed: true, error: { message: 'cancelled externally' } });
	});

	it('renews leases and observes cancellation through optional runner-core hooks', async () => {
		const calls: string[] = [];
		let latest = operation({ id: 'op_long', status: 'leased' });
		const client = {
			claimJob: vi.fn(async () => ({ ok: true as const, operation: latest })),
			getOperation: vi.fn(async () => ({ ok: true as const, operation: latest })),
			appendEvent: vi.fn(async (_id, request) => {
				calls.push(request.event.kind);
				return {
					ok: true as const,
					event: {
						id: `evt_${calls.length}`,
						operationId: 'op_long',
						seq: calls.length,
						kind: request.event.kind,
						data: request.event.data ?? {},
						createdAt: '2026-01-01T00:00:00.000Z',
					},
				};
			}),
			renewLease: vi.fn(async () => {
				calls.push('renew');
				latest = operation({ id: 'op_long', status: 'leased', leaseExpiresAt: '2026-01-01T00:10:00.000Z' });
				return { ok: true as const, operation: latest };
			}),
			checkpoint: vi.fn(async () => ({ ok: true as const, operation: operation({ id: 'op_long', status: 'running' }) })),
			complete: vi.fn(async () => ({ ok: true as const, operation: operation({ id: 'op_long', status: 'succeeded' }) })),
			fail: vi.fn(async () => ({ ok: true as const, operation: operation({ id: 'op_long', status: 'failed' }) })),
		};
		const result = await runPlatformOperationOnce({
			client,
			runnerId: 'runner-1',
			workspaceRoot: '/tmp/workspace',
			environment: 'test',
			leaseSeconds: 180,
			executors: [{
				namespace: 'repository',
				operation: 'write_content_record',
				async run(_input, context) {
					await context.renewLease(240);
					await context.checkpoint({ phase: 'halfway' }, { kind: 'halfway', data: {} });
					return { done: true };
				},
			}],
		});
		expect(result.ok).toBe(true);
		expect(client.renewLease).toHaveBeenCalledTimes(2);
		expect(calls).toEqual(['runner.started', 'renew', 'renew']);
		expect(client.checkpoint).toHaveBeenCalledWith('op_long', expect.objectContaining({
			event: { kind: 'halfway', data: {} },
		}));

		latest = operation({ id: 'op_cancelled', status: 'leased' });
		client.claimJob.mockResolvedValueOnce({ ok: true, operation: latest });
		client.getOperation.mockImplementationOnce(async () => ({ ok: true, operation: latest }))
			.mockImplementationOnce(async () => {
				latest = operation({ id: 'op_cancelled', status: 'cancelled' });
				return { ok: true, operation: latest };
			});
		const cancelled = await runPlatformOperationOnce({
			client,
			runnerId: 'runner-1',
			workspaceRoot: '/tmp/workspace',
			environment: 'test',
			executors: [{
				namespace: 'repository',
				operation: 'write_content_record',
				async run(_input, context) {
					await context.throwIfCancelled();
					return { unreachable: true };
				},
			}],
		});
		expect(cancelled).toMatchObject({ ok: false, operation: { status: 'cancelled' }, error: { message: 'Platform operation was cancelled.' } });
		expect(client.fail).not.toHaveBeenCalledWith('op_cancelled', expect.anything());
		expect(calls).toContain('runner.cancelled');
	});

	it('can drive a capacity-provider-shaped client adapter without platform auth assumptions', async () => {
		const providerCalls: string[] = [];
		const providerLikeClient = {
			async claimJob() {
				providerCalls.push('claim');
				return { ok: true as const, operation: operation({ id: 'provider_task_1', namespace: 'provider', operation: 'plan_task' }) };
			},
			async appendEvent() {
				providerCalls.push('event');
				return {
					ok: true as const,
					event: {
						id: 'evt_provider',
						operationId: 'provider_task_1',
						seq: 1,
						kind: 'runner.started',
						data: {},
						createdAt: '2026-01-01T00:00:00.000Z',
					},
				};
			},
			async checkpoint() {
				providerCalls.push('checkpoint');
				return { ok: true as const, operation: operation({ id: 'provider_task_1', namespace: 'provider', operation: 'plan_task', status: 'running' }) };
			},
			async renewLease() {
				providerCalls.push('renew');
				return { ok: true as const, operation: operation({ id: 'provider_task_1', namespace: 'provider', operation: 'plan_task', status: 'leased' }) };
			},
			async complete() {
				providerCalls.push('complete');
				return { ok: true as const, operation: operation({ id: 'provider_task_1', namespace: 'provider', operation: 'plan_task', status: 'succeeded' }) };
			},
			async fail() {
				providerCalls.push('fail');
				return { ok: true as const, operation: operation({ id: 'provider_task_1', namespace: 'provider', operation: 'plan_task', status: 'failed' }) };
			},
		};
		const result = await runPlatformOperationOnce({
			client: providerLikeClient,
			runnerId: 'provider-runner-1',
			workspaceRoot: '/tmp/provider',
			environment: 'local',
			executors: [{
				namespace: 'provider',
				operation: 'plan_task',
				async run(_input, context) {
					await context.checkpoint({ phase: 'provider-plan' });
					return { planOnly: true };
				},
			}],
		});
		expect(result.ok).toBe(true);
		expect(providerCalls).toEqual(['claim', 'event', 'renew', 'checkpoint', 'complete']);
	});

	it('can run the platform lifecycle through the direct database operation store', async () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-platform-store-'));
		const database = createSqliteRelationalAdapter(join(root, 'market.sqlite'));
		const store = new PlatformOperationStore({ database });
		try {
			await store.ensureInitialized();
			await database.run(
				`INSERT INTO platform_operations (
					id, namespace, operation, status, target, idempotency_key, input_json,
					requested_by_type, requested_by_id, created_at, updated_at
				) VALUES (?, ?, ?, 'queued', 'market_operations_runner', NULL, ?, 'service', 'test', ?, ?)`,
				['op_db_1', 'market', 'noop', JSON.stringify({ message: 'hello' }), '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'],
			);
			const result = await runPlatformOperationOnce({
				client: store,
				runnerId: 'runner-db-1',
				workspaceRoot: root,
				environment: 'test',
				executors: [{
					namespace: 'market',
					operation: 'noop',
					async run(input, context) {
						await context.checkpoint({ phase: 'db-store', input });
						return { ok: true, source: 'direct-db' };
					},
				}],
			});
			expect(result.ok).toBe(true);
			expect(result.operation?.status).toBe('succeeded');
			const events = await database.all<{ kind: string }>(`SELECT kind FROM platform_operation_events WHERE operation_id = ? ORDER BY seq`, ['op_db_1']);
			expect(events.map((event) => event.kind)).toEqual(['claimed', 'runner.started', 'runner.lease_renewed', 'checkpoint', 'completed']);
		} finally {
			await store.close();
		}
	});
});
