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

it('accepts an externally completed planned release head only when supplied by verified adoption', () => {
		const root = makeRoot();
		const journal = createWorkflowRunJournal(root, {
			runId: 'release-adopted-package-test',
			command: 'release',
			input: { bump: 'patch' },
			session: { root, mode: 'recursive-workspace', branchName: 'staging', repos: [] },
			steps: [
				{ id: 'release-plan', description: 'Record release plan', repoName: '@treeseed/market', repoPath: root, branch: 'staging', resumable: true },
				{ id: 'release-@treeseed/ui', description: 'Release UI', repoName: '@treeseed/ui', repoPath: join(root, 'packages/ui'), branch: 'staging', resumable: true },
			],
		});
		const failed = {
			...journal,
			status: 'failed' as const,
			failure: { code: 'unsupported_state', message: 'parallel release stopped', details: null, at: new Date().toISOString() },
			steps: journal.steps.map((step) => step.id === 'release-plan'
				? { ...step, status: 'completed' as const, completedAt: new Date().toISOString(), data: {
					rootRepo: { name: '@treeseed/market', commitSha: 'market-staging' },
					repos: [{ name: '@treeseed/ui', commitSha: 'ui-staging' }],
					packageSelection: { selected: ['@treeseed/ui'] },
				} }
				: step),
		};

		const stale = classifyWorkflowRunJournal(failed, {
			currentBranch: 'staging',
			currentHeads: { '@treeseed/market': 'market-staging', '@treeseed/ui': 'ui-release' },
		});
		const adopted = classifyWorkflowRunJournal(failed, {
			currentBranch: 'staging',
			currentHeads: { '@treeseed/market': 'market-staging', '@treeseed/ui': 'ui-release' },
			acceptedReleaseHeads: { '@treeseed/ui': 'ui-release' },
		});

		expect(stale.state).toBe('stale');
		expect(adopted.state).toBe('resumable');
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

it('records an interrupted active workflow as resumable before releasing its lock', () => {
		const root = makeRoot();
		createWorkflowRunJournal(root, {
			runId: 'save-interrupted',
			command: 'save',
			input: {},
			session: { root, mode: 'root-only', branchName: 'feature/test', repos: [] },
			steps: [],
		});
		acquireWorkflowLock(root, 'save', 'save-interrupted');

		expect(markActiveWorkflowRunsInterrupted('SIGTERM')).toContain('save-interrupted');
		expect(readWorkflowRunJournal(root, 'save-interrupted')).toMatchObject({
			status: 'failed',
			failure: { code: 'interrupted' },
		});
		expect(inspectWorkflowLock(root).active).toBe(false);
	});
});
