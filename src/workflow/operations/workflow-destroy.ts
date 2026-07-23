import { resolve } from 'node:path';
import { applyTreeseedEnvironmentToProcess, assertTreeseedCommandEnvironment } from "../../operations/services/config-runtime.ts";
import { cleanupDestroyedState, createPersistentDeployTarget, destroyTreeseedEnvironmentResources, loadDeployState, validateDestroyPrerequisites } from "../../operations/services/deploy.ts";
import { workspaceRoot } from "../../operations/services/workspace-tools.ts";
import { resolveTreeseedWorkflowSession } from ".././session.ts";
import type { TreeseedDestroyInput } from "../../workflow.ts";
import { WorkflowOperationHelpers } from './workflow-write.ts';
import { resolveProjectRootOrThrow, withContextEnv, workflowError } from './run-release-production-guarantees.ts';
import { buildWorkflowResult, normalizeExecutionMode } from './create-repo-report.ts';
import { createNextSteps } from './release-admin-message.ts';
import { acquireWorkflowRun, completeWorkflowRun, executeJournalStep, skipJournalStep } from './prepare-fresh-release-run.ts';
import { resolveDestroyConfirmation } from './collect-published-release-artifact-checks.ts';
import { failWorkflowRun } from './fail-workflow-run.ts';
import { toError } from './connect-treeseed-market-project.ts';

export async function workflowDestroy(helpers: WorkflowOperationHelpers, input: TreeseedDestroyInput) {
	try {
		return withContextEnv(helpers.context.env, async () => {
			const tenantRoot = resolveProjectRootOrThrow('destroy', helpers.cwd());
			const root = workspaceRoot(tenantRoot);
			const session = resolveTreeseedWorkflowSession(root);
			const scope = String(input.environment ?? input.target ?? '');
			if (!scope) {
				workflowError('destroy', 'validation_failed', 'Treeseed destroy requires an environment target.');
			}
			const executionMode = normalizeExecutionMode(input);
			const target = createPersistentDeployTarget(scope);
			const planOnly = executionMode === 'plan';
			const force = input.force === true;
			const deleteData = input.deleteData === true;
			const sweepTreeseed = input.sweepTreeseed === true;
			const destroyRemote = input.destroyRemote !== false;
			const destroyLocal = input.destroyLocal !== false;
			const removeBuildArtifacts = input.removeBuildArtifacts === true;
			applyTreeseedEnvironmentToProcess({ tenantRoot, scope, override: true });
			assertTreeseedCommandEnvironment({ tenantRoot, scope, purpose: 'destroy' });
			const deployConfig = validateDestroyPrerequisites(tenantRoot, { requireRemote: executionMode === 'execute' && destroyRemote });
			const state = loadDeployState(tenantRoot, deployConfig, { target });
			const expectedConfirmation = deployConfig.slug;
			const payload = {
				scope, 				planOnly, 				force, 				deleteData, 				sweepTreeseed, 				destroyRemote, 				destroyLocal, 				removeBuildArtifacts, 				expectedConfirmation,
				stateSummary: {
					workerName: state.workerName, 					lastDeploymentTimestamp: state.lastDeploymentTimestamp ?? null,
				},
				plannedSteps: [
					...(destroyRemote ? [{ id: 'destroy-remote', description: `Destroy remote ${scope} resources` }] : []),
					...(sweepTreeseed ? [{ id: 'sweep-treeseed-resources', description: 'Sweep TreeSeed-owned provider resources across persistent environments' }] : []),
					...(destroyLocal ? [{ id: 'cleanup-local', description: `Clean local ${scope} state${removeBuildArtifacts ? ' and build artifacts' : ''}` }] : []),
				],
				remoteResult: null,
			};

			if (executionMode === 'plan') {
				const plannedRemoteResult = destroyRemote
					? await destroyTreeseedEnvironmentResources(tenantRoot, { planOnly: true, force, deleteData, sweepTreeseed, target })
					: null;
				return buildWorkflowResult(
					'destroy', 					tenantRoot,
					{
						...payload, 						remoteResult: plannedRemoteResult,
					},
					{
						executionMode,
						nextSteps: createNextSteps([
							{ operation: 'destroy', reason: 'Run without --plan to destroy the selected environment.', input: { environment: scope, force, deleteData, sweepTreeseed, removeBuildArtifacts } },
							{ operation: 'status', reason: 'Confirm the current environment state before making destructive changes.' },
						]),
					},
				);
			}

			const workflowRun = acquireWorkflowRun(
				'destroy', 				session,
				{
					environment: scope, 					force, 					deleteData, 					sweepTreeseed, 					destroyRemote, 					destroyLocal, 					removeBuildArtifacts,
				},
				[
					...(destroyRemote
						? [{
							id: 'destroy-remote',
							description: `Destroy remote ${scope} resources`,
							repoName: session.rootRepo.name, 							repoPath: session.rootRepo.path, 							branch: session.branchName, 							resumable: false,
						}]
						: []),
					...(destroyLocal
						? [{
							id: 'cleanup-local',
							description: `Clean local ${scope} state${removeBuildArtifacts ? ' and build artifacts' : ''}`,
							repoName: session.rootRepo.name, 							repoPath: session.rootRepo.path, 							branch: session.branchName, 							resumable: false,
						}]
						: []),
				],
				helpers.context,
			);

			try {
				const confirmed = await Promise.resolve(resolveDestroyConfirmation(helpers.context, expectedConfirmation, input));
				if (!confirmed) {
					workflowError('destroy', 'confirmation_required', `Destroy confirmation required. Re-run with confirm="${expectedConfirmation}".`);
				}

				const remoteResult = destroyRemote
					? await executeJournalStep(root, workflowRun.runId, 'destroy-remote', () =>
						destroyTreeseedEnvironmentResources(tenantRoot, { planOnly: false, force, deleteData, sweepTreeseed, target }) as Record<string, unknown>)
					: null;
				if (!destroyRemote) {
					skipJournalStep(root, workflowRun.runId, 'destroy-remote', { skippedReason: 'destroyRemote=false' });
				}

				if (destroyLocal) {
					await executeJournalStep(root, workflowRun.runId, 'cleanup-local', () => {
						cleanupDestroyedState(tenantRoot, { target, removeBuildArtifacts });
						return {
							cleaned: true, 							removeBuildArtifacts,
						};
					});
				} else {
					skipJournalStep(root, workflowRun.runId, 'cleanup-local', { skippedReason: 'destroyLocal=false' });
				}

				const resultPayload = {
					...payload, 					planOnly: false, 					remoteResult,
				};
				completeWorkflowRun(root, workflowRun.runId, resultPayload);
				return buildWorkflowResult(
					'destroy', 					tenantRoot, 					resultPayload,
					{
						runId: workflowRun.runId,
						nextSteps: createNextSteps([
							{ operation: 'config', reason: 'Recreate the destroyed environment before using it again.', input: { environment: [scope] } },
							{ operation: 'status', reason: 'Confirm the environment teardown state and any remaining local runtime setup.' },
						]),
					},
				);
			} catch (error) {
				failWorkflowRun(root, workflowRun.runId, error, {
					resumable: false, 					runId: workflowRun.runId, 					command: 'destroy',
					message: `Inspect the failed destroy run for ${scope} before retrying manually.`,
					recoverCommand: 'treeseed recover',
				});
				throw error;
			}
		});
	} catch (error) {
		toError('destroy', error);
	}
}
