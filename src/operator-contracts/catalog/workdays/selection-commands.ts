import type { CommandInputBinding, CommandLeafDescriptor } from '../../command-tree.ts';

export const WORKDAY_SELECTION_INPUTS: CommandInputBinding[] = [
	{ target: 'body', field: 'agentSelection.agentSlugs', source: 'option', name: 'agent', transform: 'csv' },
	{ target: 'body', field: 'agentSelection.activityTypes', source: 'option', name: 'activity', transform: 'csv' },
	{ target: 'body', field: 'agentSelection.classSlugs', source: 'option', name: 'class', transform: 'csv' },
];

export const WORKDAY_PLAN_OPTIONS: NonNullable<CommandLeafDescriptor['options']> = [
	{ name: '--plan', description: 'Return the request without creating a preflight.', type: 'boolean' },
	{ name: '--decision', description: 'Accepted decision id; repeat or comma-separate. The API derives and verifies acting authority.', type: 'string[]' },
	{ name: '--agent', description: 'Planning agent slug; repeat or comma-separate. Intersects with class/activity selectors.', type: 'string[]' },
	{ name: '--activity', description: 'Planning activity: planning, estimating, reviewing, reporting, or chat; repeat or comma-separate.', type: 'string[]' },
	{ name: '--class', description: 'Planning class slug; repeat or comma-separate. Acting remains governed by accepted decisions.', type: 'string[]' },
];
