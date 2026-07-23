import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentOperationGrant, AgentOperationRequest, AgentOperationResult } from './agent-tools.ts';
import { decideAgentOperationPermission, deniedAgentOperationResult } from './agent-tools.ts';

export const execFileAsync = promisify(execFile);

export interface AgentWorktreeCheckpointInput {
	request: Omit<AgentOperationRequest, 'operation' | 'mode' | 'changedPaths'> & {
		worktreeRoot: string;
		message: string;
	};
	grant: AgentOperationGrant;
}

export interface AgentWorktreeCheckpointExecutor {
	exec(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }): Promise<{ stdout: string; stderr?: string }>;
}

export function normalizePath(value: string) {
	return value.replace(/\\/gu, '/').replace(/^\.?\//u, '').replace(/\/+/gu, '/');
}

export function statusPath(line: string) {
	const raw = line.slice(3).trim();
	return normalizePath((raw.includes(' -> ') ? raw.split(' -> ').pop() : raw) ?? '');
}

export function changedPaths(output: string) {
	return [...new Set(output.split('\n').filter(Boolean).map(statusPath).filter(Boolean))];
}

export function failed(request: AgentOperationRequest, code: string, message: string): AgentOperationResult {
	return {
		operation: 'save', status: 'failed', summary: message, changedPaths: request.changedPaths ?? [], stagedPaths: [],
		commandsRun: [], artifacts: [], error: { code, message, retryable: false }, metadata: {},
	};
}

export async function checkpointAgentWorktree(
	input: AgentWorktreeCheckpointInput,
	executor: AgentWorktreeCheckpointExecutor = { exec: execFileAsync },
): Promise<AgentOperationResult> {
	const worktreeRoot = input.request.worktreeRoot.trim();
	const message = input.request.message.trim();
	const baseRequest: AgentOperationRequest = {
		...input.request,
		operation: 'save',
		mode: 'mutating',
		changedPaths: [],
	};
	if (!worktreeRoot) return failed(baseRequest, 'operation_worktree_required', 'Assignment checkpoint requires a worktree root.');
	if (!message) return failed(baseRequest, 'operation_commit_message_required', 'Assignment checkpoint requires a commit message.');
	try {
		const status = await executor.exec('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: worktreeRoot, env: process.env });
		const paths = changedPaths(status.stdout);
		const request = { ...baseRequest, changedPaths: paths };
		const permission = decideAgentOperationPermission({ request, grants: [input.grant] });
		if (!permission.allowed) return deniedAgentOperationResult(request, permission);
		const branchName = (await executor.exec('git', ['branch', '--show-current'], { cwd: worktreeRoot, env: process.env })).stdout.trim();
		if (paths.length === 0) {
			const commitSha = (await executor.exec('git', ['rev-parse', 'HEAD'], { cwd: worktreeRoot, env: process.env })).stdout.trim();
			return {
				operation: 'save', status: 'completed', summary: 'Assignment worktree already has a durable checkpoint.',
				changedPaths: [], stagedPaths: [], commandsRun: ['git status', 'git rev-parse HEAD'],
				artifacts: commitSha ? [{ kind: 'source_commit', ref: commitSha }] : [],
				metadata: { commitSha, branchName, noChanges: true, permission },
			};
		}
		await executor.exec('git', ['add', '--', ...paths], { cwd: worktreeRoot, env: process.env });
		await executor.exec('git', ['commit', '-m', message], { cwd: worktreeRoot, env: process.env });
		const commitSha = (await executor.exec('git', ['rev-parse', 'HEAD'], { cwd: worktreeRoot, env: process.env })).stdout.trim();
		return {
			operation: 'save', status: 'completed', summary: 'Created an assignment-scoped source checkpoint without publishing it.',
			changedPaths: paths, stagedPaths: paths, commandsRun: ['git status', 'git add', 'git commit', 'git rev-parse HEAD'],
			artifacts: commitSha ? [{ kind: 'source_commit', ref: commitSha }] : [],
			metadata: { commitSha, branchName, noChanges: false, permission },
		};
	} catch (error) {
		return failed(baseRequest, 'operation_checkpoint_failed', error instanceof Error ? error.message : String(error));
	}
}
