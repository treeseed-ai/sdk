import { createHash } from 'node:crypto';
import { existsSync,lstatSync,readFileSync,readlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { headCommit } from '../../operations/git-workflow.ts';
import { RepositorySaveNode,runGit } from '../support/repo-kind.ts';

function worktreePaths(repoDir: string) {
	return [...new Set(runGit(['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
		cwd: repoDir,
		capture: true,
	}).split('\0').filter(Boolean))].sort();
}

export function repositoryWorktreeFingerprint(repoDir: string) {
	const digest = createHash('sha256');
	for (const path of worktreePaths(repoDir)) {
		const absolutePath = resolve(repoDir, path);
		if (!existsSync(absolutePath)) continue;
		const stat = lstatSync(absolutePath);
		let mode: string;
		let content: Buffer;
		if (stat.isSymbolicLink()) {
			mode = '120000';
			content = Buffer.from(readlinkSync(absolutePath));
		} else if (stat.isDirectory()) {
			mode = '160000';
			content = Buffer.from(headCommit(absolutePath));
		} else {
			mode = stat.mode & 0o111 ? '100755' : '100644';
			content = readFileSync(absolutePath);
		}
		digest.update(`${path.length}:${path}:${mode}:${content.length}:`);
		digest.update(content);
	}
	return digest.digest('hex');
}

function commitDescendsFrom(candidate: RepositorySaveNode, ancestor: string, descendant = headCommit(candidate.path)) {
	try {
		runGit(['merge-base', '--is-ancestor', ancestor, descendant], {
			cwd: candidate.path,
			capture: true,
		});
		return true;
	} catch {
		return false;
	}
}

function worktreeIsClean(repoDir: string) {
	return runGit(['status', '--porcelain', '--untracked-files=all'], {
		cwd: repoDir,
		capture: true,
	}).trim().length === 0;
}

export function recoverableAliasRepresentative(group: RepositorySaveNode[]) {
	const fingerprints = new Set(group.map((node) => repositoryWorktreeFingerprint(node.path)));
	if (fingerprints.size !== 1 && group.some((node) => !worktreeIsClean(node.path))) return null;
	const heads = group.map((node) => headCommit(node.path));
	return group
		.filter((candidate) => heads.every((head) => commitDescendsFrom(candidate, head)))
		.sort((left, right) => left.relativePath.localeCompare(right.relativePath))[0] ?? null;
}

export function synchronizeRepositoryAliases(root: string, node: RepositorySaveNode, branch: string) {
	if (node.checkoutAliases.length < 2) return [];
	const targetCommit = headCommit(node.path);
	const targetFingerprint = repositoryWorktreeFingerprint(node.path);
	const synchronized: string[] = [];
	for (const relativePath of node.checkoutAliases) {
		const aliasPath = resolve(root, relativePath);
		if (aliasPath === node.path) continue;
		const aliasBranch = runGit(['symbolic-ref', '--short', 'HEAD'], { cwd: aliasPath,capture: true }).trim();
		if (aliasBranch !== branch) throw new Error(`Repository alias ${relativePath} is on ${aliasBranch}, expected ${branch}.`);
		const aliasAlreadyMatchesTarget = repositoryWorktreeFingerprint(aliasPath) === targetFingerprint;
		if (!aliasAlreadyMatchesTarget && !worktreeIsClean(aliasPath)) {
			throw new Error(`Repository alias ${relativePath} has local changes and cannot be synchronized.`);
		}
		runGit(['fetch', 'origin', `refs/heads/${branch}:refs/remotes/origin/${branch}`], { cwd: aliasPath });
		const remoteHead = runGit(['rev-parse', `refs/remotes/origin/${branch}`], { cwd: aliasPath,capture: true }).trim();
		if (remoteHead !== targetCommit) throw new Error(`Repository alias ${relativePath} observed ${remoteHead}, expected ${targetCommit}.`);
		const previousCommit = headCommit(aliasPath);
		if (!commitDescendsFrom({ ...node,path: aliasPath }, previousCommit, targetCommit)) {
			throw new Error(`Repository alias ${relativePath} cannot fast-forward from ${previousCommit} to ${targetCommit}.`);
		}
		const branchRef = `refs/heads/${branch}`;
		runGit(['update-ref', branchRef, targetCommit, previousCommit], { cwd: aliasPath });
		try {
			runGit(['read-tree', '--reset', '-u', targetCommit], { cwd: aliasPath });
		} catch (error) {
			runGit(['update-ref', branchRef, previousCommit, targetCommit], { cwd: aliasPath });
			runGit(['read-tree', '--reset', '-u', previousCommit], { cwd: aliasPath });
			throw error;
		}
		if (headCommit(aliasPath) !== targetCommit || repositoryWorktreeFingerprint(aliasPath) !== targetFingerprint) {
			throw new Error(`Repository alias ${relativePath} failed exact post-update verification.`);
		}
		synchronized.push(relativePath);
	}
	return synchronized;
}
