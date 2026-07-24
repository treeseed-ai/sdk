import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { runRepositoryGit } from '../operations/services/operations/git-runner.ts';
import { sortWorkspacePackages, workspacePackages, workspaceRoot } from '../operations/services/treedx/workspaces/workspace-tools.ts';
import { repoRoot } from '../operations/services/treedx/workspaces/workspace-save.ts';
import { discoverPackageAdapters } from '../operations/services/reconciliation/package-adapters.ts';
import type { WorkflowWorktreeMode } from '../operations/workflow.ts';

export type ManagedWorkflowWorktreeMetadata = {
	schemaVersion: 1;
	kind: 'treeseed.workflow.worktree';
	branch: string;
	worktreePath: string;
	primaryRoot: string;
	ownerMode: 'agent' | 'human' | 'explicit';
	createdAt: string;
	lastUsedAt: string;
};

export type ManagedWorkflowWorktreeResult = ManagedWorkflowWorktreeMetadata & {
	created: boolean;
	resumed: boolean;
};

export const WORKTREE_METADATA_PATH = '.treeseed/worktree.json';
export const WORKTREE_ROOT = '.treeseed/worktrees';
export const MACHINE_CONFIG_PATH = '.treeseed/config/machine.yaml';

export function nowIso() {
	return new Date().toISOString();
}

export function runGit(args: string[], { cwd, capture = true, allowFailure = false }: { cwd: string; capture?: boolean; allowFailure?: boolean }) {
	const mutating = /^(add|commit|checkout|switch|merge|tag|push|fetch|worktree|submodule|reset|clean|restore|branch)$/u.test(args[0] ?? '');
	const result = runRepositoryGit(args, {
		cwd,
		mode: mutating ? 'mutate' : 'read',
		allowFailure,
	});
	if (!capture && result.stdout.trim()) process.stdout.write(result.stdout);
	if (!capture && result.stderr.trim()) process.stderr.write(result.stderr);
	return result;
}

export function slugifyBranch(branchName: string) {
	return branchName
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 64) || 'branch';
}

export function worktreeDirectoryName(branchName: string) {
	const hash = createHash('sha256').update(branchName).digest('hex').slice(0, 10);
	return `${slugifyBranch(branchName)}-${hash}`;
}

export function parseWorktreeList(output: string) {
	const entries: Array<{ worktree: string; branch: string | null }> = [];
	let current: { worktree: string; branch: string | null } | null = null;
	for (const line of output.split(/\r?\n/u)) {
		if (line.startsWith('worktree ')) {
			if (current) entries.push(current);
			current = { worktree: line.slice('worktree '.length).trim(), branch: null };
			continue;
		}
		if (current && line.startsWith('branch ')) {
			current.branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//u, '');
		}
	}
	if (current) entries.push(current);
	return entries;
}

export function worktreeList(repoDir: string) {
	return parseWorktreeList(runGit(['worktree', 'list', '--porcelain'], { cwd: repoDir }).stdout ?? '');
}

export function currentBranchName(repoDir: string) {
	return runGit(['branch', '--show-current'], { cwd: repoDir, allowFailure: true }).stdout?.trim() || null;
}

