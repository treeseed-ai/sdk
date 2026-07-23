import { repoRoot } from "../../operations/services/workspace-save.ts";
import { runTreeseedGit, runTreeseedGitOk } from "../../operations/services/git-runner.ts";
import { type TreeseedWorkflowSession } from ".././session.ts";
import { TreeseedUpdateRepoResult, TreeseedUpdateStrategy, gitOutput, localRemoteRefExists, sourceBranchExists, updateChangedFiles, updateConflictedFiles, updateHead, updateStatusLines } from './workflow-switch.ts';
import { workflowError } from './run-release-production-guarantees.ts';
import { TreeseedWorkflowError } from './workflow-write.ts';

export function updateAheadBehind(repoDir: string, branch: string, sourceRef: string) {
	if (!localRemoteRefExists(repoDir, sourceRef.replace(/^origin\//u, ''))) {
		return { ahead: null, behind: null };
	}
	const output = gitOutput(['rev-list', '--left-right', '--count', `${branch}...${sourceRef}`], repoDir, true);
	const [aheadRaw, behindRaw] = output.split(/\s+/u);
	const ahead = Number.parseInt(aheadRaw ?? '', 10);
	const behind = Number.parseInt(behindRaw ?? '', 10);
	return {
		ahead: Number.isFinite(ahead) ? ahead : null,
		behind: Number.isFinite(behind) ? behind : null,
	};
}

export function updatePlanChangedFiles(repoDir: string, sourceRef: string) {
	if (!runTreeseedGitOk(['show-ref', '--verify', `refs/remotes/${sourceRef}`], { cwd: repoDir, mode: 'read' })) {
		return [];
	}
	const output = gitOutput(['diff', '--name-only', `HEAD...${sourceRef}`], repoDir, true);
	return output ? output.split(/\r?\n/u).filter(Boolean).slice(0, 50) : [];
}

export function planUpdateRepo(name: string, repoDir: string, branch: string, sourceBranch: string, strategy: TreeseedUpdateStrategy): TreeseedUpdateRepoResult {
	const sourceRef = `origin/${sourceBranch}`;
	const blockers: string[] = [];
	if (!sourceBranchExists(repoDir, sourceBranch)) {
		blockers.push(`origin/${sourceBranch} does not exist`);
	}
	const { ahead, behind } = blockers.length === 0 ? updateAheadBehind(repoDir, branch, sourceRef) : { ahead: null, behind: null };
	const status: TreeseedUpdateRepoResult['status'] = blockers.length > 0
		? 'blocked'
		: behind === 0
			? 'up-to-date'
			: strategy === 'ff-only' && ahead === 0
				? 'fast-forward'
				: 'merge-needed';
	return {
		name,
		path: repoDir,
		branch,
		sourceRef,
		action: blockers.length > 0 ? 'blocked' : 'planned',
		beforeHead: updateHead(repoDir),
		afterHead: null,
		pushed: false,
		changedFiles: updatePlanChangedFiles(repoDir, sourceRef),
		blockers,
		ahead,
		behind,
		status,
	};
}

export function ensureUpdateRepoReady(operation: 'update', repo: TreeseedWorkflowSession['rootRepo'] | TreeseedWorkflowSession['managedRepos'][number], expectedBranch?: string) {
	if (repo.detached || !repo.branchName) {
		workflowError(operation, 'validation_failed', `${repo.name} is detached; update requires attached branches.`, {
			details: { repo },
		});
	}
	if (expectedBranch && repo.branchName !== expectedBranch) {
		workflowError(operation, 'validation_failed', `${repo.name} is on ${repo.branchName}, expected ${expectedBranch}.`, {
			details: { repo, expectedBranch },
		});
	}
	if (repo.dirty) {
		workflowError(operation, 'validation_failed', `${repo.name} has local changes. Run \`npx trsd save --json "checkpoint before update"\` first.`, {
			details: { repo },
		});
	}
	if (!repo.hasOriginRemote) {
		workflowError(operation, 'validation_failed', `${repo.name} is missing an origin remote.`, {
			details: { repo },
		});
	}
}

export function formatUpdateConflict(repoName: string, repoDir: string, sourceBranch: string, targetBranch: string) {
	const files = updateConflictedFiles(repoDir);
	const status = updateStatusLines(repoDir);
	return {
		message: [
			`Treeseed update hit a merge conflict in ${repoName}.`,
			`Repository: ${repoDir}`,
			`Target branch: ${targetBranch}`,
			`Source branch: origin/${sourceBranch}`,
			files.length > 0 ? `Conflicted files:\n${files.map((file) => `- ${file}`).join('\n')}` : 'Conflicted files: inspect git status.',
			'Resolve the conflicts in that repository, then run `npx trsd save --json "resolve update conflict"` or abort manually and rerun `npx trsd update --from staging --json`.',
		].join('\n'),
		files,
		status,
	};
}

export function mergeUpdateRepo(input: {
	name: string;
	repoDir: string;
	branch: string;
	sourceBranch: string;
	strategy: TreeseedUpdateStrategy;
	push: boolean;
}) {
	const sourceRef = `origin/${input.sourceBranch}`;
	const beforeHead = updateHead(input.repoDir);
	runTreeseedGit(['fetch', 'origin'], { cwd: input.repoDir, mode: 'mutate' });
	if (!sourceBranchExists(input.repoDir, input.sourceBranch)) {
		return {
			name: input.name, 			path: input.repoDir, 			branch: input.branch, 			sourceRef, 			action: 'blocked' as const, 			beforeHead, 			afterHead: beforeHead, 			pushed: false,
			changedFiles: [],
			blockers: [`origin/${input.sourceBranch} does not exist`],
		};
	}
	const mergeArgs = input.strategy === 'ff-only'
		? ['merge', '--ff-only', sourceRef]
		: ['merge', '--no-edit', sourceRef];
	const merge = runTreeseedGit(mergeArgs, {
		cwd: input.repoDir,
		mode: 'mutate',
		allowFailure: true,
	});
	if (merge.status !== 0) {
		const conflict = formatUpdateConflict(input.name, input.repoDir, input.sourceBranch, input.branch);
		throw new TreeseedWorkflowError('update', 'merge_conflict', conflict.message, {
			details: {
				repo: input.name, 				path: input.repoDir, 				files: conflict.files, 				status: conflict.status, 				sourceBranch: input.sourceBranch, 				targetBranch: input.branch,
			},
			exitCode: 12,
		});
	}
	const afterHead = updateHead(input.repoDir);
	const changed = beforeHead !== afterHead;
	let pushed = false;
	if (changed && input.push) {
		runTreeseedGit(['push', 'origin', input.branch], { cwd: input.repoDir, mode: 'mutate' });
		pushed = true;
	}
	return {
		name: input.name,
		path: input.repoDir,
		branch: input.branch,
		sourceRef,
		action: changed ? (input.strategy === 'ff-only' ? 'fast-forwarded' as const : 'merged' as const) : 'up-to-date' as const,
		beforeHead,
		afterHead,
		pushed,
		changedFiles: [],
		blockers: [],
	};
}

export function commitRootUpdateIfNeeded(root: string, branch: string, push: boolean) {
	const changedFiles = updateChangedFiles(repoRoot(root));
	if (changedFiles.length === 0) {
		let pushed = false;
		if (push) {
			runTreeseedGit(['push', 'origin', branch], { cwd: repoRoot(root), mode: 'mutate' });
			pushed = true;
		}
		return {
			committed: false, 			pushed, 			commitSha: updateHead(repoRoot(root)), 			changedFiles,
		};
	}
	runTreeseedGit(['add', '-A'], { cwd: repoRoot(root), mode: 'mutate' });
	runTreeseedGit(['commit', '-m', `chore(workflow): update ${branch} from staging`], { cwd: repoRoot(root), mode: 'mutate' });
	const commitSha = updateHead(repoRoot(root));
	let pushed = false;
	if (push) {
		runTreeseedGit(['push', 'origin', branch], { cwd: repoRoot(root), mode: 'mutate' });
		pushed = true;
	}
	return {
		committed: true,
		pushed,
		commitSha,
		changedFiles,
	};
}
