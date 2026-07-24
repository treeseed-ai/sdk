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

it('classifies release gate-only failures as stale after staging heads move', () => {
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
							stagingCommit: 'old-root-staging',
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

		expect(classification.state).toBe('stale');
		expect(classification.reasons.join('\n')).toContain('market staging head changed');
	});

it('keeps release gate-only failures resumable while recorded heads still match', () => {
		const root = makeRoot();
		const journal = createWorkflowRunJournal(root, {
			runId: 'release-gate-match-test',
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
					id: 'release-@treeseed/sdk',
					description: 'Release @treeseed/sdk',
					repoName: '@treeseed/sdk',
					repoPath: join(root, 'packages/sdk'),
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
				if (step.id === 'release-@treeseed/sdk') {
					return {
						...step,
						status: 'completed' as const,
						completedAt: new Date().toISOString(),
						data: {
							commitSha: 'sdk-main-release',
							backMerge: { commitSha: 'sdk-staging-release' },
						},
					};
				}
				if (step.id === 'release-root') {
					return {
						...step,
						status: 'completed' as const,
						completedAt: new Date().toISOString(),
						data: {
							stagingCommit: 'root-staging-release',
							releasedCommit: 'root-main-release',
						},
					};
				}
				return step;
			}),
		};

		const classification = classifyWorkflowRunJournal(failed, {
			currentBranch: 'staging',
			currentHeads: {
				'@treeseed/market': 'root-staging-release',
				'@treeseed/sdk': 'sdk-staging-release',
			},
		});

		expect(classification.state).toBe('resumable');
		expect(classification.reasons.join('\n')).toContain('remaining release gates');
	});

it('keeps partial package releases resumable at their recorded release commits', () => {
		const root = makeRoot();
		const journal = createWorkflowRunJournal(root, {
			runId: 'release-partial-package-test',
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
				{ id: 'release-plan', description: 'Record release plan', repoName: '@treeseed/market', repoPath: root, branch: 'staging', resumable: true },
				{ id: 'release-@treeseed/sdk', description: 'Release SDK', repoName: '@treeseed/sdk', repoPath: join(root, 'packages/sdk'), branch: 'staging', resumable: true },
				{ id: 'release-root', description: 'Release market', repoName: '@treeseed/market', repoPath: root, branch: 'staging', resumable: true },
			],
		});
		const failed = {
			...journal,
			status: 'failed' as const,
			failure: { code: 'unsupported_state', message: 'registry propagation', details: null, at: new Date().toISOString() },
			steps: journal.steps.map((step) => step.id === 'release-plan'
				? { ...step, status: 'completed' as const, completedAt: new Date().toISOString(), data: {
					rootRepo: { name: '@treeseed/market', commitSha: 'market-staging' },
					repos: [{ name: '@treeseed/sdk', commitSha: 'sdk-staging' }],
					packageSelection: { selected: ['@treeseed/sdk'] },
				} }
				: step.id === 'release-@treeseed/sdk'
					? { ...step, status: 'completed' as const, completedAt: new Date().toISOString(), data: { commit: { commitSha: 'sdk-release' } } }
					: step),
		};

		const classification = classifyWorkflowRunJournal(failed, {
			currentBranch: 'staging',
			currentHeads: { '@treeseed/market': 'market-staging', '@treeseed/sdk': 'sdk-release' },
		});

		expect(classification.state).toBe('resumable');
	});
});
