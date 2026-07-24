import { spawn, spawnSync } from 'node:child_process';
import { applyEnvironmentToProcess, assertCommandEnvironment, resolveLaunchEnvironment } from "../../../operations/services/configuration/config-runtime.ts";
import { PRODUCTION_BRANCH, STAGING_BRANCH } from "../../../operations/services/operations/git-workflow.ts";
import { packageScriptPath } from "../../../operations/services/agents/runtime-tools.ts";
import { workspaceRoot } from "../../../operations/services/treedx/workspaces/workspace-tools.ts";
import { resolveWorkflowSession } from "../../session.ts";
import type { UpdateInput, WorkflowDevInput } from "../../../operations/workflow.ts";
import { WorkflowOperationHelpers, ensureWorkflowWorkspaceLinks } from '../recovery/workflow-write.ts';
import { resolveProjectRootOrThrow, withContextEnv, workflowError } from '../commerce/catalog/run-release-production-guarantees.ts';
import { UpdateConflict, UpdateRepoResult, normalizeUpdateSource, normalizeUpdateStrategy } from './workflow-switch.ts';
import { buildWorkflowResult, ensureLocalReadinessOrThrow, normalizeExecutionMode } from '../support/create-repo-report.ts';
import { commitRootUpdateIfNeeded, ensureUpdateRepoReady, mergeUpdateRepo, planUpdateRepo } from '../support/update-ahead-behind.ts';
import { worktreePayload } from '../packages/normalize-release-candidate-mode.ts';
import { createNextSteps } from '../packages/release-admin-message.ts';
import { acquireWorkflowRun, completeWorkflowRun, executeJournalStep } from '../packages/prepare-fresh-release-run.ts';
import { failWorkflowRun } from '../recovery/fail-workflow-run.ts';
import { toError } from '../projects/projects-core/connect-market-project.ts';

