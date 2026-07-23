import { resolveTreeseedLaunchEnvironment } from "../../operations/services/config-runtime.ts";
import { deleteRemoteBranchIfMerged, inspectMergedRemoteTaskBranches, PRODUCTION_BRANCH, STAGING_BRANCH } from "../../operations/services/git-workflow.ts";
import { currentBranch, repoRoot } from "../../operations/services/workspace-save.ts";
import { resolveTreeseedWorkflowPaths } from ".././policy.ts";
import type { TreeseedCiInput, TreeseedTasksInput } from "../../workflow.ts";
import { TreeseedWorkflowError, WorkflowOperationHelpers } from './workflow-write.ts';
import { withContextEnv, workflowError } from './run-release-production-guarantees.ts';
import { createCiResult, createTasksResult } from './release-admin-message.ts';
import { checkedOutStagePromotionRepos } from './staging-candidate-workflow-gates.ts';
import { buildWorkflowResult } from './create-repo-report.ts';

export async function workflowCi(helpers: WorkflowOperationHelpers, input: TreeseedCiInput = {}) {
	return withContextEnv(helpers.context.env, async () => {
		try {
			const resolved = resolveTreeseedWorkflowPaths(helpers.cwd());
			const branch = currentBranch(repoRoot(resolved.cwd)) || null;
			const scope = branch === PRODUCTION_BRANCH ? 'prod' : branch === STAGING_BRANCH ? 'staging' : 'local';
			const env = resolved.tenantRoot
				? resolveTreeseedLaunchEnvironment({
					tenantRoot: resolved.cwd, 					scope,
					baseEnv: { ...process.env, ...(helpers.context.env ?? {}) },
				})
				: { ...process.env, ...(helpers.context.env ?? {}) };
			return await withContextEnv(env, () => createCiResult(helpers.cwd(), input));
		} catch (error) {
			if (error instanceof TreeseedWorkflowError) {
				throw error;
			}
			const message = error instanceof Error ? error.message : String(error);
			if (/GH_TOKEN|GITHUB_TOKEN|GitHub authentication|authenticated|Bad credentials|Requires authentication/iu.test(message)) {
				workflowError('ci', 'github_auth_unavailable', message, { exitCode: 2 });
			}
			workflowError('ci', 'validation_failed', message, { exitCode: 2 });
		}
	});
}

export async function workflowTasks(helpers: WorkflowOperationHelpers, input: TreeseedTasksInput = {}) {
	return withContextEnv(helpers.context.env, () => {
		const cwd = helpers.cwd();
		if (!input.cleanupMerged) return createTasksResult(cwd);
		const live = input.cleanupMerged === 'live';
		const repos = [
			{ name: '@treeseed/market', dir: repoRoot(cwd) },
			...checkedOutStagePromotionRepos(cwd).map((repo) => ({ name: repo.name, dir: repo.dir })),
		];
		const branchCleanup = repos.map((repo) => {
			const branches = inspectMergedRemoteTaskBranches(repo.dir).map((branch) => {
				if (branch.current) {
					return { ...branch, status: 'preserved' as const, reason: 'branch is currently checked out' };
				}
				if (!branch.head || !branch.mergedInto) {
					return { ...branch, status: 'preserved' as const, reason: 'branch is not merged into staging or main' };
				}
				if (!live) {
					return { ...branch, status: 'planned' as const, reason: `exact head is merged into ${branch.mergedInto}` };
				}
				deleteRemoteBranchIfMerged(repo.dir, branch.branch, branch.mergedInto, branch.head, { fetch: false });
				return { ...branch, status: 'deleted' as const, reason: `exact head was merged into ${branch.mergedInto}` };
			});
			return { repository: repo.name, path: repo.dir, branches };
		});
		return buildWorkflowResult('tasks', cwd, { tasks: [], workstreams: [], branchCleanup }, {
			executionMode: live ? 'execute' : 'plan', 			includeFinalState: false, 			summary: live ? 'Merged remote task branches were cleaned safely.' : 'Merged remote task branch cleanup plan ready.',
		});
	});
}
