import { expect, it } from 'vitest';
import { TREESEED_COMMAND_TREE_V1, type CommandNodeDescriptor } from '../../../../src/operator-contracts/index.ts';

it('binds retained Git export to the existing fixed local operator boundary', () => {
	let nodes: CommandNodeDescriptor[] = TREESEED_COMMAND_TREE_V1.commands;
	for (const segment of ['host', 'sandbox', 'source']) {
		const node = nodes.find(item => item.segment === segment);
		expect(node?.nodeType).toBe('branch');
		if (!node || node.nodeType !== 'branch') throw new Error(`Missing ${segment} command branch`);
		nodes = node.children;
	}
	const node = nodes.find(item => item.segment === 'export');
	expect(node?.nodeType).toBe('leaf');
	if (!node || node.nodeType !== 'leaf') throw new Error('Missing source export command');
	expect(node.kind).toBe('read');
	expect(node.execution).toEqual({ kind: 'local', handlerId: 'local.host.sandbox.source.export' });
	expect(node.arguments).toBeUndefined();
	expect(node.options).toEqual([{ name: '--payload', description: 'Exact published source selection as JSON; validated by the owning local manager.', type: 'string', required: true }]);
});
