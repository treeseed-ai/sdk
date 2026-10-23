import { describe, expect, it } from 'vitest';
import { normalizeWorkdayAgentSelection, validateWorkdayIntent, workdayIntentSchema, workdayIntentRequestSchema } from '../../../src/operator-contracts/workday-lifecycle.ts';
import { WORKDAY_PLAN_OPTIONS, WORKDAY_SELECTION_INPUTS } from '../../../src/operator-contracts/catalog/workdays/selection-commands.ts';
import { controlPlaneOperation } from '../../../src/operator-contracts/control-plane-operations.ts';

const intent = {
	schemaVersion: 'treeseed.workday-intent/v1' as const, teamId: 'team', profileId: 'default',
	projects: ['ui', 'admin'], startsAt: '2026-10-20T15:00:00.000Z', durationSeconds: 3600,
	planningOnly: true, proposalIds: ['complete-activity-snapshots'], groupIds: ['ui-snapshot-admin-chart'],
};

describe('group-driven workday intent', () => {
	it('returns nested validation issues for invalid scheduled intents instead of throwing from safeParse', () => {
		const schema = controlPlaneOperation('workdays.schedules.create').schema.body;
		const { groupIds: _groups, proposalIds: _proposals, ...bare } = intent;
		for (const selected of [undefined, bare, { ...intent, groupIds: ['bad group'] }, { ...intent, reportingAgentId: 'chosen-reporter' }]) {
			const input = { intent: selected, cadenceSeconds: 3600 }, before = structuredClone(input);
			const parsed = schema.safeParse(input);
			expect(parsed.success).toBe(false);
			if (!parsed.success) expect(parsed.error.issues.every(issue => issue.path[0] === 'intent')).toBe(true);
			expect(input).toEqual(before);
		}
		const valid = { intent: { ...intent, decisionIds: ['z', 'a'] }, cadenceSeconds: 3600 };
		expect(schema.parse(valid)).toEqual({ ...valid, intent: { ...valid.intent, decisionIds: ['a', 'z'] } });
	});
	it('rejects prohibited own fields even when they are hidden or undefined without changing the input', () => {
		for (const field of ['executionPlanId','capacityPlanId','executionInputId','demandSetId']) {
			for (const value of [undefined,null,'','derived']) for (const enumerable of [false,true]) {
				const input = { ...intent }; Object.defineProperty(input,field,{ value, enumerable, configurable: true });
				const before = Object.getOwnPropertyDescriptors(input);
				expect(validateWorkdayIntent(input)).toContainEqual(expect.objectContaining({ code: 'field_forbidden', path: field }));
				expect(workdayIntentRequestSchema.safeParse(input).success).toBe(false);
				expect(Object.getOwnPropertyDescriptors(input)).toEqual(before);
			}
		}
	});
	it('requires groups or exact governed subjects instead of treating project and activity scope as an agent audience', () => {
		const { groupIds: _groups, proposalIds: _proposals, ...bare } = intent;
		for (const projects of [['ui', 'admin'], 'all'] as const) {
			const input = { ...bare, projects: projects === 'all' ? projects : [...projects] }, before = structuredClone(input);
			expect(validateWorkdayIntent(input)).not.toEqual([]);
			expect(workdayIntentSchema.safeParse(input).success).toBe(false);
			expect(workdayIntentRequestSchema.safeParse(input).success).toBe(false);
			for (const field of ['groupIds', 'proposalIds', 'decisionIds']) {
				const scoped = { ...input, [field]: ['portfolio-runtime'] };
				expect(validateWorkdayIntent(scoped)).toEqual([]);
				expect(workdayIntentSchema.safeParse(scoped).success).toBe(true);
				expect(workdayIntentRequestSchema.safeParse(scoped).success).toBe(true);
			}
			expect(input).toEqual(before);
		}
	});
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
	it('keeps normalized internal phase snapshots free of identity filters and rejects legacy targeting', () => {
		expect(normalizeWorkdayAgentSelection(undefined)).toEqual({ activityTypes: [], mode: 'intersection' });
		expect(normalizeWorkdayAgentSelection({ activityTypes: ['estimating', 'planning', 'estimating'] }))
			.toEqual({ activityTypes: ['estimating', 'planning'], mode: 'intersection' });
		for (const field of ['agentSlugs', 'classSlugs', 'classIds']) for (const value of [[], ['engineer']]) {
			expect(() => normalizeWorkdayAgentSelection({ activityTypes: ['planning'], [field]: value })).toThrow();
		}
		expect(() => normalizeWorkdayAgentSelection({ activityTypes: ['planning'], mode: 'union' })).toThrow();
		expect(() => normalizeWorkdayAgentSelection({ activityTypes: ['typo'] })).toThrow();
	});
	it('offers shared-group selection and removes agent and class participant flags from the CLI contract', () => {
		expect(WORKDAY_PLAN_OPTIONS.map(option => option.name)).toContain('--group');
		for (const name of ['--agent', '--class']) expect(WORKDAY_PLAN_OPTIONS.map(option => option.name)).not.toContain(name);
		expect(WORKDAY_SELECTION_INPUTS).toContainEqual({ target: 'body', field: 'groupIds', source: 'option', name: 'group', transform: 'csv' });
	});
});
