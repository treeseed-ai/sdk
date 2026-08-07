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

function commitDescendsFrom(candidate: RepositorySaveNode, ancestor: string) {
	try {
		runGit(['merge-base', '--is-ancestor', ancestor, headCommit(candidate.path)], {
			cwd: candidate.path,
			capture: true,
		});
		return true;
	} catch {
		return false;
	}
}

export function recoverableAliasRepresentative(group: RepositorySaveNode[]) {
	const fingerprints = new Set(group.map((node) => repositoryWorktreeFingerprint(node.path)));
	if (fingerprints.size !== 1) return null;
	const heads = group.map((node) => headCommit(node.path));
	return group
		.filter((candidate) => heads.every((head) => commitDescendsFrom(candidate, head)))
		.sort((left, right) => left.relativePath.localeCompare(right.relativePath))[0] ?? null;
}