export function localBranchExists(repoDir: string, branchName: string) {
	return runGit(['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], { cwd: repoDir, allowFailure: true }).status === 0;
}

export function remoteBranchExists(repoDir: string, branchName: string) {
	return Boolean(runGit(['ls-remote', '--heads', 'origin', branchName], { cwd: repoDir, allowFailure: true }).stdout?.trim());
}

export function checkoutManagedPackageBranch(repoDir: string, branchName: string) {
	runGit(['fetch', 'origin'], { cwd: repoDir, allowFailure: true });
	const baseBranch = remoteBranchExists(repoDir, 'staging')
		? 'staging'
		: remoteBranchExists(repoDir, 'main')
			? 'main'
			: null;
	if (localBranchExists(repoDir, branchName)) {
		runGit(['checkout', branchName], { cwd: repoDir });
	} else if (remoteBranchExists(repoDir, branchName)) {
		runGit(['checkout', '-b', branchName, `origin/${branchName}`], { cwd: repoDir });
	} else if (baseBranch) {
		runGit(['checkout', '-b', branchName, `origin/${baseBranch}`], { cwd: repoDir });
	} else {
		return;
	}
	if (remoteBranchExists(repoDir, branchName)) {
		runGit(['merge', '--ff-only', `origin/${branchName}`], { cwd: repoDir, allowFailure: true });
	}
}

export function checkoutManagedPackageBranches(worktreePath: string, branchName: string) {
	const packages = new Map<string, ReturnType<typeof workspacePackages>[number]>();
	for (const pkg of workspacePackages(worktreePath)) {
		if (pkg.name?.startsWith('@treeseed/')) {
			packages.set(pkg.name, pkg);
		}
	}
	for (const adapter of discoverPackageAdapters(worktreePath)) {
		if (!adapter.publishTarget && adapter.artifacts.length === 0) continue;
		if (packages.has(adapter.id)) continue;
		packages.set(adapter.id, {
			dir: adapter.dir,
			name: adapter.id,
			packageJson: {},
			relativeDir: adapter.relativeDir,
		});
	}
	for (const pkg of sortWorkspacePackages([...packages.values()])) {
		if (!existsSync(resolve(pkg.dir, '.git'))) continue;
		checkoutManagedPackageBranch(pkg.dir, branchName);
	}
}

export function metadataPath(root: string) {
	return resolve(root, WORKTREE_METADATA_PATH);
}

export function readMetadata(root: string): ManagedWorkflowWorktreeMetadata | null {
	const filePath = metadataPath(root);
	if (!existsSync(filePath)) return null;
	try {
		const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as ManagedWorkflowWorktreeMetadata;
		return parsed?.kind === 'treeseed.workflow.worktree' ? parsed : null;
	} catch {
		return null;
	}
}

export function writeMetadata(root: string, metadata: ManagedWorkflowWorktreeMetadata) {
	const filePath = metadataPath(root);
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
}

export function ensureManagedWorktreeExclude(root: string) {
	const commonGitDir = runGit(['rev-parse', '--git-common-dir'], { cwd: root }).stdout?.trim();
	if (!commonGitDir) return;
	const absolutePath = resolve(root, commonGitDir, 'info', 'exclude');
	const current = existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : '';
	const patterns = ['/.treeseed/worktree.json', '/.treeseed/config/', '/.treeseed/workflow/', '/.treeseed/worktrees/'];
	const missing = patterns.filter((pattern) => !current.includes(pattern));
	if (missing.length === 0) return;
	mkdirSync(dirname(absolutePath), { recursive: true });
	writeFileSync(
		absolutePath,
		`${current}${current.endsWith('\n') || current.length === 0 ? '' : '\n'}${missing.join('\n')}\n`,
		'utf8',
	);
}

export function ensureManagedWorktreeMachineConfig(primaryRoot: string, worktreePath: string) {
	const sourcePath = resolve(primaryRoot, MACHINE_CONFIG_PATH);
	const targetPath = resolve(worktreePath, MACHINE_CONFIG_PATH);
	if (!existsSync(sourcePath) || existsSync(targetPath)) return;
	mkdirSync(dirname(targetPath), { recursive: true });
	copyFileSync(sourcePath, targetPath);
}

export function effectiveWorkflowWorktreeMode(
	mode: WorkflowWorktreeMode | undefined,
	env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
) {
	const envMode = String(env.TREESEED_WORKTREE_MODE ?? '').trim().toLowerCase();
	if (mode === 'on' || envMode === 'on' || envMode === 'true' || envMode === '1') return 'on';
	if (mode === 'off' || envMode === 'off' || envMode === 'false' || envMode === '0') return 'off';
	const agentMarkers = [
		env.TREESEED_WORKFLOW_ACTOR === 'agent',
		env.TREESEED_AGENT_ID,
		env.TREESEED_AGENT_RUN_ID,
		env.CODEX_AGENT_ID,
		env.CODEX_TASK_ID,
	].some(Boolean);
	return agentMarkers ? 'on' : 'off';
}

export function isManagedWorkflowWorktree(root: string) {
	return readMetadata(root) != null;
}

export function managedWorkflowWorktreeMetadata(root: string) {
	return readMetadata(root);
}

export function plannedManagedWorkflowWorktreePath(root: string, branchName: string) {
	const primaryRoot = primaryWorkspaceRoot(root);
	return resolve(primaryRoot, WORKTREE_ROOT, worktreeDirectoryName(branchName));
}

export function primaryWorkspaceRoot(root: string) {
	const gitRoot = repoRoot(workspaceRoot(root));
	const entries = worktreeList(gitRoot);
	const first = entries[0]?.worktree;
	return first ? workspaceRoot(first) : workspaceRoot(root);
}

export function ensureManagedWorkflowWorktree({
	root,
	branchName,
	mode = 'auto',
	env = process.env,
}: {
	root: string;
	branchName: string;
	mode?: WorkflowWorktreeMode;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}): ManagedWorkflowWorktreeResult {
	const effectiveMode = effectiveWorkflowWorktreeMode(mode, env);
	if (effectiveMode !== 'on') {
		throw new Error('Managed workflow worktree mode is disabled.');
	}

	const primaryRoot = primaryWorkspaceRoot(root);
	const primaryGitRoot = repoRoot(primaryRoot);
	const worktreePath = plannedManagedWorkflowWorktreePath(primaryRoot, branchName);
	const entries = worktreeList(primaryGitRoot);
	const existingEntry = entries.find((entry) => entry.worktree === worktreePath);
	const duplicate = entries.find((entry) => entry.branch === branchName && entry.worktree !== worktreePath);
	if (duplicate) {
		throw new Error(`Branch ${branchName} is already checked out in ${duplicate.worktree}.`);
	}

	const created = !existingEntry && !existsSync(worktreePath);
	runGit(['fetch', 'origin'], { cwd: primaryGitRoot });
	const branchExists = remoteBranchExists(primaryGitRoot, branchName);
	const baseRef = branchExists ? `origin/${branchName}` : 'origin/staging';
	if (created) {
		mkdirSync(dirname(worktreePath), { recursive: true });
		runGit(['worktree', 'add', '--detach', worktreePath, baseRef], { cwd: primaryGitRoot });
	} else if (!existingEntry) {
		runGit(['worktree', 'prune'], { cwd: primaryGitRoot, allowFailure: true });
		if (existsSync(worktreePath)) {
			throw new Error(`Managed worktree path ${worktreePath} exists but is not registered as a Git worktree.`);
		}
	} else if (!currentBranchName(worktreePath)) {
		runGit(['fetch', 'origin'], { cwd: worktreePath, allowFailure: true });
		runGit(['reset', '--hard', baseRef], { cwd: worktreePath });
	}

	runGit(['submodule', 'update', '--init', '--recursive'], { cwd: worktreePath });
	checkoutManagedPackageBranches(worktreePath, branchName);
	ensureManagedWorktreeMachineConfig(primaryRoot, worktreePath);
	ensureManagedWorktreeExclude(worktreePath);
	const timestamp = nowIso();
	const previous = readMetadata(worktreePath);
	const metadata: ManagedWorkflowWorktreeMetadata = {
		schemaVersion: 1,
		kind: 'treeseed.workflow.worktree',
		branch: branchName,
		worktreePath,
		primaryRoot,
		ownerMode: mode === 'on' ? 'explicit' : 'agent',
		createdAt: previous?.createdAt ?? timestamp,
		lastUsedAt: timestamp,
	};
	writeMetadata(worktreePath, metadata);
	return {
		...metadata,
		created,
		resumed: !created,
	};
}

export function removeManagedWorkflowWorktree(root: string, options: { deleteBranch?: boolean } = {}) {
	const metadata = readMetadata(root);
	if (!metadata) {
		return { removed: false, reason: 'not-managed' };
	}
	const primaryRoot = metadata.primaryRoot;
	const primaryGitRoot = repoRoot(primaryRoot);
	process.chdir(primaryRoot);
	const gitRemove = runGit(['worktree', 'remove', '--force', metadata.worktreePath], { cwd: primaryGitRoot, allowFailure: true });
	removeWorkflowWorktreeDirectory(metadata.worktreePath);
	if (gitRemove.status !== 0) {
		runGit(['worktree', 'prune'], { cwd: primaryGitRoot, allowFailure: true });
	}
	let deletedLocalBranch = false;
	if (options.deleteBranch === true && metadata.branch) {
		const deleted = runGit(['branch', '-D', metadata.branch], { cwd: primaryGitRoot, allowFailure: true });
		deletedLocalBranch = deleted.status === 0;
	}
	return {
		removed: true,
		worktreePath: metadata.worktreePath,
		primaryRoot,
		branch: metadata.branch,
		deletedLocalBranch,
	};
}

export function removeWorkflowWorktreeDirectory(worktreePath: string) {
	try {
		rmSync(worktreePath, { recursive: true, force: true });
		return;
	} catch (error) {
		const repair = repairDockerOwnedWorktreeArtifacts(worktreePath);
		if (!repair.repaired) {
			throw error;
		}
		try {
			rmSync(worktreePath, { recursive: true, force: true });
			return;
		} catch (retryError) {
			const detail = repair.stderr ? ` Docker ownership repair stderr: ${repair.stderr}` : '';
			const message = retryError instanceof Error ? retryError.message : String(retryError);
			throw new Error(`${message}.${detail}`);
		}
	}
}

export function repairDockerOwnedWorktreeArtifacts(worktreePath: string) {
	if (!existsSync(worktreePath) || typeof process.getuid !== 'function' || typeof process.getgid !== 'function') {
		return { repaired: false, stderr: '' };
	}
	const uid = String(process.getuid());
	const gid = String(process.getgid());
	const result = spawnSync('docker', [
		'run',
		'--rm',
		'-v',
		`${worktreePath}:/target`,
		'debian:bookworm-slim',
		'chown',
		'-R',
		`${uid}:${gid}`,
		'/target',
	], {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
		timeout: 300000,
	});
	return {
		repaired: result.status === 0,
		stderr: String(result.stderr ?? '').trim(),
	};
}
