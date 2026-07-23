import { resolve } from 'node:path';
import { assertFeatureBranch, mergeBranchDownIntoFeature, promoteCommitToBranchWithExpectedHead, remoteHeadCommit, remoteBranchExists, STAGING_BRANCH, syncBranchWithOrigin } from "../../operations/services/git-workflow.ts";
import { runTreeseedProof } from "../../operations/services/release-proof-runner.ts";
import { hasMeaningfulChanges, repoRoot } from "../../operations/services/workspace-save.ts";
import { workspaceRoot } from "../../operations/services/workspace-tools.ts";
import { resolveTreeseedWorkflowSession } from ".././session.ts";
import { managedWorkflowWorktreeMetadata } from ".././worktrees.ts";
import type { TreeseedStageInput } from "../../workflow.ts";
import { WorkflowOperationHelpers, ensureWorkflowWorkspaceLinks, maybeRunLocalWorkflowCleanup, normalizeSceneArtifactsMode } from './workflow-write.ts';
import { resolveProjectRootOrThrow, withContextEnv, workflowError } from './run-release-production-guarantees.ts';
import { buildWorkflowResult, normalizeExecutionMode, selectWorkflowApplications } from './create-repo-report.ts';
import { findAutoResumableTaskRun, rejectImplicitWorkflowResume } from './gates-for-saved-repository-reports.ts';
import { ensureMessage, toError } from './connect-treeseed-market-project.ts';
import { buildStagePromotionPlan, checkedOutStagePromotionRepos, createStageCandidateManifest, normalizeStageCiMode, normalizeStageCleanupMode, normalizeStageVerifyMode, stageConflictError, stagePreflightBlockers, stagingCandidateWorkflowGates, writeStageCandidateManifest } from './staging-candidate-workflow-gates.ts';
import { helpersForCwd, waitForWorkflowGates, worktreePayload } from './normalize-release-candidate-mode.ts';
import { createNextSteps } from './release-admin-message.ts';
import { maybeAutoSaveCurrentTaskBranch } from './sync-current-branch-to-origin.ts';
import { acquireWorkflowRun, completeWorkflowRun, executeJournalStep, skipJournalStep } from './prepare-fresh-release-run.ts';
import { workflowSave } from './workflow-save.ts';
import { StageCandidateManifest } from './workflow-close.ts';
import { cleanupStageSourceBranches } from './cleanup-stage-source-branches.ts';
import { failWorkflowRun } from './fail-workflow-run.ts';

