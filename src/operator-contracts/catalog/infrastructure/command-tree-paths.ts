import type { CommandNodeDescriptor, CommandTreeDescriptor } from '../../command-tree.ts';

/** Enumerate leaves without depending on the canonical command inventory. */
export function commandPaths(tree: CommandTreeDescriptor): string[] {
	const paths: string[] = [];
	const visit = (nodes: CommandNodeDescriptor[], parent: string[]): void => {
		for (const node of nodes) {
			const path = [...parent, node.segment];
			if (node.nodeType === 'leaf') paths.push(path.join(' '));
			else visit(node.children, path);
		}
	};
	visit(tree.commands, []);
	return paths;
}
