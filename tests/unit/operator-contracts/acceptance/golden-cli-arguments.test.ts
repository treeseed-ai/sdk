import { expect, it } from 'vitest';
import { sdkGoldenReadArguments } from '../../../acceptance/golden-product.ts';

it('retains supported library read arguments without unsupported server or team flags', () => {
	for (const args of [['library', 'show', 'sdk'], ['library', 'show', 'team'],
		['library', 'read', 'sdk', 'proposals/current.mdx', '--ref', 'a'.repeat(40)]]) {
		const held = [...args];
		expect.soft(sdkGoldenReadArguments(args, 'governed-team')).toEqual([...args, '--json']);
		expect(args).toEqual(held);
	}
});

it('retains exact project proposal authority without adding a team selector', () => {
	const args = ['proposals', 'show', 'original-proposal', '--project', 'original-project'], held = [...args];
	 expect(sdkGoldenReadArguments(args, 'governed-team')).toEqual([...args, '--server', 'local', '--json']);
	expect(args).toEqual(held);
});

it('retains exact team and local server authority for workday assignment and graph reads', () => {
	for (const args of [['workdays', 'show', 'original-workday'], ['assignments', 'list', '--limit', '50'],
		['assignments', 'show', 'original-attempt'], ['execution', 'graph', 'show']]) {
		const held = [...args];
		expect(sdkGoldenReadArguments(args, 'governed-team')).toEqual([...args, '--server', 'local', '--team', 'governed-team', '--json']);
		expect(args).toEqual(held);
	}
});
