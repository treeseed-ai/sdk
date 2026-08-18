import { describe, expect, it } from 'vitest';
import { normalizeWorkdayAgentSelection, selectWorkdayAgents } from '../../../../src/agent-capacity/workday.ts';

const agents = [
	{ slug: 'researcher', activityType: 'planning', projectAgentClassId: 'project:evidence-research', projectAgentClassSlug: 'evidence-research' },
	{ slug: 'writer', activityType: 'planning', projectAgentClassId: 'project:guide-writing', projectAgentClassSlug: 'guide-writing' },
	{ slug: 'writer', activityType: 'chat', projectAgentClassId: 'project:guide-writing', projectAgentClassSlug: 'guide-writing' },
	{ slug: 'reviewer', activityType: 'planning', projectAgentClassId: 'project:technical-verification', projectAgentClassSlug: 'technical-verification' },
];

describe('workday agent selection', () => {
	it('normalizes selectors deterministically and defaults to intersection', () => {
		expect(normalizeWorkdayAgentSelection({ classSlugs: ['guide-writing', 'guide-writing'], agentSlugs: ['writer'] })).toEqual({
			classIds: [], classSlugs: ['guide-writing'], agentSlugs: ['writer'], activityTypes: [], mode: 'intersection',
		});
	});

	it('selects by class, agent, intersection, and union without changing the default set', () => {
		expect(selectWorkdayAgents(agents, {}).map((agent) => agent.slug)).toEqual(['researcher', 'writer', 'writer', 'reviewer']);
		expect(selectWorkdayAgents(agents, { classSlugs: ['guide-writing'] }).map((agent) => agent.slug)).toEqual(['writer', 'writer']);
		expect(selectWorkdayAgents(agents, { classSlugs: ['guide-writing'], agentSlugs: ['writer'] }).map((agent) => agent.slug)).toEqual(['writer', 'writer']);
		expect(selectWorkdayAgents(agents, { classSlugs: ['guide-writing'], agentSlugs: ['reviewer'], mode: 'intersection' })).toEqual([]);
		expect(selectWorkdayAgents(agents, { classSlugs: ['guide-writing'], agentSlugs: ['reviewer'], mode: 'union' }).map((agent) => agent.slug)).toEqual(['writer', 'writer', 'reviewer']);
		expect(selectWorkdayAgents(agents, { agentSlugs: ['writer'], activityTypes: ['chat'] }).map((agent) => agent.activityType)).toEqual(['chat']);
	});
});
