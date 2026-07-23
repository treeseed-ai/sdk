import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { capObsoleteWorkflowRuns, capWorkflowRunHistory, recommendTreeseedNextSteps, type TreeseedWorkflowState } from '../../../src/workflow-state.ts';
import {
	acquireWorkflowLock,
	classifyWorkflowRunJournal,
	inspectWorkflowLock,
	releaseWorkflowLock,
	type TreeseedWorkflowRunJournal,
} from '../../../src/workflow/runs.ts';

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

	it('caps generic workflow run history by default', () => {
		const runs = Array.from({ length: 25 }, (_, index) => ({ runId: `run-${index}` }));

		const capped = capWorkflowRunHistory(runs);

		expect(capped.historyMode).toBe('recent');
		expect(capped.runs).toHaveLength(20);
		expect(capped.total).toBe(25);
		expect(capped.omitted).toBe(5);
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

describe('workflow lock scopes', () => {
	function managedWorktree(primaryRoot: string, name: string) {
		const root = mkdtempSync(join(tmpdir(), `treeseed-${name}-`));
		mkdirSync(resolve(root, '.treeseed'), { recursive: true });
		writeFileSync(resolve(root, '.treeseed', 'worktree.json'), JSON.stringify({
			kind: 'treeseed.workflow.worktree',
			primaryRoot,
			worktreePath: root,
		}, null, 2), 'utf8');
		return root;
	}

	it('allows save locks to stay isolated per managed worktree', () => {
		const primary = mkdtempSync(join(tmpdir(), 'treeseed-primary-'));
		const left = managedWorktree(primary, 'left');
		const right = managedWorktree(primary, 'right');

		const leftSave = acquireWorkflowLock(left, 'save', 'save-left');
		const rightSave = acquireWorkflowLock(right, 'save', 'save-right');

		expect(leftSave.acquired).toBe(true);
		expect(rightSave.acquired).toBe(true);
		expect(inspectWorkflowLock(left).lock?.runId).toBe('save-left');
		expect(inspectWorkflowLock(right).lock?.runId).toBe('save-right');
		expect(inspectWorkflowLock(right, { scope: 'shared' }).active).toBe(false);

		releaseWorkflowLock(left, 'save-left');
		releaseWorkflowLock(right, 'save-right');
	});

	it('keeps stage and release shared without blocking worktree-local saves', () => {
		const primary = mkdtempSync(join(tmpdir(), 'treeseed-primary-'));
		const left = managedWorktree(primary, 'left');
		const right = managedWorktree(primary, 'right');

		const stage = acquireWorkflowLock(left, 'stage', 'stage-shared');
		const rightSave = acquireWorkflowLock(right, 'save', 'save-right');
		const blockedRelease = acquireWorkflowLock(right, 'release', 'release-shared');

		expect(stage.acquired).toBe(true);
		expect(inspectWorkflowLock(right, { scope: 'shared' }).lock?.runId).toBe('stage-shared');
		expect(rightSave.acquired).toBe(true);
		expect(blockedRelease.acquired).toBe(false);
		expect(blockedRelease.lock.runId).toBe('stage-shared');

		releaseWorkflowLock(left, 'stage-shared');
		releaseWorkflowLock(right, 'save-right');
	});

	it('reclaims a dead-process lock automatically on the next workflow', () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-stale-lock-'));
		const controlRoot = resolve(root, '.treeseed', 'workflow');
		mkdirSync(resolve(controlRoot, 'runs'), { recursive: true });
		writeFileSync(resolve(controlRoot, 'lock.json'), JSON.stringify({
			schemaVersion: 1,
			kind: 'treeseed.workflow.lock',
			scope: 'worktree',
			runId: 'save-dead-process',
			command: 'save',
			root,
			host: hostname(),
			pid: 2_147_483_647,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		}), 'utf8');

		const replacement = acquireWorkflowLock(root, 'save', 'save-replacement');
		expect(replacement.acquired).toBe(true);
		expect(replacement.replacedStale).toBe(true);
		expect(inspectWorkflowLock(root).lock?.runId).toBe('save-replacement');
		releaseWorkflowLock(root, 'save-replacement');
	});
});
