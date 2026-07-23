import { applyTreeseedEnvironmentToProcess } from "../../operations/services/config-runtime.ts";
import { PRODUCTION_BRANCH, STAGING_BRANCH } from "../../operations/services/git-workflow.ts";
import { runTreeseedProof } from "../../operations/services/release-proof-runner.ts";
import { currentBranch, hasMeaningfulChanges, originRemoteUrl, repoRoot } from "../../operations/services/workspace-save.ts";
import { planRepositorySave, repositorySaveErrorDetails, runRepositorySaveOrchestrator, type SaveCommitMessageMode, type SaveDevVersionStrategy, type ReleaseBumpLevel } from "../../operations/services/repository-save-orchestrator.ts";
import { inspectWorkspaceDependencyMode } from "../../operations/services/workspace-dependency-mode.ts";
import { workspaceRoot } from "../../operations/services/workspace-tools.ts";
import { resolveTreeseedWorkflowState } from "../../workflow-state.ts";
import { resolveTreeseedWorkflowSession } from ".././session.ts";
import type { TreeseedSaveInput } from "../../workflow.ts";
import { TreeseedWorkflowError, WorkflowOperationHelpers, ensureWorkflowWorkspaceLinks, maybeRunLocalWorkflowCleanup, normalizeSaveLane, normalizeSaveVerifyMode, normalizeSceneArtifactsMode, runGit, unlinkWorkflowWorkspaceLinks } from './workflow-write.ts';
import { WorkflowRepoReport, ensureTreeseedCommandReadiness, ensureTreeseedLocalStateExcluded, resolveProjectRootOrThrow, withContextEnv, workflowError } from './run-release-production-guarantees.ts';
import { reattachRepairablePackageRepos } from './sync-current-branch-to-origin.ts';
import { buildWorkflowResult, createManagedWorkflowRepoReports, createRepoReport, normalizeExecutionMode, selectWorkflowApplications, singleSelectedWorkflowAppId, workflowHostedVerificationGateRequired } from './create-repo-report.ts';
import { findAutoResumableSaveRun, hostedWorkflowsForSavedRepository, toError } from './connect-treeseed-market-project.ts';
import { gateForSavedRootReport, gatesForSavedRepositoryReports, rejectImplicitWorkflowResume } from './gates-for-saved-repository-reports.ts';
import { assertSessionBranchSafety, branchPreviewInitialized, reconcileWorkflowBranchPreview } from './collect-published-release-artifact-checks.ts';
import { hostedDeployGate, saveHostedEnvironmentForBranch, shouldUseHostedSaveCi, waitForWorkflowGates, worktreePayload } from './normalize-release-candidate-mode.ts';
import { createNextSteps } from './release-admin-message.ts';
import { acquireWorkflowRun, completeWorkflowRun, executeJournalStep, skipJournalStep } from './prepare-fresh-release-run.ts';
import { reconcileSaveHostedEnvironment } from './reconcile-save-hosted-environment.ts';
import { buildReleasePlanSnapshot } from './workflow-proof.ts';
import { runReleaseCandidateProofForPlan } from './back-merge-production-into-staging.ts';
import { failWorkflowRun } from './fail-workflow-run.ts';

