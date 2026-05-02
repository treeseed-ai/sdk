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
