import { describe, expect, it } from 'vitest';
import { capObsoleteWorkflowRuns, recommendTreeseedNextSteps, type TreeseedWorkflowState } from '../../src/workflow-state.ts';
import { classifyWorkflowRunJournal, type TreeseedWorkflowRunJournal } from '../../src/workflow/runs.ts';

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

	it('marks failed save journals stale after a newer save advances the recorded heads', () => {
		const journal: TreeseedWorkflowRunJournal = {
			schemaVersion: 1,
			kind: 'treeseed.workflow.run',
			runId: 'save-old',
			command: 'save',
			executionMode: 'execute',
			status: 'failed',
			createdAt: '2026-05-10T00:00:00.000Z',
			updatedAt: '2026-05-10T00:01:00.000Z',
			resumable: true,
			input: {},
			session: {
				root: '/tmp/work',
				mode: 'recursive-workspace',
				branchName: 'staging',
				repos: [],
			},
			steps: [
				{
					id: 'save-repositories',
					description: 'Save dependency-ordered repositories',
					repoName: '@treeseed/market',
					repoPath: '/tmp/work',
					branch: 'staging',
					resumable: true,
					status: 'pending',
					completedAt: null,
					data: null,
				},
			],
			failure: {
				code: 'unsupported_state',
				message: 'market deploy failed',
				at: '2026-05-10T00:01:00.000Z',
				details: {
					partialFailure: {
						rootRepo: { name: '@treeseed/market', commitSha: 'old-market' },
						repos: [
							{ name: '@treeseed/sdk', commitSha: 'old-sdk' },
							{ name: '@treeseed/agent', commitSha: 'old-agent' },
						],
					},
				},
			},
			result: null,
			classification: null,
		};

		const classification = classifyWorkflowRunJournal(journal, {
			currentBranch: 'staging',
			currentHeads: {
				'@treeseed/market': 'new-market',
				'@treeseed/sdk': 'new-sdk',
				'@treeseed/agent': 'new-agent',
			},
		});

		expect(classification.state).toBe('stale');
		expect(classification.reasons).toEqual(expect.arrayContaining([
			'@treeseed/market head changed from old-market to new-market',
			'@treeseed/sdk head changed from old-sdk to new-sdk',
			'@treeseed/agent head changed from old-agent to new-agent',
		]));
	});
});
