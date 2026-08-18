import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runPlatformOperationOnce } from '../../../../src/index.ts';
import { PlatformOperationStore,createSqliteRelationalAdapter } from '../../../../src/operations/platform-operation-store.ts';

describe('platform operation store lifecycle', () => {
	it('reclaims an expired running operation with explicit prior-owner evidence', async () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-platform-recovery-'));
		const database = createSqliteRelationalAdapter(join(root, 'market.sqlite'));
		const store = new PlatformOperationStore({ database, now: () => new Date('2026-08-13T16:00:00.000Z') });
		try {
			await store.ensureInitialized();
			await database.run(
				`INSERT INTO platform_operations (
					id, namespace, operation, status, target, input_json, requested_by_type,
					assigned_runner_id, lease_expires_at, created_at, updated_at, started_at
				) VALUES (?, 'agent-lab', 'run-scene', 'running', 'market_operations_runner', '{}', 'user', ?, ?, ?, ?, ?)`,
				['op_interrupted', 'runner-old', '2026-08-13T15:00:00.000Z', '2026-08-13T14:00:00.000Z', '2026-08-13T15:00:00.000Z', '2026-08-13T14:00:00.000Z'],
			);
			const claimed = await store.claimJob({ runnerId: 'runner-new', capabilities: ['agent-lab:run-scene'], leaseSeconds: 300 });
			expect(claimed.operation).toMatchObject({ id: 'op_interrupted', status: 'leased', assignedRunnerId: 'runner-new' });
			const events = await database.all<{ kind: string; data_json: string }>(`SELECT kind, data_json FROM platform_operation_events WHERE operation_id = ?`, ['op_interrupted']);
			expect(events).toHaveLength(1);
			expect(events[0]).toMatchObject({ kind: 'runner.lease_reclaimed' });
			expect(JSON.parse(events[0]!.data_json)).toMatchObject({ previousRunnerId: 'runner-old', previousStatus: 'running', runnerId: 'runner-new' });
		} finally {
			await store.close();
		}
	});

	it('runs the complete lifecycle through the direct database store', async () => {
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
			const result = await runPlatformOperationOnce({ client: store, runnerId: 'runner-db-1', workspaceRoot: root, environment: 'test', executors: [{
				namespace: 'market', operation: 'noop', async run(input, context) {
					await context.checkpoint({ phase: 'db-store', input });
					return { ok: true, source: 'direct-db' };
				},
			}] });
			expect(result.ok).toBe(true);
			expect(result.operation?.status).toBe('succeeded');
			const events = await database.all<{ kind: string }>(`SELECT kind FROM platform_operation_events WHERE operation_id = ? ORDER BY seq`, ['op_db_1']);
			expect(events.map((event) => event.kind)).toEqual(['claimed', 'runner.started', 'runner.lease_renewed', 'checkpoint', 'completed']);
		} finally {
			await store.close();
		}
	});
});
