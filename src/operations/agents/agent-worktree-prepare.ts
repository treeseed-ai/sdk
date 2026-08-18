import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const execFileAsync = promisify(execFile);

export interface PrepareAgentWorktreeInput {
	repoRoot: string;
	worktreeRoot: string;
	branchName: string;
	baseRef: string;
	exists: boolean;
}

export interface PrepareAgentWorktreeExecutor {
	exec(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }): Promise<{ stdout: string; stderr?: string }>;
}

export async function prepareAgentWorktree(
	input: PrepareAgentWorktreeInput,
	executor: PrepareAgentWorktreeExecutor = { exec: execFileAsync },
) {
	const exactBaseRef = (await executor.exec('git', ['rev-parse', '--verify', `${input.baseRef}^{commit}`], {
		cwd: input.repoRoot, env: process.env,
	})).stdout.trim();
	if (!exactBaseRef) throw new Error(`Unable to resolve assignment base ref ${input.baseRef}.`);
	if (input.exists) {
		await executor.exec('git', ['switch', input.branchName], { cwd: input.worktreeRoot, env: process.env });
		try {
			await executor.exec('git', ['merge-base', '--is-ancestor', exactBaseRef, 'HEAD'], { cwd: input.worktreeRoot, env: process.env });
		} catch {
			throw new Error(`Existing assignment worktree ${input.worktreeRoot} does not descend from governed base ref ${exactBaseRef}.`);
		}
		return { branchName: input.branchName, worktreeRoot: input.worktreeRoot, exactBaseRef, created: false };
	}
	await executor.exec('git', ['worktree', 'add', '-B', input.branchName, input.worktreeRoot, exactBaseRef], {
		cwd: input.repoRoot, env: process.env,
	});
	return { branchName: input.branchName, worktreeRoot: input.worktreeRoot, exactBaseRef, created: true };
}
