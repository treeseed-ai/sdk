import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { verifySdkGoldenProduct } from './golden-product.ts';

test('SDK golden retains exact source and passing measured candidate release gates', () => {
	const id = process.env.TREESEED_ACCEPTANCE_WORKDAY_ID;
	assert.ok(id?.startsWith('workday-'), 'ACCEPTANCE_SDK_WORKDAY: Explicit real workday required');
	const read = (args: string[]) => {
		const envelope = JSON.parse(execFileSync('trsd', [...args, '--server', 'local', '--team', process.env.TREESEED_ACCEPTANCE_TEAM ?? 'treeseed', '--json'],
			{ encoding: 'utf8', timeout: 30000, maxBuffer: 32 * 1024 * 1024 }));
		assert.equal(envelope.ok, true, 'ACCEPTANCE_SDK_READ: Authoritative read failed'); return envelope.result;
	};
	const run = read(['workdays', 'show', id]).run;
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
	verifySdkGoldenProduct(assignments, '1186bff3b400fe442642013b2de93e7f0d4939df');
});