export async function workflowStage(helpers: WorkflowOperationHelpers, input: TreeseedStageInput) {
	try {
		return await withContextEnv(helpers.context.env, async () => {
			const tenantRoot = resolveProjectRootOrThrow('stage', helpers.cwd());
			const root = workspaceRoot(tenantRoot);
			const executionMode = normalizeExecutionMode(input);
			const session = resolveTreeseedWorkflowSession(root);
			const explicitResumeRunId = helpers.context.workflow?.resumeRunId
				?? (input as TreeseedStageInput & { resumeRunId?: string }).resumeRunId
				?? null;
			const rawAutoResumeRun = executionMode === 'execute' && !explicitResumeRunId
				? findAutoResumableTaskRun(root, 'stage', session.branchName)
				: null;
			rejectImplicitWorkflowResume('stage', rawAutoResumeRun);
			const autoResumeRun = rawAutoResumeRun?.steps.some((step) => step.id === 'preflight')
				? rawAutoResumeRun
				: null;
			const planAutoResumeRun = null;
			const effectiveInput = autoResumeRun
				? (autoResumeRun.input as unknown as TreeseedStageInput)
				: input;
			const localCleanup = maybeRunLocalWorkflowCleanup(helpers, root, 'stage', effectiveInput);
			const message = ensureMessage('stage', effectiveInput.message, 'a resolution message');
			if (effectiveInput.verifyDeployedResources === true) {
				workflowError('stage', 'validation_failed', 'Stage no longer verifies deployed resources. Promote refs with stage, then run staging release/hosting verification separately.');
			}
			const verifyMode = normalizeStageVerifyMode(effectiveInput.verifyMode);
			const ciMode = normalizeStageCiMode(effectiveInput);
			const cleanupMode = normalizeStageCleanupMode(effectiveInput);
			const updateFrom = effectiveInput.updateFrom ?? STAGING_BRANCH;
			if (updateFrom !== STAGING_BRANCH) {
				workflowError('stage', 'validation_failed', `Stage currently supports only --update-from ${STAGING_BRANCH}. Received ${updateFrom}.`);
			}
			const applicationSelection = selectWorkflowApplications(root, { packageSelection: session.packageSelection });
			const featureBranch = executionMode === 'execute' ? assertFeatureBranch(root) : session.branchName ?? '';
			let plan = buildStagePromotionPlan(root, featureBranch, { verifyMode, ciMode, cleanupMode, updateFrom });
			let blockers = stagePreflightBlockers(root, featureBranch, plan);
			const basePayload = {
				mode: 'stage-promotion', 				branchName: featureBranch, 				branchRole: session.branchRole, 				mergeTarget: STAGING_BRANCH, 				mergeStrategy: 'merge-staging-down-then-exact-sha', 				message, 				verifyMode, 				ciMode, 				cleanupMode, 				updateFrom, 				waitForStaging: ciMode === 'hosted', 				sceneArtifacts: normalizeSceneArtifactsMode(effectiveInput.sceneArtifacts), 				localCleanup, 				applicationSelection, 				plan, 				phases: plan.phases, 				blockers,
				autoResumeCandidate: planAutoResumeRun
					? {
						runId: planAutoResumeRun.runId, 						branch: planAutoResumeRun.session.branchName, 						failure: planAutoResumeRun.failure,
					}
					: null, 				legacyMutationPathDisabled: true, 				...worktreePayload(root, effectiveInput.worktreeMode),
			};
			if (executionMode === 'plan') {
				return buildWorkflowResult('stage', root, basePayload, {
					executionMode, 					summary: blockers.length > 0 ? 'Treeseed stage plan blocked.' : 'Treeseed stage promotion plan ready.', 					includeFinalState: false,
					nextSteps: createNextSteps([
						blockers.length > 0
							? { operation: 'status', reason: 'Resolve blockers before staging.' }
							: { operation: 'stage', reason: 'Promote the verified feature branch to staging.', input: { message } },
					]),
				});
			}
			if (effectiveInput.autoSave === true) {
				await maybeAutoSaveCurrentTaskBranch(helpers, 'stage', {
					message, 					autoSave: true, 					verify: false, 					preview: false,
				});
				plan = buildStagePromotionPlan(root, featureBranch, { verifyMode, ciMode, cleanupMode, updateFrom });
				blockers = stagePreflightBlockers(root, featureBranch, plan);
			}
			if (blockers.length > 0) {
				workflowError('stage', 'validation_failed', `stage is blocked:\n${blockers.map((entry) => `- ${entry}`).join('\n')}`, {
					details: { blockers, plan },
				});
			}
			const workflowRun = acquireWorkflowRun('stage', resolveTreeseedWorkflowSession(root), {
				...effectiveInput, 				verifyMode, 				ciMode, 				cleanupMode, 				updateFrom,
			} as Record<string, unknown>, [
				{ id: 'preflight', description: 'Validate clean feature branch before staging', repoName: '@treeseed/market', repoPath: repoRoot(root), branch: featureBranch, resumable: true },
				{ id: 'merge-staging-down', description: 'Merge staging into feature branches', repoName: '@treeseed/market', repoPath: repoRoot(root), branch: featureBranch, resumable: true },
				{ id: 'save-integrated-feature', description: 'Save integrated feature state after staging merge-down', repoName: '@treeseed/market', repoPath: repoRoot(root), branch: featureBranch, resumable: true },
				{ id: 'verify-integrated-feature', description: 'Run local proof before staging mutation', repoName: '@treeseed/market', repoPath: repoRoot(root), branch: featureBranch, resumable: true },
				{ id: 'write-stage-candidate', description: 'Write exact stage candidate manifest', repoName: '@treeseed/market', repoPath: repoRoot(root), branch: featureBranch, resumable: true },
				{ id: 'promote-to-staging', description: 'Promote exact verified refs to staging', repoName: '@treeseed/market', repoPath: repoRoot(root), branch: featureBranch, resumable: true },
				{ id: 'verify-staging-refs', description: 'Verify remote staging refs match promoted commits', repoName: '@treeseed/market', repoPath: repoRoot(root), branch: STAGING_BRANCH, resumable: true },
					{ id: 'hosted-ci', description: 'Wait for hosted staging CI when explicitly requested', repoName: '@treeseed/market', repoPath: repoRoot(root), branch: STAGING_BRANCH, resumable: true },
				{ id: 'workspace-link-restore', description: 'Restore local workspace links after stage', repoName: '@treeseed/market', repoPath: repoRoot(root), branch: STAGING_BRANCH, resumable: true },
				{ id: 'cleanup-source', description: 'Clean up source branches and worktree after successful promotion', repoName: '@treeseed/market', repoPath: repoRoot(root), branch: featureBranch, resumable: true },
			], helpers.context);
			try {
				await executeJournalStep(root, workflowRun.runId, 'preflight', () => {
					const currentPlan = buildStagePromotionPlan(root, featureBranch, { verifyMode, ciMode, cleanupMode, updateFrom });
					const currentBlockers = stagePreflightBlockers(root, featureBranch, currentPlan);
					if (currentBlockers.length > 0) {
						workflowError('stage', 'validation_failed', `stage is blocked:\n${currentBlockers.map((entry) => `- ${entry}`).join('\n')}`, {
							details: { blockers: currentBlockers, plan: currentPlan },
						});
					}
					return { status: 'passed', checkedAt: new Date().toISOString() };
				});
				const mergeDown = await executeJournalStep(root, workflowRun.runId, 'merge-staging-down', () => {
					const results: Array<Record<string, unknown>> = [];
					try {
						for (const repo of checkedOutStagePromotionRepos(root)) {
							if (!remoteBranchExists(repo.dir, featureBranch)) {
								results.push({ name: repo.name, path: repo.dir, skipped: true, reason: 'remote-branch-missing' });
								continue;
							}
							results.push({
								name: repo.name, 								path: repo.dir, 								...mergeBranchDownIntoFeature(repo.dir, {
									featureBranch, 									sourceBranch: STAGING_BRANCH,
									message: `stage: merge ${STAGING_BRANCH} into ${featureBranch}`,
									allowGeneratedMetadataAutoResolution: true,
								}),
							});
						}
						results.push({
							name: '@treeseed/market', 							path: repoRoot(root), 							...mergeBranchDownIntoFeature(repoRoot(root), {
								featureBranch, 								sourceBranch: STAGING_BRANCH,
								message: `stage: merge ${STAGING_BRANCH} into ${featureBranch}`,
								allowGeneratedMetadataAutoResolution: true,
							}),
						});
					} catch (error) {
						const details = error && typeof error === 'object' ? error as Record<string, unknown> : {};
						throw stageConflictError(error instanceof Error ? error.message : String(error), {
							...details, 							results, 							branchName: featureBranch, 							targetBranch: STAGING_BRANCH,
						});
					}
					return { status: 'completed', results };
				});
				const mergeChanged = Array.isArray(mergeDown?.results)
					&& mergeDown.results.some((entry) => Boolean((entry as Record<string, unknown>).merged));
				const saveResult = mergeChanged || hasMeaningfulChanges(repoRoot(root))
					? await executeJournalStep(root, workflowRun.runId, 'save-integrated-feature', () =>
						workflowSave(helpersForCwd(helpers, root), {
							message: `integrate staging before stage: ${message}`,
							verifyMode: 'skip', 							ciMode: 'off', 							refreshPreview: false, 							preview: false, 							workspaceLinks: effectiveInput.workspaceLinks ?? 'auto',
						}))
					: (skipJournalStep(root, workflowRun.runId, 'save-integrated-feature', { skippedReason: 'staging already integrated' }), null);
				const verification = verifyMode === 'none' || process.env.TREESEED_RELEASE_CANDIDATE_REHEARSAL_MODE === 'skip'
					? (skipJournalStep(root, workflowRun.runId, 'verify-integrated-feature', { mode: verifyMode, status: 'skipped' }), {
						mode: verifyMode, 						status: 'skipped' as const, 						completedAt: null,
					})
					: await executeJournalStep(root, workflowRun.runId, 'verify-integrated-feature', async () => {
						const proof = await runTreeseedProof({
							root, 							target: 'staging', 							driver: verifyMode === 'action' ? 'act' : 'local', 							write: (line, stream) => helpers.write(`[stage][verify] ${line}`, stream),
						});
						if (proof.failures.length > 0) {
							const first = proof.failures[0]!;
							workflowError('stage', 'validation_failed', [
								'Treeseed stage proof failed.',
								`- ${first.subject.id}: ${first.invalidationReasons[0] ?? first.status}`,
								first.result.workflow?.url ? `Run: ${first.result.workflow.url}` : null,
							].join('\n'), {
								details: { proof },
							});
						}
						return {
							mode: verifyMode, 							status: 'passed' as const, 							completedAt: new Date().toISOString(), 							proof,
						};
					});
				const manifest = await executeJournalStep(root, workflowRun.runId, 'write-stage-candidate', () => {
					const currentPlan = buildStagePromotionPlan(root, featureBranch, { verifyMode, ciMode, cleanupMode, updateFrom });
					return writeStageCandidateManifest(root, workflowRun.runId, createStageCandidateManifest(root, workflowRun.runId, featureBranch, currentPlan, {
						mode: verifyMode, 						status: verification.status, 						completedAt: verification.completedAt,
					}));
				});
				const typedManifest = manifest as unknown as StageCandidateManifest;
				const promotion = await executeJournalStep(root, workflowRun.runId, 'promote-to-staging', () => {
					const results: Array<Record<string, unknown>> = [];
					for (const pkg of typedManifest.packages) {
						results.push({
							name: pkg.name, 							...promoteCommitToBranchWithExpectedHead(resolve(root, pkg.path), {
								commitSha: pkg.commit, 								targetBranch: STAGING_BRANCH,
								expectedBefore: typedManifest.stagingHeadsBefore[pkg.name] ?? null,
							}),
						});
					}
					results.push({
						name: '@treeseed/market', 						...promoteCommitToBranchWithExpectedHead(repoRoot(root), {
							commitSha: typedManifest.root.commit, 							targetBranch: STAGING_BRANCH,
							expectedBefore: typedManifest.stagingHeadsBefore['@treeseed/market'] ?? null,
						}),
					});
					return { status: 'completed', results };
				});
				const stagingRefs = await executeJournalStep(root, workflowRun.runId, 'verify-staging-refs', () => {
					const refs: Record<string, string> = {};
					for (const pkg of typedManifest.packages) {
						const observed = remoteHeadCommit(resolve(root, pkg.path), STAGING_BRANCH);
						if (observed !== pkg.commit) {
							throw new Error(`${pkg.name} staging ref mismatch: expected ${pkg.commit}, observed ${observed}.`);
						}
						refs[pkg.name] = observed;
					}
					const rootObserved = remoteHeadCommit(repoRoot(root), STAGING_BRANCH);
					if (rootObserved !== typedManifest.root.commit) {
						throw new Error(`@treeseed/market staging ref mismatch: expected ${typedManifest.root.commit}, observed ${rootObserved}.`);
					}
					refs['@treeseed/market'] = rootObserved;
					return { status: 'verified', refs };
				});
				const hostedCi = ciMode === 'hosted'
						? await executeJournalStep(root, workflowRun.runId, 'hosted-ci', () => waitForWorkflowGates(
							'stage', 							stagingCandidateWorkflowGates(root, typedManifest), 							'hosted',
							{ root, runId: workflowRun.runId, onProgress: (line, stream) => helpers.write(line, stream) },
						))
						: (skipJournalStep(root, workflowRun.runId, 'hosted-ci', { skippedReason: 'ci off' }), { status: 'skipped', reason: 'ci off' });
				const workspaceLinks = await executeJournalStep(root, workflowRun.runId, 'workspace-link-restore', () =>
					ensureWorkflowWorkspaceLinks(root, helpers, effectiveInput.workspaceLinks ?? 'auto'));
				if (!managedWorkflowWorktreeMetadata(root)) {
					for (const repo of checkedOutStagePromotionRepos(root)) {
						syncBranchWithOrigin(repo.dir, STAGING_BRANCH);
					}
					syncBranchWithOrigin(repoRoot(root), STAGING_BRANCH);
				}
				const cleanup = cleanupMode === 'success'
					? await executeJournalStep(root, workflowRun.runId, 'cleanup-source', () => cleanupStageSourceBranches(root, featureBranch, typedManifest))
					: (skipJournalStep(root, workflowRun.runId, 'cleanup-source', { skippedReason: 'manual cleanup selected' }), { status: 'skipped', reason: 'manual cleanup selected' });
				const payload = {
					...basePayload,
					blockers: [],
					runId: workflowRun.runId, 					mergeDown, 					saveResult, 					verification, 					manifest: typedManifest, 					promotion, 					stagingRefs, 					hostedCi, 					stagingGuarantees: null, 					cleanup, 					workspaceLinks, 					finalBranch: STAGING_BRANCH,
					summary: ciMode === 'hosted'
						? `Staging candidate ${typedManifest.candidateId} passed all exact-SHA verification and deployment workflows.`
						: `Staging candidate ${typedManifest.candidateId} was promoted asynchronously; hosted verification is pending.`,
				};
				completeWorkflowRun(root, workflowRun.runId, payload);
				return buildWorkflowResult('stage', root, payload, {
					runId: workflowRun.runId, 					summary: 'Treeseed stage completed successfully.', 					includeFinalState: false,
					nextSteps: createNextSteps([
						{ operation: 'ci', reason: 'Inspect staging CI/CD status after branch promotion.', input: { branch: STAGING_BRANCH, failed: true } },
					]),
				});
			} catch (error) {
				try {
					ensureWorkflowWorkspaceLinks(root, helpers, effectiveInput.workspaceLinks ?? 'auto');
				} catch {
					// Preserve the original stage failure.
				}
				failWorkflowRun(root, workflowRun.runId, error, {
					resumable: true, 					runId: workflowRun.runId, 					command: 'stage',
					message: `Resume the interrupted stage for ${featureBranch}.`,
					recoverCommand: 'treeseed recover',
					resumeCommand: `treeseed resume ${workflowRun.runId}`,
				});
				throw error;
			}
		});
	} catch (error) {
		toError('stage', error);
	}
}
