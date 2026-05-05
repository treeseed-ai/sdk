import { describe, expect, it, vi } from 'vitest';
import {
	DEFAULT_COMMIT_AI_MODEL,
	formatCommitMessage,
	generateFallbackCommitMessage,
	generateRepositoryCommitMessage,
} from '../../src/operations/services/commit-message-provider.ts';

const baseContext = {
	repoName: '@treeseed/sdk',
	repoPath: '/tmp/sdk',
	branch: 'staging',
	kind: 'package' as const,
	branchMode: 'package-dev-save' as const,
	changedFiles: [
		'M src/workflow/operations.ts',
		'M src/operations/services/repository-save-orchestrator.ts',
	].join('\n'),
	diff: '+ commit message provider\n+ dev tag guard\n',
	plannedVersion: '0.6.8-dev.staging.20260426T153000Z',
	plannedTag: '0.6.8-dev.staging.20260426T153000Z',
};

describe('commit message provider', () => {
	it('generates fallback messages with structured fact sections', () => {
		const message = generateFallbackCommitMessage(baseContext);
		const [subject, blank, ...body] = message.split('\n');
		const renderedBody = body.join('\n');

		expect(subject).toMatch(/^[a-z]+\([a-z0-9-]+\): /u);
		expect(subject.length).toBeLessThanOrEqual(72);
		expect(blank).toBe('');
		expect(renderedBody).not.toContain('Intent:');
		expect(renderedBody).toContain('Changes:');
		expect(renderedBody).toContain('workflow: 2');
		expect(renderedBody).toContain('0.6.8-dev.staging.20260426T153000Z');
		expect(renderedBody).not.toContain('Why:');
		expect(renderedBody).not.toContain('Validation:');
		expect(message.split('\n').every((line) => line.length <= 72)).toBe(true);
	});

	it('uses user messages as optional intent hints', async () => {
		const result = await generateRepositoryCommitMessage({
			...baseContext,
			userMessage: 'fix(save): let save run without a message',
		}, {
			mode: 'fallback',
		});

		expect(result.provider).toBe('fallback');
		expect(result.message.split('\n')[0]).toBe('fix(save): let save run without a message');
		expect(result.message).toContain('Intent:\n- Save hint: let save run without a message');
		expect(result.message).toContain('Changes:');
	});

	it('formats integrated package and pointer sections', () => {
		const message = formatCommitMessage('chore', 'deps', 'sync integrated package updates', {
			changes: ['Updates root package metadata for finalized package commits.'],
			packageChanges: [
				'@treeseed/sdk packages/sdk: abc123 -> def456, tag 0.6.8-dev.demo, child: feat(save): record context',
			],
			dependencyUpdates: [
				'dependencies.@treeseed/sdk: github:old#tag -> github:new#tag',
				'@treeseed/sdk packages/sdk: abc123 -> def456',
			],
		});

		expect(message).toContain('Integrated package changes:');
		expect(message).toContain('@treeseed/sdk packages/sdk');
		expect(message).toContain('Dependency and pointer updates:');
	});

	it('falls back when Cloudflare config is missing in auto mode', async () => {
		const result = await generateRepositoryCommitMessage(baseContext, {
			env: {},
		});

		expect(result.provider).toBe('fallback');
		expect(result.fallbackUsed).toBe(false);
	});

	it('calls Cloudflare Workers AI with no-tool prompt and structured context', async () => {
		const fetchImpl = vi.fn(async () => ({
			ok: true,
			status: 200,
			json: async () => ({
				result: {
					response: [
						'feat(workflow): generate save messages',
						'',
						'Changes:',
						'- Updates the save workflow commit message provider.',
						'- Keeps package tag context visible to the commit generator.',
					].join('\n'),
				},
			}),
		} as Response));

		const result = await generateRepositoryCommitMessage({
			...baseContext,
			packageChanges: [{
				name: '@treeseed/core',
				path: 'packages/core',
				oldSha: '1111111111111111111111111111111111111111',
				newSha: '2222222222222222222222222222222222222222',
				tagName: '0.6.8-dev.staging.20260426T153000Z',
				commitSubject: 'feat(runtime): update package runtime',
			}],
		}, {
			mode: 'cloudflare',
			env: {
				CLOUDFLARE_API_TOKEN: 'token',
				CLOUDFLARE_ACCOUNT_ID: 'account',
			},
			fetchImpl,
		});

		const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body)) as {
			messages: Array<{ role: string; content: string }>;
		};

		expect(result.provider).toBe('cloudflare-workers-ai');
		expect(result.fallbackUsed).toBe(false);
		expect(fetchImpl.mock.calls[0][0]).toContain(`/ai/run/${DEFAULT_COMMIT_AI_MODEL}`);
		expect(body.messages[0].content).toContain('You have no tool access');
		expect(body.messages[0].content).toContain('Do not include a Why section');
		expect(body.messages[1].content).toContain('Integrated package changes:');
		expect(body.messages[1].content).toContain('@treeseed/core packages/core');
		expect(body.messages[1].content.indexOf('Integrated package changes:')).toBeLessThan(
			body.messages[1].content.indexOf('Diff (truncated'),
		);
		expect(result.message).toContain('Changes:');
	});

	it('falls back when Cloudflare returns invalid output', async () => {
		const fetchImpl = vi.fn(async () => ({
			ok: true,
			status: 200,
			json: async () => ({ result: { response: 'not a commit message' } }),
		} as Response));

		const result = await generateRepositoryCommitMessage(baseContext, {
			mode: 'cloudflare',
			env: {
				CLOUDFLARE_API_TOKEN: 'token',
				CLOUDFLARE_ACCOUNT_ID: 'account',
			},
			fetchImpl,
		});

		expect(result.provider).toBe('fallback');
		expect(result.fallbackUsed).toBe(true);
		expect(result.error).toContain('required subject template');
	});

	it('falls back when Cloudflare omits the Changes section', async () => {
		const fetchImpl = vi.fn(async () => ({
			ok: true,
			status: 200,
			json: async () => ({
				result: {
					response: [
						'feat(workflow): add progress reporting',
						'',
						'- Updates save output.',
					].join('\n'),
				},
			}),
		} as Response));

		const result = await generateRepositoryCommitMessage(baseContext, {
			mode: 'cloudflare',
			env: {
				CLOUDFLARE_API_TOKEN: 'token',
				CLOUDFLARE_ACCOUNT_ID: 'account',
			},
			fetchImpl,
		});

		expect(result.provider).toBe('fallback');
		expect(result.fallbackUsed).toBe(true);
		expect(result.error).toContain('body text before a supported section');
	});

	it('rejects forbidden Why and Validation sections', async () => {
		const fetchImpl = vi.fn(async () => ({
			ok: true,
			status: 200,
			json: async () => ({
				result: {
					response: [
						'feat(workflow): add progress reporting',
						'',
						'Why:',
						'- The user probably wanted better save history.',
						'',
						'Changes:',
						'- Updates save output.',
					].join('\n'),
				},
			}),
		} as Response));

		const result = await generateRepositoryCommitMessage(baseContext, {
			mode: 'cloudflare',
			env: {
				CLOUDFLARE_API_TOKEN: 'token',
				CLOUDFLARE_ACCOUNT_ID: 'account',
			},
			fetchImpl,
		});

		expect(result.provider).toBe('fallback');
		expect(result.fallbackUsed).toBe(true);
		expect(result.error).toContain('forbidden Why section');
	});

	it('rejects Intent when no save hint exists', async () => {
		const fetchImpl = vi.fn(async () => ({
			ok: true,
			status: 200,
			json: async () => ({
				result: {
					response: [
						'feat(workflow): add progress reporting',
						'',
						'Intent:',
						'- Improve save history.',
						'',
						'Changes:',
						'- Updates save output.',
					].join('\n'),
				},
			}),
		} as Response));

		const result = await generateRepositoryCommitMessage(baseContext, {
			mode: 'cloudflare',
			env: {
				CLOUDFLARE_API_TOKEN: 'token',
				CLOUDFLARE_ACCOUNT_ID: 'account',
			},
			fetchImpl,
		});

		expect(result.provider).toBe('fallback');
		expect(result.fallbackUsed).toBe(true);
		expect(result.error).toContain('Intent without a save hint');
	});

	it('repairs subjects that become incomplete after truncation', () => {
		const message = formatCommitMessage('chore', 'deps', 'update internal packages and lockfile references across the integrated workspace', [
			'Keeps dependency references aligned with package lockfiles.',
		]);
		const subject = message.split('\n')[0];

		expect(subject.length).toBeLessThanOrEqual(72);
		expect(subject).not.toMatch(/\b(and|for|update)$/u);
	});

	it('falls back when Cloudflare returns an incomplete verb-only subject', async () => {
		const fetchImpl = vi.fn(async () => ({
			ok: true,
			status: 200,
			json: async () => ({
				result: {
					response: [
						'chore(deps): bump version and update',
						'',
						'Changes:',
						'- Updates package metadata changes.',
						'- Keeps lockfiles synchronized with dependency changes.',
					].join('\n'),
				},
			}),
		} as Response));

		const result = await generateRepositoryCommitMessage(baseContext, {
			mode: 'cloudflare',
			env: {
				CLOUDFLARE_API_TOKEN: 'token',
				CLOUDFLARE_ACCOUNT_ID: 'account',
			},
			fetchImpl,
		});

		expect(result.provider).toBe('fallback');
		expect(result.fallbackUsed).toBe(true);
		expect(result.error).toContain('appears truncated');
	});
});
