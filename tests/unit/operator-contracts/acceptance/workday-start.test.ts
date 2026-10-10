import { expect, it, vi } from 'vitest';
import { chmodSync, existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { sdkGoldenWorkdayId } from '../../../acceptance/golden-product.ts';
import { workdayStartFixture } from './workday-start-fixture.ts';

it('selects only the API-issued SDK workday through the retained receipt without listing proposal matches', () => {
	const f = workdayStartFixture();
	try {
		const read = vi.fn((args: string[]) => {
			expect(args).toEqual(['workdays', 'show', f.receipt.workdayId]); return { run: f.run };
		});
		expect(Reflect.apply(sdkGoldenWorkdayId, undefined, [read, f.freeze, undefined, f.path])).toBe(f.receipt.workdayId);
		expect(read).toHaveBeenCalledTimes(1); expect(readFileSync(f.path)).toEqual(f.bytes);
		expect(JSON.parse(readFileSync(f.retained, 'utf8'))).toEqual(f.receipt);
	} finally { f.close(); }
	expect(existsSync(f.root)).toBe(false);
});
it('rejects incomplete moved conflicting or foreign SDK workday custody and preserves every original failed observation', () => {
	const f = workdayStartFixture();
	try {
		const held = readFileSync(f.retained), read = vi.fn(() => ({ run: f.run }));
		for (const bytes of ['', '{', 'null', '[]', '{}', JSON.stringify({ ...f.receipt, extra: true })]) {
			writeFileSync(f.retained, bytes); expect(() => sdkGoldenWorkdayId(read, f.freeze, undefined, f.path)).toThrow();
			expect(read).not.toHaveBeenCalled(); expect(readFileSync(f.retained, 'utf8')).toBe(bytes);
		}
		for (const [field, values] of Object.entries({ schemaVersion: ['', 'foreign'], workdayId: [null, 'foreign'],
			preflightId: ['', 'foreign'], preflightDigest: ['', `sha256:${'c'.repeat(64)}`], startedAt: ['', 'invalid'],
			transactionReceiptId: ['', 'foreign', `workday-start:${'c'.repeat(64)}`, `workday-start:${'c'.repeat(42)}`, `workday-start:${'c'.repeat(44)}`],
			acceptedExecutionNodeIds: [null, {}, ['same', 'same']], assignmentIds: ['invalid', [null]], reservationIds: [undefined, ['']], providerReceiptRefs: [[' spaced '], {}] })) {
			for (const value of values) {
				const changed = { ...f.receipt, [field]: value }, bytes = JSON.stringify(changed); writeFileSync(f.retained, bytes);
				expect(() => sdkGoldenWorkdayId(read, f.freeze, undefined, f.path), field).toThrow();
				expect(read).not.toHaveBeenCalled(); expect(readFileSync(f.retained, 'utf8')).toBe(bytes);
			}
		}
		writeFileSync(f.retained, held); expect(() => sdkGoldenWorkdayId(read, f.freeze, 'workday-22222222-2222-4222-8222-222222222222', f.path)).toThrow();
		expect(read).not.toHaveBeenCalled(); chmodSync(f.retained, 0); expect(() => sdkGoldenWorkdayId(read, f.freeze, undefined, f.path)).toThrow(); chmodSync(f.retained, 0o600);
		rmSync(f.retained); symlinkSync(f.path, f.retained); expect(() => sdkGoldenWorkdayId(read, f.freeze, undefined, f.path)).toThrow(); rmSync(f.retained); writeFileSync(f.retained, held);
		for (const mode of ['id', 'team', 'mode', 'status', 'clock', 'proposals', 'projects', 'receipt-during-read', 'freeze-during-read']) {
			const changed = structuredClone(f.run);
			if (mode === 'id') changed.id = 'workday-22222222-2222-4222-8222-222222222222'; if (mode === 'team') changed.teamId = 'foreign';
			if (mode === 'mode') changed.executionMode = 'production'; if (mode === 'status') changed.status = 'failed'; if (mode === 'clock') changed.startedAt = '2026-10-10T20:00:01.000Z';
			if (mode === 'proposals') changed.parameters.proposalIds = ['foreign']; if (mode === 'projects') changed.parameters.scheduledProjectIds = ['foreign'];
			expect(() => sdkGoldenWorkdayId(() => {
				if (mode === 'receipt-during-read') writeFileSync(f.retained, '{}'); if (mode === 'freeze-during-read') writeFileSync(f.path, '{}'); return { run: changed };
			}, f.freeze, undefined, f.path), mode).toThrow(); writeFileSync(f.path, f.bytes); writeFileSync(f.retained, held);
		}
		const original = new Error('controlled-original-read-denial');
		expect(() => sdkGoldenWorkdayId(() => { throw original; }, f.freeze, undefined, f.path)).toThrow(original);
		for (let index = 0; index < 3; index++) expect(sdkGoldenWorkdayId(read, f.freeze, f.receipt.workdayId, f.path)).toBe(f.receipt.workdayId);
		expect(readFileSync(f.path)).toEqual(f.bytes); expect(readFileSync(f.retained)).toEqual(held);
	} finally { f.close(); }
});
