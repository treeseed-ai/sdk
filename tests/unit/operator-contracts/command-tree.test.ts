import { describe, expect, it } from 'vitest';
import { CONTROL_PLANE_OPERATION_LIST, createCommandResult, listCommandPaths, TREESEED_COMMAND_TREE_V1, validateCommandOperationBindings, validateCommandTree, type CommandTreeDescriptor } from '../../../src/operator-contracts/index.ts';

const unavailable = { kind: 'unavailable' as const, code: 'test_unavailable', reason: 'Test command.' };

function tree(): CommandTreeDescriptor {
	return {
		schemaVersion: 'treeseed.command-tree/v1',
		executable: 'trsd',
		commands: [{
			nodeType: 'branch',
			segment: 'workdays',
			description: 'Manage workday envelopes.',
			children: [{ nodeType: 'leaf', segment: 'start', description: 'Start an exact preflight.', kind: 'mutation', options: [{ name: '--plan', description: 'Return the exact proposed outcome.', type: 'boolean' }], resultSchemaId: 'treeseed.workday-start-receipt/v1', execution: unavailable }],
		}],
	};
}

describe('human command tree contract', () => {
	it('publishes the complete canonical surface without legacy internal actions', () => {
		expect(validateCommandTree(TREESEED_COMMAND_TREE_V1)).toEqual([]);
		expect(validateCommandOperationBindings(TREESEED_COMMAND_TREE_V1, CONTROL_PLANE_OPERATION_LIST)).toEqual([]);
		const paths = listCommandPaths();
		expect(paths).toEqual(expect.arrayContaining(['send', 'agents classes list', 'providers offers apply', 'workdays profiles validate', 'workdays schedules retire', 'assignments artifacts', 'save', 'stage', 'release']));
		expect(paths).not.toEqual(expect.arrayContaining(['agent-author', 'capacity-plan-create', 'checkpoint-integrate', 'content-integrate', 'content-abandon']));
		const release = TREESEED_COMMAND_TREE_V1.commands.find((node) => node.segment === 'release');
		expect(release).toMatchObject({ nodeType: 'leaf', authorization: { confirmation: 'production' } });
	});

	it('classifies supported, local, protocol, and intentionally unavailable execution without URL metadata', () => {
		const leaves = new Map<string, Extract<(typeof TREESEED_COMMAND_TREE_V1.commands)[number], { nodeType: 'leaf' }>>();
		const visit = (nodes: typeof TREESEED_COMMAND_TREE_V1.commands, parent: string[] = []) => nodes.forEach((node) => {
			const path = [...parent, node.segment];
			if (node.nodeType === 'branch') visit(node.children, path);
			else leaves.set(path.join(' '), node);
		});
		visit(TREESEED_COMMAND_TREE_V1.commands);
		expect(leaves.get('agents show')?.execution).toMatchObject({ kind: 'operation', operationId: 'agents.show' });
		expect(leaves.get('auth login')?.execution).toEqual({ kind: 'protocol', handlerId: 'protocol.oauth.device.login' });
		expect(leaves.get('secrets status')?.execution).toEqual({ kind: 'local', handlerId: 'local.secrets.status' });
		expect(leaves.get('release')?.execution).toMatchObject({ kind: 'unavailable', code: 'standards_migration_not_enabled' });
		expect(JSON.stringify(TREESEED_COMMAND_TREE_V1)).not.toContain('/v1/');
		expect(listCommandPaths()).toEqual(expect.arrayContaining([
			'host status', 'host doctor', 'host config adopt', 'host topology', 'host connections', 'host provider status', 'host fleet status', 'host update channel', 'host component enable', 'host recovery restore', 'host bootstrap enroll', 'host reset',
			'projects treedx show',
			'projects treedx bind',
			'projects treedx status',
			'projects treedx diagnose',
			'projects treedx capabilities',
			'projects treedx workspaces list',
			'projects treedx workspaces show',
			'projects treedx workspaces abandon',
		]));
	});

	it('rejects mapped fields on strict empty and undefined operation inputs', () => {
		const value = structuredClone(TREESEED_COMMAND_TREE_V1);
		const status = value.commands.find((node) => node.nodeType === 'leaf' && node.segment === 'status');
		if (!status || status.nodeType !== 'leaf') throw new Error('Missing status command fixture.');
		status.execution = { kind: 'operation', operationId: 'status.show', input: [
			{ target: 'query', field: 'invented', source: 'option', name: 'invented' },
			{ target: 'body', field: 'invented', source: 'option', name: 'invented' },
		] };
		expect(validateCommandOperationBindings(value, CONTROL_PLANE_OPERATION_LIST).map((entry) => entry.code)).toEqual(['command_operation_input_unknown', 'command_operation_input_unknown']);
	});

	it('accepts arbitrary-depth canonical trees', () => {
		const value = tree();
		(value.commands[0] as Extract<(typeof value.commands)[number], { nodeType: 'branch' }>).children = [{ nodeType: 'branch', segment: 'schedules', description: 'Schedules.', children: [{ nodeType: 'leaf', segment: 'start', description: 'Start schedule.', kind: 'mutation', options: [{ name: '--plan', description: 'Plan only.', type: 'boolean' }], resultSchemaId: 'schedule-start/v1', execution: unavailable }] }];
		expect(validateCommandTree(value)).toEqual([]);
	});

	it.each([
		['colon path', 'workdays:start', 'command_segment_invalid'],
		['compound action', 'capacity-plan-create', 'command_segment_invalid'],
	])('rejects %s', (_name, segment, code) => {
		const value = tree();
		value.commands[0]!.segment = segment;
		expect(validateCommandTree(value).map((item) => item.code)).toContain(code);
	});

	it('rejects aliases, duplicate paths, --execute, and mutations without --plan', () => {
		const value = tree();
		const root = value.commands[0] as Extract<(typeof value.commands)[number], { nodeType: 'branch' }> & { aliases?: string[] };
		root.aliases = ['day'];
		root.children.push({ nodeType: 'leaf', segment: 'start', description: 'Duplicate.', kind: 'mutation', options: [{ name: '--execute', description: 'Old switch.', type: 'boolean' }], resultSchemaId: 'duplicate/v1', execution: unavailable });
		const codes = validateCommandTree(value).map((item) => item.code);
		expect(codes).toEqual(expect.arrayContaining(['command_alias_forbidden', 'command_path_duplicate', 'execute_option_forbidden', 'mutation_plan_option_required']));
	});

	it('rejects nodes that ambiguously combine branches and leaves', () => {
		const value = tree();
		const root = value.commands[0] as unknown as Record<string, unknown>;
		root.kind = 'read';
		expect(validateCommandTree(value).map((item) => item.code)).toContain('command_node_ambiguous');
	});

	it('requires trsd and rejects repository mechanics on agent commands', () => {
		const value = tree();
		(value as { executable: string }).executable = 'treeseed';
		value.commands = [{ nodeType: 'branch', segment: 'agents', description: 'Agents.', children: [{ nodeType: 'leaf', segment: 'validate', description: 'Validate.', kind: 'read', options: [{ name: '--source-ref', description: 'Forbidden.', type: 'string' }], resultSchemaId: 'agents/v1', execution: unavailable }] }];
		expect(validateCommandTree(value).map((item) => item.code)).toEqual(expect.arrayContaining(['executable_invalid', 'agent_internal_option_forbidden']));
	});

	it('creates one stable human and machine result envelope', () => {
		expect(createCommandResult({ commandPath: ['capacity', 'status'], mode: 'execute', ok: true, result: { availableSeconds: 10 }, error: null, warnings: [], blockers: [], receipts: [], nextActions: [] })).toMatchObject({ schemaVersion: 'treeseed.command-result/v1', ok: true });
	});
});
