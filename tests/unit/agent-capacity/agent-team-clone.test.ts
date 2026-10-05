import { describe,expect,it } from 'vitest';
import { agentTeamClonePlanSchema,agentTeamCloneRequestSchema } from '../../../src/agent-capacity/contracts/operations/agent-team-clone.ts';

describe('agent team cloning', () => {
	it('requires exactly one bounded target selection', () => {
		expect(agentTeamCloneRequestSchema.safeParse({ sourceProject: 'sdk', targetProjects: ['api'] }).success).toBe(true);
		expect(agentTeamCloneRequestSchema.safeParse({ sourceProject: 'sdk', allEligible: true }).success).toBe(true);
		expect(agentTeamCloneRequestSchema.safeParse({ sourceProject: 'sdk' }).success).toBe(false);
		expect(agentTeamCloneRequestSchema.safeParse({ sourceProject: 'sdk', targetProjects: ['api'], allEligible: true }).success).toBe(false);
	});

	it('binds exact source and target content heads into the plan digest boundary', () => {
		const exact = 'a'.repeat(40), hash = `sha256:${'b'.repeat(64)}`;
		expect(agentTeamClonePlanSchema.safeParse({
			schemaVersion: 'treeseed.agent-team-clone-plan/v1', teamId: 'team',
			source: { projectId: 'sdk', slug: 'sdk', name: 'SDK', repository: 'sdk-library', commit: exact },
			targets: [{ projectId: 'api', slug: 'api', name: 'API', repository: 'api-library', commit: exact, action: 'create', definitions: [{ path: 'agents/architect.mdx', agentClass: 'architect', sourceDigest: hash, desiredDigest: hash }] }],
			digest: hash,
		}).success).toBe(true);
	});
});
