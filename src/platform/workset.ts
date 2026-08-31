import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { type Inventory, type PlatformProfile, type WorksetEntry, type WorksetPlan, type WorksetReceipt, type WorksetSelection, worksetReceiptSchema } from './schemas.ts';
import { resolveProfileProjects } from './inventory.ts';

export interface GitRunner { run(cwd: string, args: string[]): string }
export interface RemoteObserver { observe(url: string, branch: string): string; isAncestor(url: string, base: string, target: string): boolean }
export interface PlanWorksetInput { root: string; inventoryPath: string; inventoryDigest: string; inventory: Inventory; profiles?: PlatformProfile[]; selection?: Partial<WorksetSelection>; git?: GitRunner; remote?: RemoteObserver }

const systemGit: GitRunner = { run: (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() };
const systemRemote: RemoteObserver = { observe: (url, branch) => {
	const output = execFileSync('git', ['ls-remote', '--exit-code', url, `refs/heads/${branch}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
	const commit = output.split(/\s+/u)[0];
	if (!commit) throw new Error(`Remote branch ${branch} was not found at ${url}.`);
	return commit;
}, isAncestor: (url, base, target) => {
	const temporary = mkdtempSync(resolve(tmpdir(), 'platform-workset-'));
	try {
		execFileSync('git', ['init', '--bare', temporary], { stdio: 'ignore' });
		execFileSync('git', ['fetch', '--quiet', '--filter=blob:none', '--no-tags', url, target], { cwd: temporary, stdio: 'ignore' });
		execFileSync('git', ['merge-base', '--is-ancestor', base, target], { cwd: temporary, stdio: 'ignore' });
		return true;
	} catch { return false; }
	finally { rmSync(temporary, { recursive: true, force: true }); }
} };

const digest = (value: unknown) => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
const normalizedRemote = (url: string) => url.replace(/^git@github\.com:/u, 'https://github.com/').replace(/\.git$/u, '').toLowerCase();

function safePath(root: string, slug: string): string {
	const path = resolve(root, 'packages', slug);
	if (!path.startsWith(`${resolve(root)}/packages/`)) throw new Error(`Project ${slug} escapes packages/.`);
	return path;
}

function inspectCheckout(entry: Omit<WorksetEntry, 'action' | 'blockers'>, git: GitRunner, remote: RemoteObserver): WorksetEntry {
	if (!existsSync(entry.path)) return { ...entry, action: 'clone', blockers: [] };
	const blockers: string[] = [];
	if (lstatSync(entry.path).isSymbolicLink()) blockers.push('checkout_path_is_symlink');
	try {
		if (realpathSync(entry.path) !== entry.path) blockers.push('checkout_path_not_canonical');
		if (normalizedRemote(git.run(entry.path, ['remote', 'get-url', 'origin'])) !== normalizedRemote(entry.gitUrl)) blockers.push('origin_mismatch');
		if (git.run(entry.path, ['status', '--porcelain'])) blockers.push('checkout_dirty');
		if (git.run(entry.path, ['branch', '--show-current']) !== entry.branch) blockers.push('branch_mismatch');
		const current = git.run(entry.path, ['rev-parse', 'HEAD']);
		if (current === entry.commit) return { ...entry, action: blockers.length ? 'blocked' : 'noop', blockers };
		if (!remote.isAncestor(entry.gitUrl, current, entry.commit)) blockers.push('remote_history_diverged');
		return { ...entry, action: blockers.length ? 'blocked' : 'fast-forward', blockers };
	} catch {
		blockers.push('checkout_not_safe_git_repository');
		return { ...entry, action: 'blocked', blockers: [...new Set(blockers)] };
	}
}

export function planPlatformWorkset(input: PlanWorksetInput): WorksetPlan {
	const selection = { profiles: input.selection?.profiles ?? [], projects: input.selection?.projects ?? [], exclude: input.selection?.exclude ?? [] };
	const projectCatalog = new Map(input.inventory.resources.projects.map((project) => [project.slug, project]));
	const profileProjects = resolveProfileProjects(input.profiles ?? [], selection.profiles);
	const requested = new Set(selection.projects.length || profileProjects.length ? [...profileProjects, ...selection.projects] : [...projectCatalog.keys()]);
	selection.exclude.forEach((slug) => requested.delete(slug));
	requested.delete('platform');
	const repositories = new Map(input.inventory.resources.repositories.map((repository) => [repository.key, repository]));
	const entries = [...requested].sort().map((slug) => {
		const project = projectCatalog.get(slug);
		if (!project) throw new Error(`Unknown project ${slug}.`);
		const repository = repositories.get(project.primaryRepository);
		if (!repository || repository.role !== 'primary') throw new Error(`Project ${slug} has no primary source repository.`);
		const branch = repository.repositoryPolicy?.stagingBranch ?? repository.defaultBranch;
		const remote = input.remote ?? systemRemote;
		const commit = remote.observe(repository.gitUrl, branch);
		return inspectCheckout({ project: slug, repository: repository.key, gitUrl: repository.gitUrl, branch, commit, path: safePath(input.root, slug) }, input.git ?? systemGit, remote);
	});
	return { schemaVersion: 'treeseed.platform-workset-plan/v1', root: resolve(input.root), inventoryPath: input.inventoryPath, inventoryDigest: input.inventoryDigest, selection, entries, ok: entries.every((entry) => entry.action !== 'blocked') };
}

export function applyPlatformWorkset(plan: WorksetPlan, git: GitRunner = systemGit, remote: RemoteObserver = systemRemote): WorksetReceipt {
	if (!plan.ok || plan.entries.some((entry) => entry.action === 'blocked')) throw new Error('Blocked workset plans cannot be applied.');
	for (const entry of plan.entries) {
		if (remote.observe(entry.gitUrl, entry.branch) !== entry.commit) throw new Error(`Remote branch moved after planning for ${entry.project}; create a new plan.`);
	}
	for (const entry of plan.entries) {
		if (entry.action === 'clone') {
			mkdirSync(dirname(entry.path), { recursive: true });
			git.run(plan.root, ['clone', '--branch', entry.branch, '--single-branch', entry.gitUrl, entry.path]);
		} else if (entry.action === 'fast-forward') {
			git.run(entry.path, ['fetch', 'origin', entry.branch]);
			git.run(entry.path, ['merge', '--ff-only', entry.commit]);
		}
		const actual = git.run(entry.path, ['rev-parse', 'HEAD']);
		if (actual !== entry.commit) throw new Error(`Checkout ${entry.project} did not converge to ${entry.commit}.`);
	}
	const receipt = worksetReceiptSchema.parse({ schemaVersion: 'treeseed.platform-workset-receipt/v1', planDigest: digest(plan), inventoryDigest: plan.inventoryDigest, entries: plan.entries.map(({ blockers: _blockers, ...entry }) => ({ ...entry, action: entry.action === 'blocked' ? 'noop' : entry.action })) });
	const receiptPath = resolve(plan.root, '.treeseed', 'worksets', `${receipt.planDigest.slice('sha256:'.length)}.json`);
	mkdirSync(dirname(receiptPath), { recursive: true });
	writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
	return receipt;
}

export function readWorksetReceipt(path: string): WorksetReceipt {
	return worksetReceiptSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}
