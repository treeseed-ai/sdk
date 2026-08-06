import { mkdtempSync,mkdirSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe,expect,it } from 'vitest';
import { publicationKeys } from '../../../src/platform/published-content/publication-contracts.ts';
import { reconcileContentPublication } from '../../../src/platform/published-content/reconcile-content-publication.ts';

describe('content publication reconciliation', () => {
	it('selects canonical preview, staging, production, manifest, and object keys', () => {
		const base = { teamId: 'team-a', projectId: 'project-a', ref: 'feature/chat', revision: 'abc' };
		expect(publicationKeys({ ...base, channel: 'production' }).pointerKey).toBe('teams/team-a/published/common.json');
		expect(publicationKeys({ ...base, channel: 'staging' }).pointerKey).toBe('teams/team-a/published/staging.json');
		expect(publicationKeys({ ...base, channel: 'preview' }).pointerKey).toBe('teams/team-a/previews/project-a/0e10476e6d52d119e467a7a5d365d15b0a9e45a26dd0a49886a2c9191065574f/manifest.json');
		expect(publicationKeys({ ...base, channel: 'production' }).manifestKey).toBe('teams/team-a/published/manifests/abc.json');
		expect(publicationKeys({ ...base, channel: 'production' }).objectRoot).toBe('teams/team-a/objects/sha256');
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
});