export async function workflowUpdate(helpers: WorkflowOperationHelpers, input: UpdateInput = {}) {
	try {
		return await withContextEnv(helpers.context.env, async () => {
			const tenantRoot = resolveProjectRootOrThrow('update', helpers.cwd());
			const root = workspaceRoot(tenantRoot);
			const session = resolveWorkflowSession(root);
			const sourceBranch = normalizeUpdateSource(input.from);
			const strategy = normalizeUpdateStrategy(input.strategy);
			const push = input.push !== false;
			const executionMode = normalizeExecutionMode(input);
			const branch = session.branchName;
			if (!branch) {
				workflowError('update', 'validation_failed', 'Treeseed update requires an attached current branch.');
			}
			if (branch === STAGING_BRANCH || branch === PRODUCTION_BRANCH) {
				workflowError('update', 'validation_failed', `Treeseed update must run from a task branch, not ${branch}.`, {
					details: { branch },
				});
			}
			if (sourceBranch === branch) {
				workflowError('update', 'validation_failed', 'Treeseed update source branch cannot match the current branch.', {
					details: { branch, sourceBranch },
				});
			}
			ensureUpdateRepoReady('update', session.rootRepo);
			for (const repo of session.managedRepos) {
				ensureUpdateRepoReady('update', repo, branch);
			}

			const repoPlans = session.managedRepos.map((repo) =>
				planUpdateRepo(repo.name, repo.path, branch, sourceBranch, strategy));
			const rootPlan = planUpdateRepo('@treeseed/market', session.gitRoot, branch, sourceBranch, strategy);
			const blockers = [...repoPlans, rootPlan].flatMap((repo) => repo.blockers.map((blocker) => `${repo.name}: ${blocker}`));

			if (executionMode === 'plan') {
				return buildWorkflowResult('update', root, {
					mode: session.mode, 					branch, 					sourceBranch,
					sourceRef: `origin/${sourceBranch}`,
					strategy, 					pushed: false, 					plan: true, 					repos: repoPlans, 					rootRepo: rootPlan,
					conflicts: [],
					blockers, 					...worktreePayload(root, input.worktreeMode),
				}, {
					executionMode, 					includeFinalState: false,
					nextSteps: createNextSteps([
						{ operation: 'update', reason: 'Run without --plan to merge staging into the current branch.', input: { from: sourceBranch } },
					]),
				});
			}

			if (blockers.length > 0) {
				workflowError('update', 'validation_failed', `Treeseed update is blocked:\n${blockers.join('\n')}`, {
					details: { blockers, repos: repoPlans, rootRepo: rootPlan },
				});
			}

			const workflowRun = acquireWorkflowRun(
				'update', 				session,
				{ from: sourceBranch, strategy, push, workspaceLinks: input.workspaceLinks ?? 'auto' },
				[
					{ id: 'validate-update', description: `Validate update from ${sourceBranch}`, repoName: session.rootRepo.name, repoPath: session.rootRepo.path, branch, resumable: true },
					...session.managedRepos.map((repo) => ({
						id: `update-${repo.name}`,
						description: `Merge origin/${sourceBranch} into ${repo.name}`,
						repoName: repo.name, 						repoPath: repo.path, 						branch, 						resumable: true,
					})),
					{ id: 'update-root', description: `Merge origin/${sourceBranch} into market`, repoName: session.rootRepo.name, repoPath: session.rootRepo.path, branch, resumable: true },
					{ id: 'refresh-root-pointers', description: 'Commit updated root pointers if package heads changed', repoName: session.rootRepo.name, repoPath: session.rootRepo.path, branch, resumable: true },
					{ id: 'restore-workspace-links', description: 'Restore local workspace links', repoName: session.rootRepo.name, repoPath: session.rootRepo.path, branch, resumable: true },
				],
				helpers.context,
			);

			try {
				await executeJournalStep(root, workflowRun.runId, 'validate-update', () => ({
					branch, 					sourceBranch, 					strategy, 					push,
				}));
				const repos: UpdateRepoResult[] = [];
				for (const repo of session.managedRepos) {
					const result = await executeJournalStep(root, workflowRun.runId, `update-${repo.name}`, () =>
						mergeUpdateRepo({
							name: repo.name, 							repoDir: repo.path, 							branch, 							sourceBranch, 							strategy, 							push,
						}));
					if (result) repos.push(result);
				}
				const rootMerge = await executeJournalStep(root, workflowRun.runId, 'update-root', () =>
					mergeUpdateRepo({
						name: '@treeseed/market', 						repoDir: session.gitRoot, 						branch, 						sourceBranch, 						strategy, 						push: false,
					}));
				const rootCommit = await executeJournalStep(root, workflowRun.runId, 'refresh-root-pointers', () =>
					commitRootUpdateIfNeeded(root, branch, push));
				const workspaceLinks = await executeJournalStep(root, workflowRun.runId, 'restore-workspace-links', () =>
					ensureWorkflowWorkspaceLinks(root, helpers, input.workspaceLinks ?? 'auto'));

				const rootRepo = {
					...rootMerge!, 					action: rootCommit?.committed ? 'committed' as const : rootMerge!.action, 					commitSha: rootCommit?.commitSha ?? rootMerge!.afterHead, 					pushed: rootCommit?.pushed ?? false, 					changedFiles: rootCommit?.changedFiles ?? rootMerge!.changedFiles,
				};
				const payload = {
					mode: session.mode, 					branch, 					sourceBranch,
					sourceRef: `origin/${sourceBranch}`,
					strategy, 					pushed: push, 					plan: false, 					repos, 					rootRepo,
					conflicts: [] as UpdateConflict[],
					workspaceLinks, 					...worktreePayload(root, input.worktreeMode),
				};
				completeWorkflowRun(root, workflowRun.runId, payload);
				return buildWorkflowResult('update', root, payload, {
					runId: workflowRun.runId,
					summary: `Treeseed update merged ${sourceBranch} into ${branch}.`,
					includeFinalState: false,
					nextSteps: createNextSteps([
						{ operation: 'save', reason: 'Checkpoint any follow-up conflict resolutions or generated pointer changes.', input: { message: 'sync with staging' } },
						{ operation: 'stage', reason: 'Merge the updated task branch into staging when it is ready.', input: { message: 'describe the resolution' } },
					]),
				});
			} catch (error) {
				failWorkflowRun(root, workflowRun.runId, error, {
					resumable: true, 					runId: workflowRun.runId, 					command: 'update',
					message: `Resume the interrupted update for ${branch}.`,
					recoverCommand: 'treeseed recover',
					resumeCommand: `treeseed resume ${workflowRun.runId}`,
				});
				throw error;
			}
		});
	} catch (error) {
		toError('update', error);
	}
}

