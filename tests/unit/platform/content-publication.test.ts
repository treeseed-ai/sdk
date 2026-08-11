import { execFileSync } from 'node:child_process';
import { mkdtempSync,mkdirSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe,expect,it } from 'vitest';
import { publicationKeys } from '../../../src/platform/published-content/publication-contracts.ts';
import { reconcileContentPublication } from '../../../src/platform/published-content/reconcile-content-publication.ts';

describe('content publication reconciliation', () => {
	it('selects canonical preview, staging, production, manifest, and object keys', () => {
		const base = { teamId: 'team-a', projectId: 'project-a', ref: 'feature/chat', revision: 'abc' };
		expect(publicationKeys({ ...base, channel: 'production' }).pointerKey).toBe('content/team-a/project-a/production/channels/current.json');
		expect(publicationKeys({ ...base, channel: 'staging' }).pointerKey).toBe('content/team-a/project-a/staging/channels/current.json');
		expect(publicationKeys({ ...base, channel: 'preview' }).pointerKey).toBe('content/team-a/project-a/previews/0e10476e6d52d119e467a7a5d365d15b0a9e45a26dd0a49886a2c9191065574f/manifest.json');
		expect(publicationKeys({ ...base, channel: 'production' }).manifestKey).toBe('content/team-a/project-a/production/releases/abc/manifest.json');
		expect(publicationKeys({ ...base, channel: 'production' }).objectRoot).toBe('content/team-a/project-a/production/releases/abc/content');
	});

	it('fails closed before advancing a channel when the live source ref becomes stale', async () => {
		const root = mkdtempSync(join(tmpdir(), 'content-publication-stale-'));
		mkdirSync(join(root, 'src/content'), { recursive: true });
		writeFileSync(join(root, 'src/content/example.md'), '# Exact\n');
		const sourceCommit = '0123456789012345678901234567890123456789';
		await expect(reconcileContentPublication({
			projectRoot: root, contentPath: 'src/content', teamId: 'team-a', projectId: 'project-a',
			sourceCommit, ref: 'staging', channel: 'staging', generatedAt: '2026-08-11T00:00:00.000Z',
			observeSourceCommit: async () => sourceCommit,
			verifySourceStillCurrent: async () => false,
			r2: { accountId: 'account', bucket: 'bucket', accessKeyId: 'key', secretAccessKey: 'secret' },
			fetchImpl: async () => new Response(null, { status: 404 }),
		})).rejects.toThrow('live content repository ref changed');
	});

	it('validates exact-commit content and emits only durable artifact references', async () => {
		const root = mkdtempSync(join(tmpdir(), 'content-publication-'));
		mkdirSync(join(root, 'src/content/notes'), { recursive: true });
		writeFileSync(join(root, 'src/content/notes/example.md'), '---\ntitle: Example\n---\nBody\n');
		const receipt = await reconcileContentPublication({
			projectRoot: root,
			contentPath: 'src/content',
			teamId: 'team-a',
			projectId: 'project-a',
			sourceCommit: '0123456789012345678901234567890123456789',
			observeSourceCommit: async () => '0123456789012345678901234567890123456789',
			generatedAt: '2026-08-11T00:00:00.000Z',
			ref: 'feature/content',
			channel: 'preview',
			validateOnly: true,
		});

		expect(receipt.verified).toBe(true);
		expect(receipt.artifacts).toHaveLength(1);
		expect(receipt.artifacts[0]).toMatchObject({ contract: 'treeseed.artifact-ref/v1', kind: 'r2-object' });
		expect(JSON.stringify(receipt)).not.toMatch(/secret|signedUrl|credential/iu);
	});

	it('rejects source provenance and content paths outside the exact checkout', async () => {
		const root = mkdtempSync(join(tmpdir(), 'content-publication-source-'));
		mkdirSync(join(root, 'src/content'), { recursive: true });
		const base = {
			projectRoot: root, contentPath: 'src/content', teamId: 'team-a', projectId: 'project-a',
			sourceCommit: '0123456789012345678901234567890123456789', ref: 'main', channel: 'production' as const,
			validateOnly: true,
		};
		await expect(reconcileContentPublication({ ...base, observeSourceCommit: async () => 'f'.repeat(40) }))
			.rejects.toThrow('does not match');
		await expect(reconcileContentPublication({ ...base, contentPath: '../outside', observeSourceCommit: async () => base.sourceCommit }))
			.rejects.toThrow('inside projectRoot');
	});

	it('derives deterministic provenance from a clean Git commit and rejects dirty content', async () => {
		const root = mkdtempSync(join(tmpdir(), 'content-publication-git-'));
		mkdirSync(join(root, 'src/content'), { recursive: true });
		writeFileSync(join(root, 'src/content/example.md'), '# Exact\n');
		execFileSync('git', ['init', '--quiet'], { cwd: root });
		execFileSync('git', ['config', 'user.name', 'Content test'], { cwd: root });
		execFileSync('git', ['config', 'user.email', 'content-test@treeseed.dev'], { cwd: root });
		execFileSync('git', ['add', '.'], { cwd: root });
		execFileSync('git', ['commit', '--quiet', '-m', 'content'], { cwd: root });
		const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
		const input = { projectRoot: root, contentPath: 'src/content', teamId: 'team-a', projectId: 'project-a', sourceCommit, ref: 'staging', channel: 'staging' as const, validateOnly: true };
		const first = await reconcileContentPublication(input);
		const replay = await reconcileContentPublication(input);
		expect(replay).toEqual(first);
		writeFileSync(join(root, 'src/content/example.md'), '# Dirty\n');
		await expect(reconcileContentPublication(input)).rejects.toThrow('exact clean content tree');
	});
});
