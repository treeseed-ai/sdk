import { describe,expect,it,vi } from 'vitest';
import { agentLabProfileInputs,seedAgentLabPlanningProfileInputs } from '../../../../src/scenes/agent-lab/profile-input-seed.ts';

describe('Agent Lab profile input seed', () => {
	it('normalizes agent and activity-specific named-test inputs', () => {
		expect(agentLabProfileInputs([{ frontmatter: { profileInputs: { reviewer: { reviewing: { chapter: 'foundation' } } } } }])).toEqual([
			{ agentId: 'reviewer', activityType: 'reviewing', input: { chapter: 'foundation' } },
		]);
	});

	it('materializes normalized scene inputs when the immutable test predates them', () => {
		expect(agentLabProfileInputs([], { reviewer: { reviewing: { chapter: 'foundation' } } })).toEqual([
			{ agentId: 'reviewer', activityType: 'reviewing', input: { chapter: 'foundation' } },
		]);
	});

	it('creates a real scoped planning request with immutable artifact provenance', async () => {
		const createPlanningInputRequest = vi.fn(async () => ({ ok: true }));
		await seedAgentLabPlanningProfileInputs({
			client: { createPlanningInputRequest } as never, projectId: 'project-1', runId: 'run-1', workdayId: 'day-1', resolvedRef: 'a'.repeat(40),
			tests: [{ frontmatter: { profileInputs: { reviewer: { reviewing: { chapter: 'foundation', subjectPath: 'src/content/knowledge/guide/page.md', relatedArtifact: { model: 'knowledge', contentPath: 'src/content/knowledge/guide/page.md' } } } } } }],
			agentClassIds: { reviewer: 'class-1' }, selectedAgents: ['reviewer'],
		});
		expect(createPlanningInputRequest).toHaveBeenCalledWith('agent-lab:run-1:day-1:reviewer:reviewing:input', expect.objectContaining({
			projectId: 'project-1', projectAgentClassId: 'class-1', metadata: expect.objectContaining({ agentId: 'reviewer', activityType: 'reviewing', assignmentInput: expect.objectContaining({ chapter: 'foundation', subjectRef: 'a'.repeat(40), relatedArtifact: expect.objectContaining({ commitSha: 'a'.repeat(40) }) }) }),
		}));
	});
});