export async function workflowDev(helpers: WorkflowOperationHelpers, input: WorkflowDevInput = {}) {
	try {
		return withContextEnv(helpers.context.env, async () => {
			if (helpers.context.transport === 'api') {
				workflowError('dev', 'unsupported_transport', 'Treeseed dev is not supported over the HTTP workflow API.');
			}
			const tenantRoot = resolveProjectRootOrThrow('dev', helpers.cwd());
			const readiness = ensureLocalReadinessOrThrow('dev', tenantRoot);
			const args = [packageScriptPath('runtime/tenant-dev')];
			if (input.watch) {
				args.push('--watch');
			}
			if (input.port !== undefined) {
				args.push('--port', String(input.port));
			}
			const runtime = {
				mode: process.env.LOCAL_DEV_MODE ?? 'cloudflare', 				apiBaseUrl: process.env.TREESEED_API_BASE_URL ?? 'http://127.0.0.1:3000', 				webUrl: 'http://127.0.0.1:8787',
			};
			if (input.plan) {
				return buildWorkflowResult('dev', tenantRoot, {
					plan: true, 					watch: input.watch === true, 					background: input.background === true, 					command: process.execPath, 					args, 					cwd: tenantRoot, 					pid: null, 					exitCode: null, 					runtime, 					readiness: readiness.readiness.local,
					workspaceLinks: {
						mode: input.workspaceLinks ?? 'auto', 						action: 'planned',
					},
				});
			}
			const workspaceLinks = ensureWorkflowWorkspaceLinks(workspaceRoot(tenantRoot), helpers, input.workspaceLinks ?? 'auto');
			applyEnvironmentToProcess({ tenantRoot, scope: 'local', override: true });
			assertCommandEnvironment({ tenantRoot, scope: 'local', purpose: 'dev' });
			const env = resolveLaunchEnvironment({
				tenantRoot, 				scope: 'local',
				baseEnv: { ...process.env, ...(helpers.context.env ?? {}) },
			});
			if (input.background) {
				const child = spawn(process.execPath, args, {
					cwd: tenantRoot, 					env, 					stdio: input.stdio ?? 'inherit', 					detached: process.platform !== 'win32',
				});
				return buildWorkflowResult('dev', tenantRoot, {
					watch: input.watch === true, 					background: true, 					command: process.execPath, 					args, 					cwd: tenantRoot, 					pid: child.pid ?? null, 					exitCode: null, 					runtime, 					readiness: readiness.readiness.local, 					workspaceLinks,
				});
			}

			const result = spawnSync(process.execPath, args, {
				cwd: tenantRoot, 				env, 				stdio: input.stdio ?? 'inherit',
			});
			return buildWorkflowResult('dev', tenantRoot, {
				watch: input.watch === true, 				background: false, 				command: process.execPath, 				args, 				cwd: tenantRoot, 				pid: null, 				exitCode: result.status ?? 1, 				runtime, 				readiness: readiness.readiness.local, 				workspaceLinks,
			});
		});
	} catch (error) {
		toError('dev', error);
	}
}
