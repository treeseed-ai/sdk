import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';

import { tmpdir } from 'node:os';

import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
	archiveWorkflowRun,
	acquireWorkflowLock,
	cacheWorkflowGateResult,
	classifyWorkflowRunJournal,
	createWorkflowRunJournal,
	getCachedSuccessfulWorkflowGate,
	inspectWorkflowLock,
	markActiveWorkflowRunsInterrupted,
	readWorkflowRunJournal,
} from '../../../../src/workflow/runs.ts';

const roots: string[] = [];

function makeRoot() {
	const root = mkdtempSync(join(tmpdir(), 'treeseed-workflow-runs-'));
	roots.push(root);
	return root;
}

function makeReleaseJournal(root: string) {
	return createWorkflowRunJournal(root, {
		runId: 'release-test',
		command: 'release',
		input: { bump: 'patch' },
		session: {
			root,
			mode: 'recursive-workspace',
			branchName: 'staging',
			repos: [
				{ name: '@treeseed/market', path: root, branchName: 'staging' },
				{ name: '@treeseed/sdk', path: join(root, 'packages/sdk'), branchName: 'staging' },
			],
		},
		steps: [
			{
				id: 'release-plan',
				description: 'Record release plan',
				repoName: '@treeseed/market',
				repoPath: root,
				branch: 'staging',
				resumable: true,
			},
			{
				id: 'release-root',
				description: 'Release market repo',
				repoName: '@treeseed/market',
				repoPath: root,
				branch: 'staging',
				resumable: true,
			},
		],
	});
}
describe('workflow run journals', () => {
afterEach(() => {
		for (const root of roots.splice(0)) {
			rmSync(root, { recursive: true, force: true });
		}
	});

it('classifies failed release runs with changed heads as stale', () => {
		const root = makeRoot();
		const journal = makeReleaseJournal(root);
		const failed = {
			...journal,
			status: 'failed' as const,
			failure: { code: 'unsupported_state', message: 'failed', details: null, at: new Date().toISOString() },
			steps: journal.steps.map((step) => step.id === 'release-plan'
				? {
					...step,
					status: 'completed' as const,
					completedAt: new Date().toISOString(),
					data: {
						rootRepo: { name: '@treeseed/market', commitSha: 'old-root' },
						repos: [{ name: '@treeseed/sdk', commitSha: 'old-sdk' }],
						packageSelection: { selected: ['@treeseed/sdk'] },
					},
				}
				: step),
		};

		const classification = classifyWorkflowRunJournal(failed, {
			currentBranch: 'staging',
			currentHeads: {
				'@treeseed/market': 'new-root',
				'@treeseed/sdk': 'old-sdk',
			},
		});

		expect(classification.state).toBe('stale');
		expect(classification.reasons.join('\n')).toContain('market head changed');
	});

it('keeps managed worktree workflow control scoped to the worktree', () => {
		const primaryRoot = makeRoot();
		const worktreeRoot = join(primaryRoot, '.treeseed', 'worktrees', 'feature-scenes');
		mkdirSync(join(worktreeRoot, '.treeseed'), { recursive: true });
		writeFileSync(join(worktreeRoot, '.treeseed', 'worktree.json'), `${JSON.stringify({
			kind: 'treeseed.workflow.worktree',
			branch: 'feature/scenes',
			primaryRoot,
			worktreePath: worktreeRoot,
		}, null, 2)}\n`, 'utf8');

		const lock = acquireWorkflowLock(worktreeRoot, 'save', 'save-worktree-test');
		expect(lock.acquired).toBe(true);

		createWorkflowRunJournal(worktreeRoot, {
			runId: 'save-worktree-test',
			command: 'save',
			input: { message: 'worktree save' },
			session: {
				root: worktreeRoot,
				mode: 'recursive-workspace',
				branchName: 'feature/scenes',
				repos: [{ name: '@treeseed/market', path: worktreeRoot, branchName: 'feature/scenes' }],
			},
			steps: [],
		});

		expect(inspectWorkflowLock(worktreeRoot).lock?.runId).toBe('save-worktree-test');
		expect(inspectWorkflowLock(primaryRoot).active).toBe(false);
		expect(readWorkflowRunJournal(worktreeRoot, 'save-worktree-test')?.runId).toBe('save-worktree-test');
		expect(readWorkflowRunJournal(primaryRoot, 'save-worktree-test')).toBeNull();
		expect(existsSync(join(primaryRoot, '.treeseed', 'workflow', 'lock.json'))).toBe(false);
	});

it('classifies recovery-marked legacy stage failures as resumable', () => {
		const root = makeRoot();
		const journal = createWorkflowRunJournal(root, {
			runId: 'legacy-stage-test',
			command: 'stage',
			input: { message: 'stage legacy branch' },
			session: {
				root,
				mode: 'recursive-workspace',
				branchName: 'release',
				repos: [{ name: '@treeseed/market', path: root, branchName: 'release' }],
			},
			steps: [
				{
					id: 'merge-root',
					description: 'Merge release into market staging',
					repoName: '@treeseed/market',
					repoPath: root,
					branch: 'release',
					resumable: true,
				},
				{
					id: 'wait-staging',
					description: 'Wait for exact-SHA staging GitHub Actions gates',
					repoName: '@treeseed/market',
					repoPath: root,
					branch: 'staging',
					resumable: true,
				},
			],
		});
		const failed = {
			...journal,
			status: 'failed' as const,
			resumable: false,
			failure: {
				code: 'github_workflow_failed',
				message: 'staging gate failed',
				details: {
					recovery: {
						resumable: true,
						runId: 'legacy-stage-test',
						command: 'stage',
					},
				},
				at: new Date().toISOString(),
			},
			steps: journal.steps.map((step) => step.id === 'merge-root'
				? {
					...step,
					status: 'completed' as const,
					completedAt: new Date().toISOString(),
					data: { commitSha: 'staging-head' },
				}
				: step),
		};

		const classification = classifyWorkflowRunJournal(failed, {
			currentBranch: 'release',
			currentHeads: { '@treeseed/market': 'staging-head' },
		});

		expect(classification.state).toBe('resumable');
	});

it('classifies a failed exact-candidate stage as stale after repository heads advance', () => {
		const root = makeRoot();
		const journal = createWorkflowRunJournal(root, {
			runId: 'exact-stage-test',
			command: 'stage',
			input: { message: 'stage exact candidate' },
			session: {
				root,
				mode: 'recursive-workspace',
				branchName: 'feature/stage',
				repos: [{ name: '@treeseed/market', path: root, branchName: 'feature/stage' }],
			},
			steps: [{
				id: 'promote-to-staging',
				description: 'Promote exact refs',
				repoName: '@treeseed/market',
				repoPath: root,
				branch: 'feature/stage',
				resumable: true,
			}],
		});
		const failed = {
			...journal,
			status: 'failed' as const,
			failure: { code: 'github_workflow_failed', message: 'deploy failed', details: null, at: new Date().toISOString() },
			steps: journal.steps.map((step) => ({
				...step,
				status: 'completed' as const,
				data: {
					status: 'completed',
					results: [{ name: '@treeseed/market', commitSha: 'staged-root', verified: true }],
				},
			})),
		};

		expect(classifyWorkflowRunJournal(failed, {
			currentBranch: 'feature/stage',
			currentHeads: { '@treeseed/market': 'new-root' },
		})).toMatchObject({
			state: 'stale',
			reasons: ['@treeseed/market head changed from staged candidate staged-root to new-root'],
		});
	});

it('keeps truly non-resumable failed journals obsolete', () => {
		const root = makeRoot();
		const journal = createWorkflowRunJournal(root, {
			runId: 'non-resumable-test',
			command: 'stage',
			input: { message: 'stage branch' },
			session: {
				root,
				mode: 'recursive-workspace',
				branchName: 'release',
				repos: [{ name: '@treeseed/market', path: root, branchName: 'release' }],
			},
			steps: [
				{
					id: 'worktree-cleanup',
					description: 'Remove managed workflow worktree',
					repoName: '@treeseed/market',
					repoPath: root,
					branch: 'staging',
					resumable: false,
				},
			],
		});
		const failed = {
			...journal,
			status: 'failed' as const,
			failure: { code: 'unsupported_state', message: 'failed', details: null, at: new Date().toISOString() },
		};

		const classification = classifyWorkflowRunJournal(failed, {
			currentBranch: 'release',
			currentHeads: { '@treeseed/market': 'staging-head' },
		});

		expect(classification.state).toBe('obsolete');
		expect(classification.reasons.join('\n')).toContain('not marked resumable');
	});
});
