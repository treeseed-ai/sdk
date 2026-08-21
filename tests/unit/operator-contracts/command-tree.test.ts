import { describe, expect, it } from 'vitest';
import { createCommandResult, listCommandPaths, TREESEED_COMMAND_TREE_V1, validateCommandTree, type CommandTreeDescriptor } from '../../../src/operator-contracts/index.ts';

function tree(): CommandTreeDescriptor {
	return {
		schemaVersion: 'treeseed.command-tree/v1',
		executable: 'trsd',
		commands: [{
			nodeType: 'branch',
			segment: 'workdays',
			description: 'Manage workday envelopes.',
			children: [{ nodeType: 'leaf', segment: 'start', description: 'Start an exact preflight.', kind: 'mutation', options: [{ name: '--plan', description: 'Return the exact proposed outcome.', type: 'boolean' }], resultSchemaId: 'treeseed.workday-start-receipt/v1' }],
		}],
	};
}

describe('human command tree contract', () => {
	it('publishes the complete canonical surface without legacy internal actions', () => {
		expect(validateCommandTree(TREESEED_COMMAND_TREE_V1)).toEqual([]);
		const paths = listCommandPaths();
		expect(paths).toEqual(expect.arrayContaining(['agents classes list', 'providers offers apply', 'workdays profiles validate', 'workdays schedules retire', 'assignments artifacts', 'save', 'stage', 'release']));
		expect(paths).not.toEqual(expect.arrayContaining(['agent-author', 'capacity-plan-create', 'checkpoint-integrate', 'content-integrate', 'content-abandon']));
	});

	it('accepts arbitrary-depth canonical trees', () => {
		const value = tree();
		(value.commands[0] as Extract<(typeof value.commands)[number], { nodeType: 'branch' }>).children = [{ nodeType: 'branch', segment: 'schedules', description: 'Schedules.', children: [{ nodeType: 'leaf', segment: 'start', description: 'Start schedule.', kind: 'mutation', options: [{ name: '--plan', description: 'Plan only.', type: 'boolean' }], resultSchemaId: 'schedule-start/v1' }] }];
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
		root.children.push({ nodeType: 'leaf', segment: 'start', description: 'Duplicate.', kind: 'mutation', options: [{ name: '--execute', description: 'Old switch.', type: 'boolean' }], resultSchemaId: 'duplicate/v1' });
		const codes = validateCommandTree(value).map((item) => item.code);
		expect(codes).toEqual(expect.arrayContaining(['command_alias_forbidden', 'command_path_duplicate', 'execute_option_forbidden', 'mutation_plan_option_required']));
	});

	it('requires trsd and rejects repository mechanics on agent commands', () => {
		const value = tree();
		(value as { executable: string }).executable = 'treeseed';
		value.commands = [{ nodeType: 'branch', segment: 'agents', description: 'Agents.', children: [{ nodeType: 'leaf', segment: 'validate', description: 'Validate.', kind: 'read', options: [{ name: '--source-ref', description: 'Forbidden.', type: 'string' }], resultSchemaId: 'agents/v1' }] }];
		expect(validateCommandTree(value).map((item) => item.code)).toEqual(expect.arrayContaining(['executable_invalid', 'agent_internal_option_forbidden']));
	});

	it('creates one stable human and machine result envelope', () => {
		expect(createCommandResult({ commandPath: ['capacity', 'status'], mode: 'execute', ok: true, result: { availableSeconds: 10 }, error: null, warnings: [], blockers: [], receipts: [], nextActions: [] })).toMatchObject({ schemaVersion: 'treeseed.command-result/v1', ok: true });
	});
});
