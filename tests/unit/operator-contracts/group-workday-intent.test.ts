import { describe, expect, it } from 'vitest';
import { validateWorkdayIntent } from '../../../src/operator-contracts/workday-lifecycle.ts';
import { WORKDAY_PLAN_OPTIONS, WORKDAY_SELECTION_INPUTS } from '../../../src/operator-contracts/catalog/workdays/selection-commands.ts';

const intent = {
	schemaVersion: 'treeseed.workday-intent/v1' as const, teamId: 'team', profileId: 'default',
	projects: ['ui', 'admin'], startsAt: '2026-10-20T15:00:00.000Z', durationSeconds: 3600,
	planningOnly: true, proposalIds: ['complete-activity-snapshots'], groupIds: ['ui-snapshot-admin-chart'],
};

describe('group-driven workday intent', () => {
	it('accepts shared proposal groups without requiring named agents or classes', () => {
		expect(validateWorkdayIntent(intent)).toEqual([]);
		for (const groupIds of [[], [''], ['bad group'], ['ui-snapshot-admin-chart', 'ui-snapshot-admin-chart']]) {
			expect(validateWorkdayIntent({ ...intent, groupIds })).not.toEqual([]);
		}
	});
	it('rejects individual agent and class filters even when combined with a valid activity', () => {
		for (const selector of ['agentSlugs', 'classSlugs', 'classIds']) {
			expect(validateWorkdayIntent({ ...intent, agentSelection: { activityTypes: ['planning'], [selector]: ['engineer'] } })).not.toEqual([]);
		}
	});
	it('offers shared-group selection and removes agent and class participant flags from the CLI contract', () => {
		expect(WORKDAY_PLAN_OPTIONS.map(option => option.name)).toContain('--group');
		for (const name of ['--agent', '--class']) expect(WORKDAY_PLAN_OPTIONS.map(option => option.name)).not.toContain(name);
		expect(WORKDAY_SELECTION_INPUTS).toContainEqual({ target: 'body', field: 'groupIds', source: 'option', name: 'group', transform: 'csv' });
	});
});
