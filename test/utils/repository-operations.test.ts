import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	createPlatformRepositoryClaim,
	derivePlatformRepositoryKey,
	executePlatformRepositoryOperation,
	normalizePlatformContentInput,
	resolvePlatformRepositoryWorkspacePath,
	type PlatformRepositoryDescriptor,
} from '../../src/index.ts';

function git(cwd: string, args: string[]) {
	return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function tempRoot() {
	return mkdtempSync(resolve(tmpdir(), 'treeseed-repo-op-'));
}

function createRepo() {
	const root = tempRoot();
	const repo = resolve(root, 'source');
	mkdirSync(repo, { recursive: true });
	git(repo, ['init', '-b', 'staging']);
	git(repo, ['config', 'user.email', 'test@example.com']);
	git(repo, ['config', 'user.name', 'TreeSeed Test']);
	mkdirSync(resolve(repo, 'src/content/notes'), { recursive: true });
	mkdirSync(resolve(repo, 'src/content/objectives'), { recursive: true });
	mkdirSync(resolve(repo, 'src/content/proposals'), { recursive: true });
	mkdirSync(resolve(repo, 'src/content/decisions'), { recursive: true });
	writeFileSync(resolve(repo, 'README.md'), 'fixture\n', 'utf8');
	git(repo, ['add', '.']);
	git(repo, ['commit', '-m', 'init']);
	const workspace = resolve(root, 'workspace');
	mkdirSync(workspace, { recursive: true });
	const descriptor: PlatformRepositoryDescriptor = {
		provider: 'local',
		owner: 'treeseed',
		name: 'fixture',
		defaultBranch: 'staging',
		cloneUrl: repo,
		writeMode: 'workspace',
	};
	return { root, repo, workspace, descriptor };
}

describe('platform repository operations', () => {
	it('derives repository claims and per-runner workspace paths', () => {
		const fixture = createRepo();
		try {
			const key = derivePlatformRepositoryKey(fixture.descriptor);
			expect(key).toBe('local-treeseed-fixture');
			expect(resolvePlatformRepositoryWorkspacePath('/data/runner-01', fixture.descriptor)).toBe('/data/runner-01/repositories/local-treeseed-fixture/repo');
			const claim = createPlatformRepositoryClaim({
				repository: fixture.descriptor,
				runnerId: 'runner-01',
				workspaceRoot: '/data/runner-01',
				leaseSeconds: 90,
			});
			expect(claim).toMatchObject({
				id: 'local-treeseed-fixture:runner-01',
				repositoryKey: key,
				runnerId: 'runner-01',
				workspacePath: '/data/runner-01/repositories/local-treeseed-fixture/repo',
				claimState: 'active',
				branch: 'staging',
			});
			expect(new Date(claim.leaseExpiresAt ?? '').getTime()).toBeGreaterThan(Date.now());
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it('writes content records inside the runner workspace and reports changed paths', async () => {
		const fixture = createRepo();
		try {
			const normalized = normalizePlatformContentInput('notes', {
				title: 'Runner note',
				summary: 'Created by the Treeseed operations runner.',
			});
			if ('error' in normalized) throw new Error(normalized.error);
			const result = await executePlatformRepositoryOperation('write_content_record', {
				projectId: 'project-1',
				repository: fixture.descriptor,
				collection: 'notes',
				normalized,
				payload: { title: 'Runner note' },
			}, { workspaceRoot: fixture.workspace });
			expect(result.changedPaths).toContain('src/content/notes/runner-note.mdx');
			expect(result.href).toBe('/app/work/notes/runner-note');
			expect(result.repository).toMatchObject({
				key: 'local-treeseed-fixture',
				provider: 'local',
				owner: 'treeseed',
				name: 'fixture',
			});
			expect(result.baseBranch).toBe('staging');
			expect(result.operationBranch).toBeNull();
			expect(result.verification).toBeNull();
			expect(result.pullRequest).toBeNull();
			expect(result.workflowRun).toBeNull();
			expect(result.output.record).toMatchObject({
				collection: 'notes',
				slug: 'runner-note',
				href: '/app/work/notes/runner-note',
			});
			const written = resolve(result.repositoryPath, 'src/content/notes/runner-note.mdx');
			expect(readFileSync(written, 'utf8')).toContain('title: Runner note');
			expect(existsSync(resolve(fixture.repo, 'src/content/notes/runner-note.mdx'))).toBe(false);
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it('rejects duplicate slugs and unsupported path targets', async () => {
		const fixture = createRepo();
		try {
			await executePlatformRepositoryOperation('write_content_record', {
				repository: fixture.descriptor,
				collection: 'notes',
				payload: { title: 'Duplicate' },
			}, { workspaceRoot: fixture.workspace });
			await expect(executePlatformRepositoryOperation('write_content_record', {
				repository: fixture.descriptor,
				collection: 'notes',
				payload: { title: 'Duplicate' },
			}, { workspaceRoot: fixture.workspace })).rejects.toThrow(/already exists/u);
			await expect(executePlatformRepositoryOperation('write_content_record', {
				repository: fixture.descriptor,
				collection: 'secrets',
				payload: { title: 'Nope' },
			}, { workspaceRoot: fixture.workspace })).rejects.toThrow(/Unsupported/u);
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it('can overwrite an existing content body while preserving frontmatter', async () => {
		const fixture = createRepo();
		try {
			writeFileSync(resolve(fixture.repo, 'src/content/objectives/core.mdx'), [
				'---',
				'id: objective:core',
				'title: Launch Core Objective',
				'description: Original launch description',
				'status: live',
				'timeHorizon: long-term',
				'customLineage: from-template',
				'---',
				'',
				'Original body.',
				'',
			].join('\n'), 'utf8');
			git(fixture.repo, ['add', '.']);
			git(fixture.repo, ['commit', '-m', 'seed core objective']);
			const normalized = normalizePlatformContentInput('objectives', {
				title: 'Core Objective',
				slug: 'core',
				description: 'Updated generated description',
				body: '# Core Objective\n\nUpdated body.',
			});
			if ('error' in normalized) throw new Error(normalized.error);
			const result = await executePlatformRepositoryOperation('write_content_record', {
				projectId: 'project-1',
				repository: fixture.descriptor,
				collection: 'objectives',
				normalized,
				payload: {
					title: 'Core Objective',
					slug: 'core',
					overwrite: true,
					preserveFrontmatter: true,
				},
			}, { workspaceRoot: fixture.workspace });
			const written = readFileSync(resolve(result.repositoryPath, 'src/content/objectives/core.mdx'), 'utf8');
			expect(written).toContain('title: Launch Core Objective');
			expect(written).toContain('customLineage: from-template');
			expect(written).toContain('# Core Objective');
			expect(written).toContain('Updated body.');
			expect(written).not.toContain('Original body.');
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it('creates related content and updates both sides of the relation', async () => {
		const fixture = createRepo();
		try {
			await executePlatformRepositoryOperation('write_content_record', {
				repository: fixture.descriptor,
				collection: 'notes',
				payload: { title: 'Parent note' },
			}, { workspaceRoot: fixture.workspace });
			const result = await executePlatformRepositoryOperation('create_related_content', {
				repository: fixture.descriptor,
				parentCollection: 'notes',
				parentSlug: 'parent-note',
				targetCollection: 'proposals',
				payload: { title: 'Related proposal' },
			}, { workspaceRoot: fixture.workspace });
			expect(result.changedPaths).toEqual(expect.arrayContaining([
				'src/content/notes/parent-note.mdx',
				'src/content/proposals/related-proposal.mdx',
			]));
			expect(result.href).toBe('/app/work/proposals/related-proposal');
			expect(readFileSync(resolve(result.repositoryPath, 'src/content/notes/parent-note.mdx'), 'utf8')).toContain('relatedProposals');
			expect(readFileSync(resolve(result.repositoryPath, 'src/content/proposals/related-proposal.mdx'), 'utf8')).toContain('relatedNotes');
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it('creates decisions from proposals and can commit on an explicit branch', async () => {
		const fixture = createRepo();
		try {
			await executePlatformRepositoryOperation('write_content_record', {
				repository: fixture.descriptor,
				collection: 'proposals',
				payload: { title: 'Proposal one' },
			}, { workspaceRoot: fixture.workspace });
			const result = await executePlatformRepositoryOperation('create_decision_from_proposals', {
				repository: {
					...fixture.descriptor,
					writeMode: 'branch',
					branchName: 'treeseed/platform-test',
				},
				proposalSlugs: ['proposal-one'],
				decisionType: 'approved',
				reason: 'Looks good.',
				title: 'Approve proposal one',
				commitMessage: 'Create platform decision',
			}, { workspaceRoot: fixture.workspace });
			expect(result.changedPaths).toEqual(expect.arrayContaining([
				'src/content/decisions/approve-proposal-one.mdx',
				'src/content/proposals/proposal-one.mdx',
			]));
			expect(result.branch).toBe('treeseed/platform-test');
			expect(result.operationBranch).toBe('treeseed/platform-test');
			expect(result.commitSha).toMatch(/^[a-f0-9]{40}$/u);
			expect(result.href).toBe('/app/work/decisions/approve-proposal-one');
			expect(git(fixture.repo, ['branch', '--list', 'treeseed/platform-test'])).toBe('');
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it('rejects unsupported and unapproved production repository write modes', async () => {
		const fixture = createRepo();
		try {
			await expect(executePlatformRepositoryOperation('write_content_record', {
				repository: { ...fixture.descriptor, writeMode: 'direct' },
				collection: 'notes',
				payload: { title: 'Direct write' },
			}, { workspaceRoot: fixture.workspace })).rejects.toThrow(/not enabled/u);
			await expect(executePlatformRepositoryOperation('write_content_record', {
				repository: {
					...fixture.descriptor,
					writeMode: 'branch',
					branchName: 'treeseed/prod-test',
					push: true,
				},
				collection: 'notes',
				payload: { title: 'Production push' },
			}, { workspaceRoot: fixture.workspace, environment: 'production' })).rejects.toThrow(/requires an approval/u);
			await expect(executePlatformRepositoryOperation('write_content_record', {
				repository: {
					...fixture.descriptor,
					writeMode: 'branch',
					branchName: 'treeseed/staging-push',
					push: true,
				},
				collection: 'notes',
				payload: { title: 'Unapproved staging push' },
			}, { workspaceRoot: fixture.workspace, environment: 'staging' })).rejects.toThrow(/requires an approval/u);
			await expect(executePlatformRepositoryOperation('write_content_record', {
				repository: {
					...fixture.descriptor,
					writeMode: 'branch',
					branchName: 'treeseed/prod-approved-push',
					push: true,
				},
				approvalRequired: true,
				approvalId: 'approval-1',
				collection: 'notes',
				payload: { title: 'Approved production push' },
			}, { workspaceRoot: fixture.workspace, environment: 'production' })).rejects.toThrow(/disabled/u);
			const approved = await executePlatformRepositoryOperation('write_content_record', {
				repository: {
					...fixture.descriptor,
					writeMode: 'branch',
					branchName: 'treeseed/prod-approved',
					push: false,
				},
				approvalRequired: true,
				approvalId: 'approval-1',
				collection: 'notes',
				payload: { title: 'Approved branch' },
			}, { workspaceRoot: fixture.workspace, environment: 'production' });
			expect(approved.branch).toBe('treeseed/prod-approved');
			expect(approved.commitSha).toMatch(/^[a-f0-9]{40}$/u);
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it('runs verification commands before committing and reports failures without a commit', async () => {
		const fixture = createRepo();
		try {
			const verified = await executePlatformRepositoryOperation('write_content_record', {
				repository: {
					...fixture.descriptor,
					writeMode: 'branch',
					branchName: 'treeseed/verified',
					verificationCommands: [{ command: process.execPath, args: ['-e', 'process.exit(0)'] }],
				},
				collection: 'notes',
				payload: { title: 'Verified note' },
			}, { workspaceRoot: fixture.workspace, environment: 'staging' });
			expect(verified.verification).toMatchObject({
				status: 'passed',
				commands: [expect.objectContaining({ command: process.execPath, exitCode: 0 })],
			});
			expect(verified.commitSha).toMatch(/^[a-f0-9]{40}$/u);

			await expect(executePlatformRepositoryOperation('write_content_record', {
				repository: {
					...fixture.descriptor,
					writeMode: 'branch',
					branchName: 'treeseed/failing-verification',
					verificationCommands: [{ command: process.execPath, args: ['-e', 'process.stderr.write("nope"); process.exit(7)'] }],
				},
				collection: 'notes',
				payload: { title: 'Failing verification note' },
			}, { workspaceRoot: fixture.workspace, environment: 'staging' })).rejects.toMatchObject({
				name: 'PlatformRepositoryVerificationError',
				verification: {
					status: 'failed',
					commands: [expect.objectContaining({ exitCode: 7 })],
				},
			});
			expect(git(resolve(fixture.workspace, 'repositories/local-treeseed-fixture/repo'), ['branch', '--list', 'treeseed/failing-verification'])).toBe('');
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});
});
