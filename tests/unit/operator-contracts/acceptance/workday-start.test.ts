import { expect, it, vi } from 'vitest';
import { chmodSync, existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { sdkGoldenWorkdayId, sdkGoldenFrozenProposal } from '../../../acceptance/golden-product.ts';
import { workdayStartFixture } from './workday-start-fixture.ts';
import { proposal as readyProposal } from './golden-product-fixture.ts';

it('reads only the original frozen draft request and rejects missing ambiguous changed foreign or redirected input without repairing it', () => {
	const f = workdayStartFixture(), path = resolve(f.root, 'proposal-input.json');
	const proposal = { ...structuredClone(readyProposal), id: f.freeze.proposal.id, projectId: f.freeze.request.body.projects[0], status: 'draft' };
	for (const item of proposal.executionPlan.workItems) { Reflect.deleteProperty(item, 'estimate'); Reflect.deleteProperty(item, 'reviewEstimate'); }
	const receipt = (bytes: string) => ({ ...structuredClone(f.freeze), receipts: { [path]: `sha256:${createHash('sha256').update(bytes).digest('hex')}` } });
	const bytes = JSON.stringify(proposal), freeze = receipt(bytes); writeFileSync(path, bytes);
	try {
		expect(sdkGoldenFrozenProposal(freeze)).toEqual(proposal);
		const boundary = bytes + ' '.repeat(1_048_576 - Buffer.byteLength(bytes)); writeFileSync(path, boundary);
		expect(sdkGoldenFrozenProposal(receipt(boundary))).toEqual(proposal); writeFileSync(path, bytes);
		const denied: unknown[] = [];
		for (const field of ['executionPlan', 'evidenceRefs', 'objectiveRefs', 'title', 'summary']) {
			for (const value of [undefined, null, '', false, [], {}]) denied.push({ ...proposal, [field]: value });
		}
		for (const [index] of proposal.executionPlan.workItems.entries()) {
			for (const field of ['id', 'agentClass', 'workspace', 'activity', 'review', 'maximumReviewCycles', 'objective',
				'contextRefs', 'requestedPermissions', 'requiredCapabilities', 'acceptanceCriteria']) {
				const value = structuredClone(proposal); Reflect.deleteProperty(value.executionPlan.workItems[index]!, field); denied.push(value);
			}
			for (const field of ['estimate', 'reviewEstimate', 'ownerEstimate', 'reviewerEstimate']) {
				const value = structuredClone(proposal); Reflect.set(value.executionPlan.workItems[index]!, field, null); denied.push(value);
			}
		}
		for (const value of denied) {
			const content = JSON.stringify(value); writeFileSync(path, content);
			expect.soft(() => sdkGoldenFrozenProposal(receipt(content))).toThrow('ACCEPTANCE_SDK_FROZEN_REQUEST');
			expect(readFileSync(path, 'utf8')).toBe(content);
		}
		writeFileSync(path, bytes);
		for (const value of [undefined, null, [], {}, { [path]: null }, { [path]: 'invalid' },
			{ [path]: freeze.receipts[path], [resolve(f.root, 'other/proposal-input.json')]: freeze.receipts[path] }]) {
			const changed = { ...freeze, receipts: value }, held = structuredClone(changed);
			expect(() => sdkGoldenFrozenProposal(changed)).toThrow(); expect(changed).toEqual(held);
		}
		for (const value of ['', '{', 'null', '[]', '{}', JSON.stringify({ ...proposal, id: 'foreign' }),
			JSON.stringify({ ...proposal, projectId: 'foreign' }), JSON.stringify({ ...proposal, status: 'ready' }),
			JSON.stringify({ ...proposal, request: '' }), JSON.stringify({ ...proposal, request: ' ' }),
			JSON.stringify({ ...proposal, request: false }), JSON.stringify({ ...proposal, request: [] }), ' '.repeat(1_048_577)]) {
			writeFileSync(path, value); expect(() => sdkGoldenFrozenProposal(receipt(value))).toThrow();
			expect(readFileSync(path, 'utf8')).toBe(value);
		}
		for (const field of ['id', 'projectId']) for (const value of [undefined, null, '', ' ', false, []]) {
			const changed = { ...proposal, [field]: value }, content = JSON.stringify(changed), input = receipt(content);
			Reflect.set(field === 'id' ? input.proposal : input.request.body.projects, field === 'id' ? 'id' : '0', value);
			writeFileSync(path, content); expect(() => sdkGoldenFrozenProposal(input)).toThrow();
		}
		writeFileSync(path, bytes + ' '); expect(() => sdkGoldenFrozenProposal(freeze)).toThrow('ACCEPTANCE_SDK_FROZEN_REQUEST');
		writeFileSync(path, bytes); chmodSync(path, 0); expect(() => sdkGoldenFrozenProposal(freeze)).toThrow(); chmodSync(path, 0o600);
		rmSync(path); symlinkSync(f.path, path); expect(() => sdkGoldenFrozenProposal(freeze)).toThrow(); rmSync(path);
		expect(() => sdkGoldenFrozenProposal(freeze)).toThrow(); writeFileSync(path, bytes);
		for (let index = 0; index < 3; index++) expect(sdkGoldenFrozenProposal(freeze)).toEqual(proposal);
		expect(readFileSync(path, 'utf8')).toBe(bytes);
	} finally { f.close(); }
	expect(existsSync(f.root)).toBe(false);
});

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
