import { describe, expect, it } from 'vitest';
import { capObsoleteWorkflowRuns, recommendTreeseedNextSteps, type TreeseedWorkflowState } from '../../src/workflow-state.ts';

function stagingState(unreleasedStagingCommits: number): TreeseedWorkflowState {
	return {
		workspaceRoot: true,
		deployConfigPresent: true,
		files: { machineConfig: true, machineKey: true, treeseedConfig: true },
		secrets: {
			wrappedKeyPresent: true,
			migrationRequired: false,
		},
		workflowControl: {
			interruptedRuns: [],
			lock: { active: false, runId: null },
		},
		branchRole: 'staging',
		branchName: 'staging',
		packageSync: {
			mode: 'recursive-workspace',
			warnings: [],
			blockers: [],
		},
		persistentEnvironments: {
			staging: { initialized: true },
			prod: { initialized: true },
		},
		managedServices: {
			api: { enabled: true },
		},
		releaseHistory: {
			unreleasedStagingCommits,
			stagingAheadMain: unreleasedStagingCommits,
			stagingBehindMain: 0,
			backMerged: true,
			detail: '',
		},
	} as unknown as TreeseedWorkflowState;
}

describe('workflow state recommendations', () => {
	it('does not recommend release when staging is only ahead by release sync commits', () => {
		const recommendations = recommendTreeseedNextSteps(stagingState(0));

		expect(recommendations.map((recommendation) => recommendation.operation)).not.toContain('release');
		expect(recommendations[0]).toMatchObject({
			operation: 'status',
			reason: expect.stringContaining('no unreleased staging commits'),
		});
	});

	it('recommends release when staging has unreleased commits', () => {
		const recommendations = recommendTreeseedNextSteps(stagingState(2));

		expect(recommendations[0]).toMatchObject({
			operation: 'release',
			input: { bump: 'patch' },
		});
	});

	it('caps obsolete workflow history by default', () => {
		const runs = Array.from({ length: 25 }, (_, index) => ({ runId: `run-${index}` }));

		const capped = capObsoleteWorkflowRuns(runs);

		expect(capped.historyMode).toBe('recent');
		expect(capped.obsoleteRuns).toHaveLength(20);
		expect(capped.obsoleteRunsTotal).toBe(25);
		expect(capped.obsoleteRunsOmitted).toBe(5);
	});

	it('keeps all obsolete workflow history when requested', () => {
		const runs = Array.from({ length: 25 }, (_, index) => ({ runId: `run-${index}` }));

		const capped = capObsoleteWorkflowRuns(runs, { history: 'all' });

		expect(capped.historyMode).toBe('all');
		expect(capped.obsoleteRuns).toHaveLength(25);
		expect(capped.obsoleteRunsOmitted).toBe(0);
	});
});
