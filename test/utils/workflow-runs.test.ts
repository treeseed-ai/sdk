import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	archiveWorkflowRun,
	cacheWorkflowGateResult,
	classifyWorkflowRunJournal,
	createWorkflowRunJournal,
	getCachedSuccessfulWorkflowGate,
	readWorkflowRunJournal,
} from '../../src/workflow/runs.ts';

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

	it('keeps release runs resumable when only created release gates remain', () => {
		const root = makeRoot();
		const journal = createWorkflowRunJournal(root, {
			runId: 'release-gate-test',
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
				{
					id: 'release-root-gates',
					description: 'Wait for market release GitHub Actions gates',
					repoName: '@treeseed/market',
					repoPath: root,
					branch: 'main',
					resumable: true,
				},
			],
		});
		const failed = {
			...journal,
			status: 'failed' as const,
			failure: { code: 'github_workflow_failed', message: 'failed', details: null, at: new Date().toISOString() },
			steps: journal.steps.map((step) => {
				if (step.id === 'release-plan') {
					return {
						...step,
						status: 'completed' as const,
						completedAt: new Date().toISOString(),
						data: {
							rootRepo: { name: '@treeseed/market', commitSha: 'old-root' },
							repos: [{ name: '@treeseed/sdk', commitSha: 'old-sdk' }],
							packageSelection: { selected: ['@treeseed/sdk'] },
						},
					};
				}
				if (step.id === 'release-root') {
					return {
						...step,
						status: 'completed' as const,
						completedAt: new Date().toISOString(),
						data: {
							stagingCommit: 'old-root',
							releasedCommit: 'release-root',
						},
					};
				}
				return step;
			}),
		};

		const classification = classifyWorkflowRunJournal(failed, {
			currentBranch: 'staging',
			currentHeads: {
				'@treeseed/market': 'new-root',
				'@treeseed/sdk': 'new-sdk',
			},
		});

		expect(classification.state).toBe('resumable');
		expect(classification.reasons.join('\n')).toContain('remaining release gates');
	});

	it('classifies failed switch runs with no completed checkout steps as obsolete', () => {
		const root = makeRoot();
		const journal = createWorkflowRunJournal(root, {
			runId: 'switch-test',
			command: 'switch',
			input: { branch: 'feature/demo' },
			session: {
				root,
				mode: 'recursive-workspace',
				branchName: null,
				repos: [{ name: '@treeseed/market', path: root, branchName: null }],
			},
			steps: [
				{
					id: 'switch-root',
					description: 'Switch market repo',
					repoName: '@treeseed/market',
					repoPath: root,
					branch: 'feature/demo',
					resumable: true,
				},
			],
		});
		const failed = {
			...journal,
			status: 'failed' as const,
			failure: { code: 'unsupported_state', message: 'failed', details: null, at: new Date().toISOString() },
		};

		const classification = classifyWorkflowRunJournal(failed, {
			currentBranch: 'staging',
			currentHeads: { '@treeseed/market': 'new-root' },
		});

		expect(classification.state).toBe('obsolete');
		expect(classification.reasons.join('\n')).toContain('rerun switch');
	});

	it('archives stale runs without deleting their journal metadata', () => {
		const root = makeRoot();
		makeReleaseJournal(root);
		const classification = { state: 'stale' as const, reasons: ['head changed'], classifiedAt: new Date().toISOString() };

		archiveWorkflowRun(root, 'release-test', classification);

		const archived = readWorkflowRunJournal(root, 'release-test');
		expect(archived?.runId).toBe('release-test');
		expect(archived?.resumable).toBe(false);
		expect(archived?.classification?.archivedAt).toBeTruthy();
	});

	it('caches successful workflow gates by workflow and head sha', () => {
		const root = makeRoot();
		makeReleaseJournal(root);

		cacheWorkflowGateResult(root, 'release-test', {
			repository: 'owner/repo',
			workflow: 'verify.yml',
			headSha: 'abc123',
			branch: 'staging',
			status: 'completed',
			conclusion: 'success',
			runId: 123,
			url: 'https://github.com/owner/repo/actions/runs/123',
		});

		const cached = getCachedSuccessfulWorkflowGate(root, 'release-test', {
			repository: 'owner/repo',
			workflow: 'verify.yml',
			headSha: 'abc123',
			branch: 'staging',
		});
		expect(cached?.runId).toBe(123);
		expect(cached?.result.url).toContain('/123');
	});
});
