import type { CommandInputBinding, CommandLeafDescriptor } from '../../command-tree.ts';

export const WORKDAY_SELECTION_INPUTS: CommandInputBinding[] = [
	{ target: 'body', field: 'allocation.planningPercent', source: 'option', name: 'planningPercent', transform: 'number' },
	{ target: 'body', field: 'allocation.allocationWeight', source: 'option', name: 'allocationWeight', transform: 'number' },
	{ target: 'body', field: 'allocation.planningTurnMaximumSeconds', source: 'option', name: 'planningTurnMaximumSeconds', transform: 'integer' },
	{ target: 'body', field: 'allocation.projectPercentages', source: 'option', name: 'projectPercentages', transform: 'json' },
	{ target: 'body', field: 'allocation.agentClassPercentages', source: 'option', name: 'agentClassPercentages', transform: 'json' },
	{ target: 'body', field: 'agentSelection.agentSlugs', source: 'option', name: 'agent', transform: 'csv' },
	{ target: 'body', field: 'agentSelection.activityTypes', source: 'option', name: 'activity', transform: 'csv' },
	{ target: 'body', field: 'agentSelection.classSlugs', source: 'option', name: 'class', transform: 'csv' },
];

export const WORKDAY_PLAN_OPTIONS: NonNullable<CommandLeafDescriptor['options']> = [
	{ name: '--planning-percent', description: 'Planning share of workday time and capacity (default 20%).', type: 'number' },
	{ name: '--allocation-weight', description: 'Relative share among eligible concurrent workdays (default 1).', type: 'number' },
	{ name: '--planning-turn-maximum-seconds', description: 'Maximum active seconds per planning turn (default 180).', type: 'number' },
	{ name: '--project-percentages', description: 'JSON project allocation targets; normalized among selected projects.', type: 'string' },
	{ name: '--agent-class-percentages', description: 'JSON class allocation targets keyed by project.', type: 'string' },
	{ name: '--plan', description: 'Return the request without creating a preflight.', type: 'boolean' },
	{ name: '--planning-only', description: 'Run cooperative planning profiles without admitting accepted acting work.', type: 'boolean' },
	{ name: '--execution-mode', description: 'Select simulation or production custody; both consume real capacity.', type: 'string' },
	{ name: '--proposal', description: 'Governed proposal id for cooperative planning; repeat or comma-separate.', type: 'string[]' },
	{ name: '--decision', description: 'Accepted decision id; repeat or comma-separate. The API derives and verifies acting authority.', type: 'string[]' },
	{ name: '--agent', description: 'Planning agent slug; repeat or comma-separate. Intersects with class/activity selectors.', type: 'string[]' },
	{ name: '--activity', description: 'Planning activity: planning, estimating, reviewing, reporting, or chat; repeat or comma-separate.', type: 'string[]' },
	{ name: '--class', description: 'Planning class slug; repeat or comma-separate. Acting remains governed by accepted decisions.', type: 'string[]' },
];
