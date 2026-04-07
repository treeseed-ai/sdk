import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface GitMutationResult {
	branchName: string;
	commitMessage: string;
	worktreePath: string;
	commitSha: string | null;
	changedPaths: string[];
}

export class GitRuntime {
	constructor(
		private readonly repoRoot: string,
		private readonly disabled = false,
	) {}

	async currentBranch() {
		const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
			cwd: this.repoRoot,
		});
		return stdout.trim();
	}

	async ensureWorktree(branchName: string) {
		const worktreePath = path.join(this.repoRoot, '.agent-worktrees', branchName);
		if (this.disabled) {
			return worktreePath;
		}

		try {
			await execFileAsync('git', ['worktree', 'list', '--porcelain'], {
				cwd: this.repoRoot,
			}).then(async ({ stdout }) => {
				if (stdout.includes(`worktree ${worktreePath}`)) {
					await execFileAsync('git', ['switch', branchName], { cwd: worktreePath });
					return;
				}
				await execFileAsync('git', ['worktree', 'add', '-B', branchName, worktreePath, 'HEAD'], {
					cwd: this.repoRoot,
				});
			});
		} catch {
			await execFileAsync('git', ['worktree', 'add', '-B', branchName, worktreePath, 'HEAD'], {
				cwd: this.repoRoot,
			});
		}
		return worktreePath;
	}

	async commitFileChange(filePath: string, branchName: string, commitMessage: string): Promise<GitMutationResult> {
		return this.commitFileChanges([filePath], branchName, commitMessage);
	}

	async commitFileChanges(filePaths: string[], branchName: string, commitMessage: string): Promise<GitMutationResult> {
		const worktreePath = await this.ensureWorktree(branchName);
		if (this.disabled) {
			return { branchName, commitMessage, worktreePath, commitSha: null, changedPaths: filePaths };
		}

		const relativeFilePaths = filePaths.map((filePath) => path.relative(worktreePath, filePath));
		await execFileAsync('git', ['add', ...relativeFilePaths], { cwd: worktreePath });
		try {
			await execFileAsync('git', ['commit', '-m', commitMessage], { cwd: worktreePath });
		} catch (error) {
			const message =
				error && typeof error === 'object' && 'stderr' in error
					? String((error as { stderr?: string }).stderr ?? '')
					: '';
			if (!message.includes('nothing to commit')) {
				throw error;
			}
		}
		const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: worktreePath });
		const commitSha = stdout.trim();

		return { branchName, commitMessage, worktreePath, commitSha, changedPaths: filePaths };
	}
}