export async function workflowSave(helpers: WorkflowOperationHelpers, input: TreeseedSaveInput) {
	try {
		return await withContextEnv(helpers.context.env, async () => {
			const tenantRoot = resolveProjectRootOrThrow('save', helpers.cwd());
			const root = workspaceRoot(tenantRoot);
			ensureTreeseedLocalStateExcluded(root);
			const rootBranch = currentBranch(repoRoot(root)) || null;
			reattachRepairablePackageRepos(root, [rootBranch, STAGING_BRANCH, PRODUCTION_BRANCH].filter((branch): branch is string => Boolean(branch)), {
				operation: 'save', 				onProgress: (line, stream) => helpers.write(line, stream), 				throwOnBlocker: true,
			});
			const session = resolveTreeseedWorkflowSession(root);
			const gitRoot = session.gitRoot;
			const branch = session.branchName;
			const scope = branch === STAGING_BRANCH ? 'staging' : branch === PRODUCTION_BRANCH ? 'prod' : 'local';
			const beforeState = resolveTreeseedWorkflowState(root);
			const recursiveWorkspace = session.mode === 'recursive-workspace';
			const mode = session.mode;
			const executionMode = normalizeExecutionMode(input);
			const explicitResumeRunId = helpers.context.workflow?.resumeRunId
				?? (input as TreeseedSaveInput & { resumeRunId?: string }).resumeRunId
				?? null;
			const autoResumeRun = executionMode === 'execute' && !explicitResumeRunId
				? findAutoResumableSaveRun(root, branch)
				: null;
			rejectImplicitWorkflowResume('save', autoResumeRun);
			const planAutoResumeRun = null;
			const effectiveInput = autoResumeRun
				? (autoResumeRun.input as unknown as TreeseedSaveInput)
				: input;
			const localCleanup = maybeRunLocalWorkflowCleanup(helpers, root, 'save', effectiveInput);
			const message = String(effectiveInput.message ?? '').trim();
			const saveLane = normalizeSaveLane(effectiveInput.lane);
			const saveCiMode = 'off' as const;
			const releaseCandidateMode = 'skip' as const;
			const optionsHotfix = effectiveInput.hotfix === true;
			const previewInitialized = branchPreviewInitialized(root, branch);

			applyTreeseedEnvironmentToProcess({ tenantRoot: root, scope, override: true });

			if (!branch) {
				workflowError('save', 'validation_failed', 'Treeseed save requires an active git branch.');
			}
			if (branch === PRODUCTION_BRANCH && !optionsHotfix) {
				workflowError('save', 'unsupported_state', 'Treeseed save is blocked on main unless --hotfix is explicitly set.');
			}

			const packageReports = createManagedWorkflowRepoReports(root);
			const rootRepo = createRepoReport('@treeseed/market', gitRoot, branch, hasMeaningfulChanges(gitRoot));
			const blockers: string[] = [];

			if (executionMode === 'plan') {
				if (!session.rootRepo.hasOriginRemote) {
					blockers.push('Market repo is missing origin remote.');
				}
				if (branch === PRODUCTION_BRANCH && !optionsHotfix) {
					blockers.push('Main saves require --hotfix.');
				}
				const repositoryPlan = planRepositorySave({
					root, 					gitRoot, 					branch, 					message, 					bump: (effectiveInput.bump ?? 'patch') as ReleaseBumpLevel, 					devVersionStrategy: (effectiveInput.devVersionStrategy ?? 'prerelease') as SaveDevVersionStrategy, 					devDependencyReferenceMode: effectiveInput.devDependencyReferenceMode ?? 'git-commit', 					gitDependencyProtocol: effectiveInput.gitDependencyProtocol ?? 'preserve-origin', 					gitRemoteWriteMode: effectiveInput.gitRemoteWriteMode ?? 'ssh-pushurl', 					verifyMode: normalizeSaveVerifyMode(effectiveInput.verify === false ? 'skip' : effectiveInput.verifyMode), 					commitMessageMode: (effectiveInput.commitMessageMode ?? 'auto') as SaveCommitMessageMode,
				});
				const applicationSelection = selectWorkflowApplications(root);
				const workspaceLinks = inspectWorkspaceDependencyMode(root, { mode: effectiveInput.workspaceLinks ?? 'auto', env: helpers.context.env });
				return buildWorkflowResult(
					'save', 					root,
					{
						mode, 						branch, 						scope, 						hotfix: optionsHotfix, 						message, 						repos: repositoryPlan.repos, 						rootRepo: repositoryPlan.rootRepo, 						blockers,
						autoResumeCandidate: planAutoResumeRun
							? {
								runId: planAutoResumeRun.runId, 								branch: planAutoResumeRun.session.branchName, 								failure: planAutoResumeRun.failure,
							}
							: null, 						workspaceLinks, 						sceneArtifacts: normalizeSceneArtifactsMode(effectiveInput.sceneArtifacts), 						localCleanup, 						ciMode: saveCiMode, 						lane: saveLane, 						verifyMode: effectiveInput.verifyMode ?? 'fast', 						releaseCandidateMode, 						applicationSelection, 						...worktreePayload(root, effectiveInput.worktreeMode), 						repositoryPlan, 						waves: repositoryPlan.waves, 						plannedVersions: repositoryPlan.plannedVersions,
						plannedSteps: [
							{ id: 'workspace-unlink', description: 'Remove local workspace links before deployment install and lockfile updates' },
							...repositoryPlan.plannedSteps,
							{ id: 'lockfile-validation', description: 'Validate refreshed package-lock.json files before any save commit is pushed' },
							...(shouldUseHostedSaveCi(effectiveInput, branch, saveLane)
								? [{ id: 'hosted-ci', description: saveHostedEnvironmentForBranch(branch) ? `Reconcile and verify hosted deployments for ${saveHostedEnvironmentForBranch(branch)}` : `Wait for hosted save workflows on ${branch}` }]
								: []),
							...(saveLane === 'promotion'
								? [{ id: 'release-proof', description: 'Run or reuse authoritative hosted release proof records for exact package refs' }]
								: []),
							...(branch === STAGING_BRANCH && releaseCandidateMode !== 'skip'
								? [{ id: 'release-candidate', description: `Run ${releaseCandidateMode} release-candidate readiness checks for the saved staging state` }]
								: []),
							{ id: 'workspace-link', description: 'Restore local workspace links after save' },
							...((beforeState.branchRole === 'feature' && (effectiveInput.preview === true || previewInitialized))
								? [{ id: 'preview', description: `Refresh preview deployment for ${branch}` }]
								: []),
						],
					},
					{
						executionMode,
						nextSteps: createNextSteps([
							{ operation: 'save', reason: planAutoResumeRun ? `Run without --plan to resume ${planAutoResumeRun.runId}.` : 'Run without --plan to persist the workspace checkpoint.', input: { message, hotfix: optionsHotfix, preview: effectiveInput.preview === true } },
						]),
					},
				);
			}

			assertSessionBranchSafety('save', session, {
				allowPackageReposWithoutOrigin: true,
			});
			try {
				originRemoteUrl(gitRoot);
			} catch {
				workflowError('save', 'validation_failed', 'Treeseed save requires an origin remote.');
			}

			const workflowRun = acquireWorkflowRun(
				'save', 				session,
				{
					message, 					hotfix: optionsHotfix, 					preview: effectiveInput.preview === true, 					refreshPreview: effectiveInput.refreshPreview !== false, 					verify: effectiveInput.verify !== false, 					bump: effectiveInput.bump ?? 'patch', 					devVersionStrategy: effectiveInput.devVersionStrategy ?? 'prerelease', 					devDependencyReferenceMode: effectiveInput.devDependencyReferenceMode ?? 'git-commit', 					gitDependencyProtocol: effectiveInput.gitDependencyProtocol ?? 'preserve-origin', 					gitRemoteWriteMode: effectiveInput.gitRemoteWriteMode ?? 'ssh-pushurl', 						verifyMode: effectiveInput.verifyMode ?? (effectiveInput.verify === false ? 'skip' : 'fast'), 					ciMode: saveCiMode, 					lane: saveLane, 					worktreeMode: effectiveInput.worktreeMode ?? 'auto', 					commitMessageMode: effectiveInput.commitMessageMode ?? 'auto', 					workspaceLinks: effectiveInput.workspaceLinks ?? 'auto', 					releaseCandidate: releaseCandidateMode, 					verifyDeployedResources: effectiveInput.verifyDeployedResources === true,
				},
				[
					{
						id: 'save-repositories', 						description: 'Save dependency-ordered repositories', 						repoName: rootRepo.name, 						repoPath: rootRepo.path, 						branch, 						resumable: true,
					},
					...(shouldUseHostedSaveCi(effectiveInput, branch, saveLane)
						? [{
							id: 'hosted-ci',
							description: saveHostedEnvironmentForBranch(branch) ? `Reconcile and verify hosted deployments for ${saveHostedEnvironmentForBranch(branch)}` : `Wait for hosted save workflows on ${branch}`,
							repoName: rootRepo.name, 							repoPath: rootRepo.path, 							branch, 							resumable: true,
						}]
						: []),
					...(saveLane === 'promotion'
						? [{
							id: 'release-proof', 							description: 'Run authoritative hosted release proof records', 							repoName: rootRepo.name, 							repoPath: rootRepo.path, 							branch, 							resumable: true,
						}]
						: []),
					...(branch === STAGING_BRANCH && releaseCandidateMode !== 'skip'
						? [{
							id: 'release-candidate', 							description: 'Run release-candidate readiness checks', 							repoName: rootRepo.name, 							repoPath: rootRepo.path, 							branch, 							resumable: true,
						}]
						: []),
					...((beforeState.branchRole === 'feature' && (effectiveInput.preview === true || (effectiveInput.refreshPreview !== false && previewInitialized)))
						? [{
							id: 'preview',
							description: `Refresh preview ${branch}`,
							repoName: rootRepo.name, 							repoPath: rootRepo.path, 							branch, 							resumable: true,
						}]
						: []),
				],
				explicitResumeRunId
					? {
						...helpers.context,
						workflow: { ...(helpers.context.workflow ?? {}), resumeRunId: explicitResumeRunId },
					}
					: autoResumeRun
					? {
						...helpers.context,
						workflow: {
							...(helpers.context.workflow ?? {}),
							resumeRunId: autoResumeRun.runId,
						},
					}
					: helpers.context,
			);
			if (autoResumeRun) {
				helpers.write(`[workflow][resume] Resuming interrupted save ${autoResumeRun.runId} on ${branch}.`);
			}
			helpers.write(`[save][workflow] Preparing save on ${branch} (${mode}, ${scope}).`);

			try {
				const saveResult = await executeJournalStep(root, workflowRun.runId, 'save-repositories', () =>
					(async () => {
						helpers.write('[save][workflow] Saving repositories and validating lockfiles.');
						unlinkWorkflowWorkspaceLinks(root, helpers, effectiveInput.workspaceLinks ?? 'auto');
						try {
							return await runRepositorySaveOrchestrator({
								root, 								gitRoot, 								branch, 								message, 								bump: (effectiveInput.bump ?? 'patch') as ReleaseBumpLevel, 								devVersionStrategy: (effectiveInput.devVersionStrategy ?? 'prerelease') as SaveDevVersionStrategy, 								devDependencyReferenceMode: effectiveInput.devDependencyReferenceMode ?? 'git-commit', 								gitDependencyProtocol: effectiveInput.gitDependencyProtocol ?? 'preserve-origin', 								gitRemoteWriteMode: effectiveInput.gitRemoteWriteMode ?? 'ssh-pushurl', 								verifyMode: normalizeSaveVerifyMode(effectiveInput.verify === false ? 'skip' : effectiveInput.verifyMode), 								commitMessageMode: (effectiveInput.commitMessageMode ?? 'auto') as SaveCommitMessageMode, 								workflowRunId: workflowRun.runId, 								deferPushUntilVerified: true, 								onProgress: (line, stream) => helpers.write(line, stream), 								onWaveSaved: branch === STAGING_BRANCH && shouldUseHostedSaveCi(effectiveInput, branch, saveLane)
									? async ({ nodes, reports, rootRepo: waveRootRepo }) => {
										const nonRootReportsForWave = reports.filter((repo, index) => nodes[index]?.id !== '.');
										const rootReportForWave = nodes.some((node) => node.id === '.')
											? waveRootRepo
											: null;
										const hostedEnvironment = saveHostedEnvironmentForBranch(branch);
										const gates = [
											...gatesForSavedRepositoryReports(root, nonRootReportsForWave), 											...(rootReportForWave && !hostedEnvironment ? gateForSavedRootReport(rootReportForWave, branch, scope) : []),
										];
										if (gates.length === 0) {
											return [];
										}
										const repositoryNames = gates.map((gate) => gate.name).join(', ');
										if (nonRootReportsForWave.length > 0) {
											helpers.write(`[save][workflow] Waiting for hosted repository gates before saving dependents: ${repositoryNames}.`);
										} else if (rootReportForWave && !hostedEnvironment) {
											helpers.write('[save][workflow] Waiting for hosted market deploy gate.');
										}
										return waitForWorkflowGates('save', gates, 'hosted', {
											root, 											runId: workflowRun.runId, 											onProgress: (line, stream) => helpers.write(line, stream),
										});
									}
									: undefined,
							});
						} finally {
							ensureWorkflowWorkspaceLinks(root, helpers, effectiveInput.workspaceLinks ?? 'auto');
						}
					})());
				const savedPackageReports = saveResult?.repos ?? packageReports;
				const savedRootRepo = saveResult?.rootRepo ?? rootRepo;
				helpers.write('[save][workflow] Repository save phase complete; checking command readiness.');
				const head = savedRootRepo.commitSha ?? runGit(['rev-parse', 'HEAD'], { cwd: gitRoot, capture: true }).trim();
				const commitCreated = savedRootRepo.committed === true;
				const branchSync = {
					...(savedRootRepo.publishWait ?? {}),
					pushed: savedRootRepo.pushed === true,
				};
				const workspaceLinks = inspectWorkspaceDependencyMode(root, { mode: effectiveInput.workspaceLinks ?? 'auto', env: helpers.context.env });
				const commandReadiness = ensureTreeseedCommandReadiness(root);
				const lockfileValidation = {
					root: savedRootRepo.lockfileValidation,
					repos: savedPackageReports.map((repo) => ({
						name: repo.name, 						path: repo.path, 						lockfileValidation: repo.lockfileValidation,
					})),
				};
				const saveWorkflowGates = shouldUseHostedSaveCi(effectiveInput, branch, saveLane)
					? await executeJournalStep(root, workflowRun.runId, 'hosted-ci', async () =>
						{
							const hostedEnvironment = saveHostedEnvironmentForBranch(branch);
							if (hostedEnvironment) {
								const workflowGates = saveResult?.workflowGates ?? [];
								return {
									workflowGates, 									hostedReconcile: await reconcileSaveHostedEnvironment(root, hostedEnvironment, helpers, workflowRun.runId),
								};
							}
							helpers.write('[save][workflow] Waiting for hosted save workflow gates.');
							return waitForWorkflowGates('save', [
							...(branch !== STAGING_BRANCH && savedRootRepo.pushed && savedRootRepo.commitSha && branch
								? [{
									name: savedRootRepo.name, 									repoPath: savedRootRepo.path, 									workflow: 'verify.yml', 									branch, 									headSha: savedRootRepo.commitSha,
								}]
								: []),
							...((branch === STAGING_BRANCH || effectiveInput.verifyDeployedResources === true) && scope !== 'local' && savedRootRepo.pushed && savedRootRepo.commitSha && branch
								? [hostedDeployGate({
									name: savedRootRepo.name, 									repoPath: savedRootRepo.path, 									workflow: 'deploy.yml', 									branch, 									headSha: savedRootRepo.commitSha,
								})]
								: []),
							...savedPackageReports
								.filter((repo) => repo.pushed && repo.commitSha && repo.branch)
								.flatMap((repo) => {
									return hostedWorkflowsForSavedRepository(root, repo).map((workflow) => {
										const gate = {
											name: repo.name, 											repoPath: repo.path, 											workflow, 											branch: String(repo.branch), 											headSha: String(repo.commitSha),
										};
										return /^deploy(?:[-.]|$)/u.test(workflow) ? hostedDeployGate(gate) : gate;
									});
								}),
						], 'hosted', {
							root, 							runId: workflowRun.runId, 							onProgress: (line, stream) => helpers.write(line, stream),
						}).then((workflowGates) => ({ workflowGates }));
						})
					: { workflowGates: [] };
				const releaseProof = saveLane === 'promotion' && process.env.TREESEED_STAGE_WAIT_MODE !== 'skip'
					? await executeJournalStep(root, workflowRun.runId, 'release-proof', async () => {
						helpers.write('[save][workflow] Running authoritative hosted release proof.');
						const proof = await runTreeseedProof({
							root, 							target: scope === 'prod' ? 'prod' : scope === 'local' ? 'local' : 'staging', 							driver: 'github-hosted', 							write: (line, stream) => helpers.write(line, stream),
						});
						if (proof.failures.length > 0) {
							const first = proof.failures[0]!;
							workflowError('save', 'validation_failed', [
								'Treeseed promotion proof failed.',
								`- ${first.subject.id}: ${first.invalidationReasons[0] ?? first.status}`,
								first.result.workflow?.url ? `Run: ${first.result.workflow.url}` : null,
								'Hosted GitHub workflow proof is authoritative; local action simulation is advisory.',
							].filter(Boolean).join('\n'), { details: { proof } });
						}
						return proof;
					})
					: (saveLane === 'promotion'
						? (skipJournalStep(root, workflowRun.runId, 'release-proof', { skippedReason: 'disabled' }), { skipped: true, reason: 'disabled' })
						: null);
					const releaseCandidate = branch === STAGING_BRANCH
						&& releaseCandidateMode !== 'skip'
						&& process.env.TREESEED_RELEASE_CANDIDATE_REHEARSAL_MODE !== 'skip'
						? await executeJournalStep(root, workflowRun.runId, 'release-candidate', () => {
							helpers.write(`[save][workflow] Running staging release-candidate proof checks (${releaseCandidateMode}).`);
							const releaseSession = resolveTreeseedWorkflowSession(root);
						const stagingReleasePlan = buildReleasePlanSnapshot({
							root, 							mode, 							level: (effectiveInput.bump ?? 'patch') as string, 							packageSelection: releaseSession.packageSelection, 							packageReports: savedPackageReports, 							rootRepo: savedRootRepo,
							blockers: [],
						});
						return runReleaseCandidateProofForPlan('save', root, stagingReleasePlan, {
							mode: releaseCandidateMode, 							lane: saveLane, 							write: (line, stream) => helpers.write(line, stream),
						});
						})
						: (branch === STAGING_BRANCH && releaseCandidateMode !== 'skip'
							? (skipJournalStep(root, workflowRun.runId, 'release-candidate', { mode: releaseCandidateMode, status: 'skipped' }), {
								mode: releaseCandidateMode, 								status: 'skipped' as const, 								reason: 'release candidate rehearsal disabled',
							})
							: null);

				let previewAction: Record<string, unknown> = { status: 'skipped' };
				if (beforeState.branchRole === 'feature' && branch) {
					if (effectiveInput.preview === true) {
						previewAction = {
							status: previewInitialized ? 'refreshed' : 'created', 							details: await executeJournalStep(root, workflowRun.runId, 'preview', () =>
								reconcileWorkflowBranchPreview(root, branch, helpers.context, { initialize: !previewInitialized })),
						};
					} else if (effectiveInput.refreshPreview !== false && previewInitialized) {
						previewAction = {
							status: 'refreshed', 							details: await executeJournalStep(root, workflowRun.runId, 'preview', () =>
								reconcileWorkflowBranchPreview(root, branch, helpers.context, { initialize: false })),
						};
					}
				}
				const applicationSelection = selectWorkflowApplications(root, {
					packageSelection: {
						selected: savedPackageReports.map((report) => report.name),
					},
				});
				const hostingAudit = await workflowHostedVerificationGateRequired(
					'save', 					root, 					helpers, 					scope === 'prod' ? 'prod' : scope === 'local' ? 'local' : 'staging',
					{
						enabled: effectiveInput.verifyDeployedResources === true, 						strict: true, 						live: effectiveInput.verifyDeployedResources === true, 						appId: singleSelectedWorkflowAppId(applicationSelection),
					},
				);

				const payload = {
					mode: saveResult?.mode ?? mode, 					branch, 					scope, 					hotfix: optionsHotfix, 					message, 					resumed: workflowRun.resumed, 					resumedRunId: workflowRun.resumed ? workflowRun.runId : null, 					autoResumed: autoResumeRun != null, 					commitSha: head, 					commitCreated, 					noChanges: !commitCreated, 					branchSync, 					repos: savedPackageReports, 					rootRepo: savedRootRepo,
					waves: saveResult?.waves ?? [],
					plannedVersions: saveResult?.plannedVersions ?? {},
					partialFailure: null, 					previewAction, 					mergeConflict: null, 					workspaceLinks, 					commandReadiness, 					lockfileValidation, 					ciMode: saveCiMode, 					lane: saveLane, 					verifyMode: effectiveInput.verifyMode ?? 'fast', 					releaseCandidateMode, 					applicationSelection,
					workflowGates: saveWorkflowGates?.workflowGates ?? [],
					hostedReconcile: saveWorkflowGates?.hostedReconcile ?? null, 					releaseCandidate, 					releaseProof, 					hostingAudit, 					...worktreePayload(root, effectiveInput.worktreeMode),
				};
				completeWorkflowRun(root, workflowRun.runId, payload);
				return buildWorkflowResult(
					'save', 					root, 					payload,
					{
						runId: workflowRun.runId,
						nextSteps: createNextSteps([
							branch === STAGING_BRANCH
								? { operation: 'release', reason: 'Promote the validated staging branch into production.', input: { bump: 'patch' } }
								: branch === PRODUCTION_BRANCH
									? { operation: 'status', reason: 'Inspect production state after the explicit hotfix save.' }
									: { operation: 'stage', reason: 'Merge the verified task branch into staging.', input: { message: 'describe the resolution' } },
						]),
					},
				);
			} catch (error) {
				const saveError = repositorySaveErrorDetails(error);
				const savedPartialFailure = saveError.details?.partialFailure as {
					message: string;
					failingRepo: string;
					phase?: string | null;
					currentVersion?: string | null;
					expectedTag?: string | null;
					tagState?: Record<string, unknown> | null;
					nextCommand?: string | null;
					repos: WorkflowRepoReport[];
					rootRepo: WorkflowRepoReport | null;
					error: string;
				} | undefined;
				const failingRepo = savedPartialFailure?.repos.find((report) => report.name === savedPartialFailure.failingRepo)
					?? packageReports.find((report) => report.dirty && report.pushed !== true)
					?? rootRepo;
				const wrappedError = error instanceof TreeseedWorkflowError && error.details?.partialFailure != null
					? error
					: new TreeseedWorkflowError(
						'save', 						error instanceof TreeseedWorkflowError ? error.code : 'unsupported_state', 						error instanceof Error ? error.message : String(error),
						{
							details: {
								...(error instanceof TreeseedWorkflowError ? (error.details ?? {}) : {}),
								...(saveError.details ?? {}),
								partialFailure: savedPartialFailure ?? {
									message: 'Treeseed save stopped before the workspace could finish syncing.', 									failingRepo: failingRepo.name, 									repos: packageReports, 									rootRepo, 									error: error instanceof Error ? error.message : String(error),
								},
							},
							exitCode: error instanceof TreeseedWorkflowError ? error.exitCode : saveError.exitCode,
						},
					);
				failWorkflowRun(root, workflowRun.runId, wrappedError, {
					resumable: true, 					runId: workflowRun.runId, 					command: 'save',
					message: `Resume the interrupted save on ${branch}.`,
					recoverCommand: 'treeseed recover',
					resumeCommand: `treeseed resume ${workflowRun.runId}`,
				});
				throw wrappedError;
			}
		});
	} catch (error) {
		toError('save', error);
	}
}
