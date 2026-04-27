import { describe, expect, it, vi } from 'vitest';
import {
	DEFAULT_COMMIT_AI_MODEL,
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
	it('generates fallback messages with inferred type, scope, subject, and body', () => {
		const message = generateFallbackCommitMessage(baseContext);
		const [subject, blank, ...body] = message.split('\n');

		expect(subject).toMatch(/^[a-z]+\([a-z0-9-]+\): /);
		expect(subject.length).toBeLessThanOrEqual(50);
		expect(blank).toBe('');
		expect(body.join('\n')).toContain('- Records the current workflow changes');
		expect(body.every((line) => line.length <= 72)).toBe(true);
		expect(message).not.toContain('@treeseed/sdk');
		expect(message).not.toContain('0.6.8-dev');
	});

	it('uses user messages as hints instead of raw commit messages', async () => {
		const result = await generateRepositoryCommitMessage({
			...baseContext,
			userMessage: 'fix(save): let save run without a message',
		}, {
			mode: 'fallback',
		});

		expect(result.provider).toBe('fallback');
		expect(result.message.split('\n')[0]).toBe('fix(save): let save run without a message');
		expect(result.message).toContain('- Uses the provided save hint');
	});

	it('falls back when Cloudflare config is missing in auto mode', async () => {
		const result = await generateRepositoryCommitMessage(baseContext, {
			env: {},
		});

		expect(result.provider).toBe('fallback');
		expect(result.fallbackUsed).toBe(false);
	});

	it('calls Cloudflare Workers AI with the configured default model', async () => {
		const fetchImpl = vi.fn(async () => ({
			ok: true,
			status: 200,
			json: async () => ({
				result: {
					response: [
						'feat(workflow): generate save messages',
						'',
						'- Explains why save commits need generated messages.',
						'- Keeps dev tag behavior separate from publishing.',
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

		expect(result.provider).toBe('cloudflare-workers-ai');
		expect(result.fallbackUsed).toBe(false);
		expect(fetchImpl.mock.calls[0][0]).toContain(`/ai/run/${DEFAULT_COMMIT_AI_MODEL}`);
		expect(result.message).toContain('feat(workflow): generate save messages');
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
});
