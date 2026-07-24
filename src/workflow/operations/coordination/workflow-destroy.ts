import { resolve } from 'node:path';
import { applyEnvironmentToProcess, assertCommandEnvironment } from "../../../operations/services/configuration/config-runtime.ts";
import { cleanupDestroyedState, createPersistentDeployTarget, destroyEnvironmentResources, loadDeployState, validateDestroyPrerequisites } from "../../../operations/services/hosting/deployment/deploy.ts";
import { workspaceRoot } from "../../../operations/services/treedx/workspaces/workspace-tools.ts";
import { resolveWorkflowSession } from "../../session.ts";
import type { DestroyInput } from "../../../operations/workflow.ts";
import { WorkflowOperationHelpers } from '../recovery/workflow-write.ts';
import { resolveProjectRootOrThrow, withContextEnv, workflowError } from '../commerce/catalog/run-release-production-guarantees.ts';
import { buildWorkflowResult, normalizeExecutionMode } from '../support/create-repo-report.ts';
import { createNextSteps } from '../packages/release-admin-message.ts';
import { acquireWorkflowRun, completeWorkflowRun, executeJournalStep, skipJournalStep } from '../packages/prepare-fresh-release-run.ts';
import { resolveDestroyConfirmation } from '../packages/collect-published-release-artifact-checks.ts';
import { failWorkflowRun } from '../recovery/fail-workflow-run.ts';
import { toError } from '../projects/projects-core/connect-market-project.ts';

export async function workflowDestroy(helpers: WorkflowOperationHelpers, input: DestroyInput) {
	try {
		return withContextEnv(helpers.context.env, async () => {
			const tenantRoot = resolveProjectRootOrThrow('destroy', helpers.cwd());
			const root = workspaceRoot(tenantRoot);
			const session = resolveWorkflowSession(root);
			const scope = String(input.environment ?? input.target ?? '');
			if (!scope) {
				workflowError('destroy', 'validation_failed', 'Treeseed destroy requires an environment target.');
			}
			const executionMode = normalizeExecutionMode(input);
			const target = createPersistentDeployTarget(scope);
			const planOnly = executionMode === 'plan';
			const force = input.force === true;
			const deleteData = input.deleteData === true;
			const sweep = input.sweep === true;
			const destroyRemote = input.destroyRemote !== false;
			const destroyLocal = input.destroyLocal !== false;
			const removeBuildArtifacts = input.removeBuildArtifacts === true;
			applyEnvironmentToProcess({ tenantRoot, scope, override: true });
			assertCommandEnvironment({ tenantRoot, scope, purpose: 'destroy' });
			const deployConfig = validateDestroyPrerequisites(tenantRoot, { requireRemote: executionMode === 'execute' && destroyRemote });
			const state = loadDeployState(tenantRoot, deployConfig, { target });
			const expectedConfirmation = deployConfig.slug;
			const payload = {
				scope, 				planOnly, 				force, 				deleteData, 				sweep, 				destroyRemote, 				destroyLocal, 				removeBuildArtifacts, 				expectedConfirmation,
				stateSummary: {
					workerName: state.workerName, 					lastDeploymentTimestamp: state.lastDeploymentTimestamp ?? null,
				},
				plannedSteps: [
					...(destroyRemote ? [{ id: 'destroy-remote', description: `Destroy remote ${scope} resources` }] : []),
					...(sweep ? [{ id: 'sweep-treeseed-resources', description: 'Sweep TreeSeed-owned provider resources across persistent environments' }] : []),
					...(destroyLocal ? [{ id: 'cleanup-local', description: `Clean local ${scope} state${removeBuildArtifacts ? ' and build artifacts' : ''}` }] : []),
				],
				remoteResult: null,
			};

			if (executionMode === 'plan') {
				const plannedRemoteResult = destroyRemote
					? await destroyEnvironmentResources(tenantRoot, { planOnly: true, force, deleteData, sweep, target })
					: null;
				return buildWorkflowResult(
					'destroy', 					tenantRoot,
					{
						...payload, 						remoteResult: plannedRemoteResult,
					},
					{
						executionMode,
						nextSteps: createNextSteps([
							{ operation: 'destroy', reason: 'Run without --plan to destroy the selected environment.', input: { environment: scope, force, deleteData, sweep, removeBuildArtifacts } },
							{ operation: 'status', reason: 'Confirm the current environment state before making destructive changes.' },
						]),
					},
				);
			}

			const workflowRun = acquireWorkflowRun(
				'destroy', 				session,
				{
					environment: scope, 					force, 					deleteData, 					sweep, 					destroyRemote, 					destroyLocal, 					removeBuildArtifacts,
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
						destroyEnvironmentResources(tenantRoot, { planOnly: false, force, deleteData, sweep, target }) as Record<string, unknown>)
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
