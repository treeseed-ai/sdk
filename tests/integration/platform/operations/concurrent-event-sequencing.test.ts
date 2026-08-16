import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PlatformOperationStore, createSqliteRelationalAdapter } from '../../../../src/operations/platform-operation-store.ts';

describe('platform operation event sequencing', () => {
	it('retains a gap-free sequence when events are emitted concurrently', async () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-platform-events-'));
		const database = createSqliteRelationalAdapter(join(root, 'market.sqlite'));
		const store = new PlatformOperationStore({ database });
		try {
			await store.ensureInitialized();
			await database.run(
				`INSERT INTO platform_operations (
					id, namespace, operation, status, target, input_json, requested_by_type,
					requested_by_id, assigned_runner_id, created_at, updated_at
				) VALUES (?, 'market', 'events', 'running', 'market_operations_runner', '{}', 'service', 'test', ?, ?, ?)`,
				['op_events_1', 'runner-events-1', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'],
			);
			await Promise.all(Array.from({ length: 32 }, (_, index) => store.appendEvent('op_events_1', {
				runnerId: 'runner-events-1', event: { kind: 'progress', data: { index } },
			})));
			const events = await database.all<{ seq: number }>(
				`SELECT seq FROM platform_operation_events WHERE operation_id = ? ORDER BY seq`,
				['op_events_1'],
			);
			expect(events.map((event) => event.seq)).toEqual(Array.from({ length: 32 }, (_, index) => index + 1));
		} finally {
			await store.close();
		}
	});
});
