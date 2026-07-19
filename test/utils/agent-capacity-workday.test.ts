import { describe, expect, it } from 'vitest';
import {
	evaluateWorkdayContinuation,
	selectFairPlanningAgentCycles,
	type WorkdayExistingAssignment,
} from '../../src/agent-capacity/workday.ts';

const agents = [
	{ slug: 'architect', projectAgentClassSlug: 'engineering', planningAllocationPercent: 80 },
	{ slug: 'researcher', projectAgentClassSlug: 'research', planningAllocationPercent: 10 },
	{ slug: 'writer', projectAgentClassSlug: 'documentation', planningAllocationPercent: 10 },
];

function assignment(projectId: string, agentId: string, cycle: number): WorkdayExistingAssignment {
	return { projectId, agentId, metadata: { cycle } };
}

describe('capacity workday participation', () => {
	it('involves every eligible agent in each durable cycle before any agent repeats', () => {
		const existing: WorkdayExistingAssignment[] = [];
		const selected: Array<{ slug: string; cycle: number }> = [];
		for (let poll = 0; poll < 7; poll += 1) {
			const [next] = selectFairPlanningAgentCycles('project-a', agents, existing, 1);
			expect(next).toBeDefined();
			selected.push({ slug: next.agent.slug, cycle: next.cycle });
			existing.push(assignment('project-a', next.agent.slug, next.cycle));
		}

		expect(new Set(selected.slice(0, 3).map((entry) => entry.slug))).toEqual(new Set(agents.map((agent) => agent.slug)));
		expect(selected.slice(0, 3).every((entry) => entry.cycle === 1)).toBe(true);
		expect(new Set(selected.slice(3, 6).map((entry) => entry.slug))).toEqual(new Set(agents.map((agent) => agent.slug)));
		expect(selected.slice(3, 6).every((entry) => entry.cycle === 2)).toBe(true);
		expect(selected[6]?.cycle).toBe(3);
	});

	it('ignores other projects, duplicate rows, and fills missing cycles deterministically', () => {
		const existing = [
			assignment('project-b', 'architect', 1),
			assignment('project-a', 'researcher', 1),
			assignment('project-a', 'researcher', 1),
			assignment('project-a', 'writer', 2),
		];
		const selected = selectFairPlanningAgentCycles('project-a', agents, existing, 3);
		expect(selected.map(({ agent, cycle }) => `${agent.slug}:${cycle}`)).toEqual([
			'architect:1',
			'writer:1',
			'architect:2',
		]);
	});

	it('continues useful work until a duration or budget bound is reached', () => {
		const base = { status: 'running', now: '2026-07-17T12:00:00.000Z', deadlineAt: '2026-07-17T13:00:00.000Z', totalCredits: 10, committedCredits: 3, usefulEligibleWork: true };
		expect(evaluateWorkdayContinuation(base)).toEqual({ continue: true, reason: 'within_duration_and_budget' });
		expect(evaluateWorkdayContinuation({ ...base, committedCredits: 10 })).toEqual({ continue: false, reason: 'budget_bound_reached' });
		expect(evaluateWorkdayContinuation({ ...base, now: base.deadlineAt })).toEqual({ continue: false, reason: 'duration_bound_reached' });
	});
});
