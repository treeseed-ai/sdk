import type { CommandLeafDescriptor, CommandNodeDescriptor, CommandTreeDescriptor } from './command-tree.ts';

const planOption = { name: '--plan', description: 'Return the exact proposed outcome without mutation.', type: 'boolean' as const };

function leaf(segment: string, kind: 'read' | 'mutation' = 'read', argument?: string): CommandNodeDescriptor {
	const value: CommandLeafDescriptor = {
		segment,
		description: `${segment[0]!.toUpperCase()}${segment.slice(1)} the selected resource.`,
		kind,
		arguments: argument ? [{ name: argument, description: `${argument} identity or path.`, required: true }] : undefined,
		options: kind === 'mutation' ? [planOption] : undefined,
		resultSchemaId: `treeseed.command.${segment}/v1`,
	};
	return { nodeType: 'leaf', ...value };
}

function branch(segment: string, children: CommandNodeDescriptor[]): CommandNodeDescriptor {
	return { nodeType: 'branch', segment, description: `${segment[0]!.toUpperCase()}${segment.slice(1)} operations.`, children };
}

export const TREESEED_COMMAND_TREE_V1: CommandTreeDescriptor = {
	schemaVersion: 'treeseed.command-tree/v1',
	executable: 'trsd',
	commands: [
		branch('auth', [leaf('login', 'mutation'), leaf('logout', 'mutation'), leaf('status')]),
		branch('secrets', [leaf('list'), leaf('status'), leaf('unlock', 'mutation'), leaf('lock', 'mutation'), leaf('rotate', 'mutation')]),
		branch('agents', [
			leaf('list'), leaf('show', 'read', 'agent'), leaf('validate'), leaf('diff'), leaf('diagnose'),
			branch('classes', [leaf('list'), leaf('show', 'read', 'class')]),
			branch('bindings', [leaf('list'), leaf('show', 'read', 'binding'), leaf('explain', 'read', 'binding')]),
		]),
		branch('providers', [
			leaf('list'), leaf('show', 'read', 'provider'), leaf('status', 'read', 'provider'), leaf('diagnose', 'read', 'provider'), leaf('connect', 'mutation'), leaf('disconnect', 'mutation', 'connection'),
			branch('requests', [leaf('list'), leaf('show', 'read', 'request'), leaf('approve', 'mutation', 'request'), leaf('reject', 'mutation', 'request')]),
			branch('credentials', [leaf('status', 'read', 'connection'), leaf('rotate', 'mutation', 'connection'), leaf('revoke', 'mutation', 'connection')]),
			branch('offers', [leaf('show', 'read', 'connection'), leaf('validate', 'read', 'file'), leaf('plan', 'read', 'file'), leaf('apply', 'mutation', 'file')]),
		]),
		branch('capacity', [leaf('status'), leaf('explain'), leaf('usage'), leaf('ledger'), leaf('audit')]),
		branch('plans', [leaf('list'), leaf('show', 'read', 'plan'), leaf('explain', 'read', 'plan'), { nodeType: 'leaf', segment: 'diff', description: 'Compare two API-derived plans.', kind: 'read', arguments: [{ name: 'left', description: 'Left plan identity.', required: true }, { name: 'right', description: 'Right plan identity.', required: true }], resultSchemaId: 'treeseed.command.plans.diff/v1' }]),
		branch('workdays', [
			branch('profiles', [leaf('list'), leaf('show', 'read', 'profile'), leaf('validate', 'read', 'file')]),
			leaf('plan'), leaf('start', 'mutation'), leaf('list'), leaf('show', 'read', 'workday'), leaf('watch', 'read', 'workday'), leaf('pause', 'mutation', 'workday'), leaf('resume', 'mutation', 'workday'), leaf('stop', 'mutation', 'workday'), leaf('cancel', 'mutation', 'workday'),
			branch('schedules', [leaf('list'), leaf('show', 'read', 'schedule'), leaf('plan'), leaf('start', 'mutation'), leaf('pause', 'mutation', 'schedule'), leaf('resume', 'mutation', 'schedule'), leaf('retire', 'mutation', 'schedule')]),
		]),
		branch('assignments', [leaf('list'), leaf('show', 'read', 'assignment'), leaf('explain', 'read', 'assignment'), leaf('watch', 'read', 'assignment'), leaf('retry', 'mutation', 'assignment'), leaf('cancel', 'mutation', 'assignment'), leaf('artifacts', 'read', 'assignment')]),
		leaf('save', 'mutation'), leaf('stage', 'mutation'), leaf('release', 'mutation'), leaf('status'), leaf('diagnose'),
	],
};

export function listCommandPaths(tree: CommandTreeDescriptor = TREESEED_COMMAND_TREE_V1): string[] {
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
