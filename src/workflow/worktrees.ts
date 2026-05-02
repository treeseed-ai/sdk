import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { workspaceRoot } from '../operations/services/workspace-tools.ts';
import { repoRoot } from '../operations/services/workspace-save.ts';
import type { TreeseedWorkflowWorktreeMode } from '../workflow.ts';

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

const WORKTREE_METADATA_PATH = '.treeseed/worktree.json';
const WORKTREE_ROOT = '.treeseed/worktrees';

function nowIso() {
	return new Date().toISOString();
}

function runGit(args: string[], { cwd, capture = true, allowFailure = false }: { cwd: string; capture?: boolean; allowFailure?: boolean }) {
	const result = spawnSync('git', args, {
		cwd,
		stdio: capture ? 'pipe' : 'inherit',
		encoding: 'utf8',
	});
	if (result.status !== 0 && !allowFailure) {
		throw new Error(result.stderr?.trim() || result.stdout?.trim() || `git ${args.join(' ')} failed`);
	}
	return result;
}

function slugifyBranch(branchName: string) {
	return branchName
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 64) || 'branch';
}

function worktreeDirectoryName(branchName: string) {
	const hash = createHash('sha256').update(branchName).digest('hex').slice(0, 10);
	return `${slugifyBranch(branchName)}-${hash}`;
}

function parseWorktreeList(output: string) {
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

function worktreeList(repoDir: string) {
	return parseWorktreeList(runGit(['worktree', 'list', '--porcelain'], { cwd: repoDir }).stdout ?? '');
}

function metadataPath(root: string) {
	return resolve(root, WORKTREE_METADATA_PATH);
}

function readMetadata(root: string): ManagedWorkflowWorktreeMetadata | null {
	const filePath = metadataPath(root);
	if (!existsSync(filePath)) return null;
	try {
		const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as ManagedWorkflowWorktreeMetadata;
		return parsed?.kind === 'treeseed.workflow.worktree' ? parsed : null;
	} catch {
		return null;
	}
}

function writeMetadata(root: string, metadata: ManagedWorkflowWorktreeMetadata) {
	const filePath = metadataPath(root);
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
}

function ensureManagedWorktreeExclude(root: string) {
	const commonGitDir = runGit(['rev-parse', '--git-common-dir'], { cwd: root }).stdout?.trim();
	if (!commonGitDir) return;
	const absolutePath = resolve(root, commonGitDir, 'info', 'exclude');
	const current = existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : '';
	const patterns = ['/.treeseed/worktree.json', '/.treeseed/workflow/', '/.treeseed/worktrees/'];
	const missing = patterns.filter((pattern) => !current.includes(pattern));
	if (missing.length === 0) return;
	mkdirSync(dirname(absolutePath), { recursive: true });
	writeFileSync(
		absolutePath,
		`${current}${current.endsWith('\n') || current.length === 0 ? '' : '\n'}${missing.join('\n')}\n`,
		'utf8',
	);
}

export function effectiveWorkflowWorktreeMode(
	mode: TreeseedWorkflowWorktreeMode | undefined,
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
	mode?: TreeseedWorkflowWorktreeMode;
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
	if (created) {
		mkdirSync(dirname(worktreePath), { recursive: true });
		runGit(['fetch', 'origin'], { cwd: primaryGitRoot });
		const branchExists = runGit(['ls-remote', '--heads', 'origin', branchName], { cwd: primaryGitRoot, allowFailure: true }).stdout?.trim();
		const baseRef = branchExists ? `origin/${branchName}` : 'origin/staging';
		runGit(['worktree', 'add', '--detach', worktreePath, baseRef], { cwd: primaryGitRoot });
	} else if (!existingEntry) {
		runGit(['worktree', 'prune'], { cwd: primaryGitRoot, allowFailure: true });
	}

	runGit(['submodule', 'update', '--init', '--recursive'], { cwd: worktreePath });
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

export function removeManagedWorkflowWorktree(root: string) {
	const metadata = readMetadata(root);
	if (!metadata) {
		return { removed: false, reason: 'not-managed' };
	}
	const primaryRoot = metadata.primaryRoot;
	const primaryGitRoot = repoRoot(primaryRoot);
	process.chdir(primaryRoot);
	runGit(['worktree', 'remove', '--force', metadata.worktreePath], { cwd: primaryGitRoot });
	rmSync(metadata.worktreePath, { recursive: true, force: true });
	return {
		removed: true,
		worktreePath: metadata.worktreePath,
		primaryRoot,
		branch: metadata.branch,
	};
}
