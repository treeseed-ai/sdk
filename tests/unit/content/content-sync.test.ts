import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyContentSync, planContentSync } from '../../../src/content-sync/reconcile.ts';

function git(cwd: string, args: string[]) {
	return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function fixture() {
	const root = mkdtempSync(join(tmpdir(), 'content-sync-'));
	const remote = join(root, 'remote.git');
	const source = join(root, 'source');
	const local = join(root, 'local');
	git(root, ['init', '--bare', remote]);
	git(root, ['clone', remote, source]);
	git(source, ['config', 'user.email', 'content-sync@example.test']);
	git(source, ['config', 'user.name', 'Content Sync']);
	git(source, ['switch', '-c', 'staging']);
	writeFileSync(join(source, 'README.md'), 'first\n');
	git(source, ['add', 'README.md']);
	git(source, ['commit', '-m', 'first']);
	git(source, ['push', '-u', 'origin', 'staging']);
	git(root, ['clone', '--branch', 'staging', remote, local]);
	return { source, local };
}

describe('repository-native content synchronization', () => {
	it('plans and applies only an exact TreeDX/upstream fast-forward', () => {
		const { source, local } = fixture();
		writeFileSync(join(source, 'README.md'), 'second\n');
		git(source, ['add', 'README.md']);
		git(source, ['commit', '-m', 'second']);
		git(source, ['push']);
		const publicationHead = git(source, ['rev-parse', 'HEAD']);
		const remoteUrl = git(local, ['remote', 'get-url', 'origin']);
		const plan = planContentSync({ repositoryRoot: local, branch: 'staging', treeDxHead: publicationHead,
			publishedHead: publicationHead, publicationRevision: 'revision-one', providerHead: publicationHead,
			canonicalRemoteUrl: remoteUrl });
		expect(plan.status).toBe('verification-required');
		const result = applyContentSync(plan);
		expect(result.status).toBe('up-to-date');
		expect(git(local, ['rev-parse', 'HEAD'])).toBe(publicationHead);
		const repeated = applyContentSync(result);
		expect(repeated).toMatchObject({ status: 'up-to-date', localHead: publicationHead,
			upstreamHead: publicationHead, treeDxHead: publicationHead, publishedHead: publicationHead });
	});

	it('fails closed for dirty state and TreeDX source drift', () => {
		const { source, local } = fixture();
		writeFileSync(join(local, 'README.md'), 'unsaved\n');
		const upstreamHead = git(source, ['rev-parse', 'HEAD']);
		const plan = planContentSync({ repositoryRoot: local, branch: 'staging', treeDxHead: 'a'.repeat(40),
			publishedHead: upstreamHead, publicationRevision: 'revision-one', providerHead: upstreamHead });
		expect(plan.status).toBe('blocked');
		expect(plan.blockers).toEqual(expect.arrayContaining([
			'The local checkout has uncommitted changes. Save them before content sync.',
			`TreeDX resolves ${'a'.repeat(40)}, but origin/staging resolves ${upstreamHead}. Refresh TreeDX before syncing the checkout.`,
		]));
	});

	it('does not claim an unseen remote commit is compatible and refuses divergence after fetch', () => {
		const { source, local } = fixture();
		git(local, ['config', 'user.email', 'content-sync@example.test']);
		git(local, ['config', 'user.name', 'Content Sync']);
		writeFileSync(join(local, 'local.md'), 'local\n');
		git(local, ['add', 'local.md']);
		git(local, ['commit', '-m', 'local divergence']);
		writeFileSync(join(source, 'remote.md'), 'remote\n');
		git(source, ['add', 'remote.md']);
		git(source, ['commit', '-m', 'remote divergence']);
		git(source, ['push']);
		const publicationHead = git(source, ['rev-parse', 'HEAD']);
		const localHead = git(local, ['rev-parse', 'HEAD']);
		const plan = planContentSync({ repositoryRoot: local, branch: 'staging', treeDxHead: publicationHead,
			publishedHead: publicationHead, publicationRevision: 'revision-one', providerHead: publicationHead });
		expect(plan.status).toBe('verification-required');
		expect(() => applyContentSync(plan)).toThrow('fast-forward sync is unsafe');
		expect(git(local, ['rev-parse', 'HEAD'])).toBe(localHead);
	});

	it('fails closed when the atomic publication is missing or stale', () => {
		const { source, local } = fixture();
		const upstreamHead = git(source, ['rev-parse', 'HEAD']);
		const missing = planContentSync({ repositoryRoot: local, branch: 'staging', treeDxHead: upstreamHead,
			publishedHead: null, publicationRevision: null, providerHead: upstreamHead });
		expect(missing.blockers).toContain('The project is not included in an atomic knowledge publication.');
		const stale = planContentSync({ repositoryRoot: local, branch: 'staging', treeDxHead: upstreamHead,
			publishedHead: 'b'.repeat(40), publicationRevision: 'revision-old', providerHead: upstreamHead });
		expect(stale.blockers.some((blocker) => blocker.startsWith('Published knowledge resolves'))).toBe(true);
	});

	it('fails closed when the local origin differs from the canonical repository binding', () => {
		const { source, local } = fixture();
		const head = git(source, ['rev-parse', 'HEAD']);
		const plan = planContentSync({ repositoryRoot: local, branch: 'staging', treeDxHead: head,
			publishedHead: head, publicationRevision: 'revision-one', providerHead: head,
			canonicalRemoteUrl: 'https://github.com/example/wrong.git' });
		expect(plan.status).toBe('blocked');
		expect(plan.blockers.some((item) => item.includes('project binding requires'))).toBe(true);
	});
});
