import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { releaseAgentWorktree } from '../operations/agent-worktree-release.ts';

const execFileAsync = promisify(execFile);

function registeredWorktrees(porcelain: string) {
	return porcelain.split(/\r?\n/gu)
		.filter((line) => line.startsWith('worktree '))
		.map((line) => resolve(line.slice('worktree '.length).trim()));
}

function descendsFrom(root: string, candidate: string) {
	const child = relative(root, candidate);
	return child !== '' && !child.startsWith('..') && !isAbsolute(child);
}

export async function cleanupLocalAcceptanceAgentWorktrees(workspaceRoot: string) {
	const removed: Array<{ repoRoot: string; worktreeRoot: string }> = [];
	const failures: string[] = [];
	for (const relativeRepo of ['starters/engineering', 'starters/research']) {
		const repoRoot = resolve(workspaceRoot, relativeRepo);
		const assignmentRoot = resolve(repoRoot, '.agent-worktrees');
		if (!existsSync(repoRoot)) continue;
		try {
			const listed = await execFileAsync('git', ['worktree', 'list', '--porcelain'], {
				cwd: repoRoot,
				env: process.env,
			});
			for (const worktreeRoot of registeredWorktrees(listed.stdout).filter((path) => descendsFrom(assignmentRoot, path))) {
				const result = await releaseAgentWorktree({ repoRoot, worktreeRoot });
				if (result.removed) removed.push({ repoRoot, worktreeRoot });
			}
		} catch (error) {
			failures.push(`${relativeRepo}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return { removed, failures };
}
