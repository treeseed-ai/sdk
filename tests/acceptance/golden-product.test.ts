import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { sdkGoldenSource, verifySdkGoldenProduct } from './golden-product.ts';

test('SDK golden retains exact source and passing measured candidate release gates', () => {
	const read = (args: string[]) => {
		const envelope = JSON.parse(execFileSync('trsd', [...args, '--server', 'local', '--team', process.env.TREESEED_ACCEPTANCE_TEAM ?? 'treeseed', '--json'],
			{ encoding: 'utf8', timeout: 30000, maxBuffer: 32 * 1024 * 1024 }));
		assert.equal(envelope.ok, true, 'ACCEPTANCE_SDK_READ: Authoritative read failed'); return envelope.result;
	};
	let id = process.env.TREESEED_ACCEPTANCE_WORKDAY_ID;
	const freezePath = process.env.TREESEED_ACCEPTANCE_FREEZE_PATH;
	assert.ok(freezePath, 'ACCEPTANCE_SDK_FREEZE: Explicit immutable campaign freeze required');
	const freeze = JSON.parse(readFileSync(freezePath, 'utf8'));
	const proposalId = freeze.proposal?.id;
	if (!id && proposalId) {
		const matches: Record<string, any>[] = [];
		let cursor: string | undefined;
		for (let page = 0; page < 40; page += 1) {
			const result = read(['workdays', 'list', '--limit', '100', ...(cursor ? ['--cursor', cursor] : [])]);
			matches.push(...result.items.filter((item: Record<string, any>) => item.executionKind === 'workday' && item.parameters?.proposalIds?.includes(proposalId)));
			if (!result.page?.hasMore) break;
			assert.ok(result.page.nextCursor && result.page.nextCursor !== cursor && page < 39, 'ACCEPTANCE_SDK_PAGINATION: Incomplete workday evidence');
			cursor = result.page.nextCursor;
		}
		assert.equal(matches.length, 1, 'ACCEPTANCE_SDK_WORKDAY: Frozen proposal must identify exactly one real workday');
		id = matches[0]!.id;
	}
	assert.ok(typeof id === 'string' && id.startsWith('workday-'), 'ACCEPTANCE_SDK_WORKDAY: Explicit real workday or frozen proposal required');
	const run = read(['workdays', 'show', id]).run;
	if (proposalId) assert.ok(run.parameters.proposalIds.includes(proposalId), 'ACCEPTANCE_SDK_WORKDAY: Wrong frozen proposal');
	assert.equal(run.executionMode, 'simulation'); assert.equal(run.status, 'completed');
	const assignments: Record<string, any>[] = [];
	let cursor: string | undefined;
	for (let page = 0; page < 40; page += 1) {
		const result = read(['assignments', 'list', '--limit', '50', ...(cursor ? ['--cursor', cursor] : [])]);
		assignments.push(...result.items.filter((item: Record<string, unknown>) => item.workDayId === id));
		if (!result.page?.hasMore || result.items.every((item: Record<string, string>) => item.createdAt < run.startedAt)) break;
		assert.ok(result.page.nextCursor && result.page.nextCursor !== cursor && page < 39, 'ACCEPTANCE_SDK_PAGINATION: Incomplete assignment evidence');
		cursor = result.page.nextCursor;
	}
	verifySdkGoldenProduct(assignments, sdkGoldenSource(freeze, run.parameters.proposalIds));
});
