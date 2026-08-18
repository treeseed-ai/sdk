import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

export const execFileAsync = promisify(execFile);

export interface ReleaseAgentWorktreeInput {
	repoRoot: string;
	worktreeRoot: string;
}

export interface ReleaseAgentWorktreeExecutor {
	exec(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }): Promise<{ stdout: string; stderr?: string }>;
}

export function registeredWorktrees(porcelain: string) {
	return porcelain.split(/\r?\n/gu)
		.filter((line) => line.startsWith('worktree '))
		.map((line) => resolve(line.slice('worktree '.length).trim()));
}

export async function releaseAgentWorktree(
	input: ReleaseAgentWorktreeInput,
	executor: ReleaseAgentWorktreeExecutor = { exec: execFileAsync },
) {
	const repoRoot = resolve(input.repoRoot);
	const worktreeRoot = resolve(input.worktreeRoot);
	if (worktreeRoot === repoRoot) throw new Error('Assignment worktree release cannot remove the repository root.');
	const listed = await executor.exec('git', ['worktree', 'list', '--porcelain'], { cwd: repoRoot, env: process.env });
	const registered = registeredWorktrees(listed.stdout);
	if (!registered.includes(worktreeRoot)) {
		return { repoRoot, worktreeRoot, removed: false, reason: 'not_registered' as const };
	}
	await executor.exec('git', ['worktree', 'remove', '--force', worktreeRoot], { cwd: repoRoot, env: process.env });
	await executor.exec('git', ['worktree', 'prune'], { cwd: repoRoot, env: process.env });
	return { repoRoot, worktreeRoot, removed: true, reason: 'terminal_assignment' as const };
}
