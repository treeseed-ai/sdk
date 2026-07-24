import { relative, resolve } from 'node:path';
import { PRODUCTION_BRANCH, pushBranch, STAGING_BRANCH } from "../../../operations/services/operations/git-workflow.ts";
import { repoRoot } from "../../../operations/services/treedx/workspaces/workspace-save.ts";
import { collectInternalDevReferenceIssues } from "../../../operations/services/packages/package-reference-policy.ts";
import { workspaceRoot } from "../../../operations/services/treedx/workspaces/workspace-tools.ts";
import { collectDeploymentReadiness } from "../../../operations/services/hosting/deployment/deployment-readiness.ts";
import { readWorkflowRunJournal } from "../../runs.ts";
import { checkedOutWorkspacePackageRepos, resolveWorkflowSession } from "../../session.ts";
import type { ReleaseInput } from "../../../operations/workflow.ts";
import { WorkflowOperationHelpers, ensureWorkflowWorkspaceLinks, maybeRunLocalWorkflowCleanup, normalizeCiMode, normalizeSceneArtifactsMode, unlinkWorkflowWorkspaceLinks } from '../recovery/workflow-write.ts';
import { resolveProjectRootOrThrow, withContextEnv, workflowError } from '../commerce/catalog/run-release-production-guarantees.ts';
import { buildWorkflowResult, createWorkspacePackageReports, createWorkspaceRootRepoReport, normalizeExecutionMode, singleSelectedWorkflowAppId } from '../support/create-repo-report.ts';
import { checkedOutReleaseHelperRepos, readJsonFile, stageCandidateAttestationBlockers, syncAllCheckedOutReleaseHelperRepos } from '../coordination/staging-candidate-workflow-gates.ts';
import { stringRecord } from '../repositories/gates-for-saved-repository-reports.ts';
import { acquireWorkflowRun, completeWorkflowRun, executeJournalStep, findAutoResumableReleaseRun, prepareFreshReleaseRun, skipJournalStep } from '../packages/prepare-fresh-release-run.ts';
import { buildReleasePlanSnapshot } from '../guarantees/workflow-proof.ts';
import { backMergeProductionIntoStaging, backMergeRootProductionIntoStaging, collectReleaseHelperRepoBlockers, releaseHelperRepoToProduction, releasePlanPackageSelection, releasePlanStableDependencyVersionMap, releasePlanVersionMap } from '../commerce/catalog/back-merge-production-into-staging.ts';
import { collectReleasePlanBlockers } from '../packages/collect-release-plan-blockers.ts';
import { persistProductionReleaseImageRefs, productionReleaseImageRefEnv, productionReleaseImageRefVersions, verifyReleaseApiEnvironmentIsolation } from '../reconciliation/reconcile-save-hosted-environment.ts';
import { hostedDeployGate, waitForWorkflowGates, worktreePayload } from '../packages/normalize-release-candidate-mode.ts';
import { runReleaseGateReconcileFacade } from '../reconciliation/run-release-gate-reconcile-facade.ts';
import { adoptPublishedPackageRelease, applyStableWorkspaceVersionChanges, commitAllIfChanged, ensureReleaseTag, promoteCommitToProductionBranch, updatePackageLockRootVersion, updateReleaseChangelog, versionLines } from '../packages/plan-root-package-version.ts';
import { failWorkflowRun, prepareAdapterReleaseMetadata, productionPackageDeployGates, releaseWorkflowForPackage, runReleaseNpmInstall, tagCommitSha } from '../recovery/fail-workflow-run.ts';
import { createNextSteps, releaseAdminMessage } from '../packages/release-admin-message.ts';
import { verifyPublishedReleaseArtifacts } from '../packages/collect-published-release-artifact-checks.ts';
import { toError } from '../projects/projects-core/connect-market-project.ts';

export async function workflowRelease(helpers: WorkflowOperationHelpers, input: ReleaseInput) {
	try {
		return await withContextEnv(helpers.context.env, async () => {
			const root = workspaceRoot(resolveProjectRootOrThrow('release', helpers.cwd()));
			const session = resolveWorkflowSession(root);
			const executionMode = normalizeExecutionMode(input);
			const rootRepo = createWorkspaceRootRepoReport(root);
			const packageReports = createWorkspacePackageReports(root);
			const releaseHelperRepos = checkedOutReleaseHelperRepos(root);
			const explicitResumeRunId = helpers.context.workflow?.resumeRunId
				?? (input as ReleaseInput & { resumeRunId?: string }).resumeRunId
				?? null;
			const explicitResumeJournal = explicitResumeRunId ? readWorkflowRunJournal(root, explicitResumeRunId) : null;
			const recordedReleasePlan = explicitResumeJournal?.command === 'release'
				? stringRecord(explicitResumeJournal.steps.find((step) => step.id === 'release-plan')?.data)
				: null;
			const autoResumeRun = executionMode === 'execute' && !explicitResumeRunId && input.fresh !== true
				? findAutoResumableReleaseRun(root, session.branchName, rootRepo, packageReports, { archiveStale: false })
				: null;
			const planAutoResumeRun = executionMode === 'plan' && input.fresh !== true
				? findAutoResumableReleaseRun(root, session.branchName, rootRepo, packageReports)
				: null;
			const effectiveInput = autoResumeRun
				? {
					...(autoResumeRun.input as unknown as ReleaseInput), 					ciMode: input.ciMode ?? (autoResumeRun.input as unknown as ReleaseInput).ciMode,
				}
					: input;
			const localCleanup = maybeRunLocalWorkflowCleanup(helpers, root, 'release', effectiveInput);
			const level = effectiveInput.bump ?? 'patch';
			const ciMode = normalizeCiMode(effectiveInput.ciMode, 'release');
			const packageSelection = session.packageSelection;
			const plannedRelease = (recordedReleasePlan ?? buildReleasePlanSnapshot({
				root, 				mode: session.mode, 				level, 				repairVersionLine: effectiveInput.repairVersionLine === true, 				targetVersionLine: effectiveInput.targetVersionLine, 				packageSelection, 				packageReports, 				rootRepo,
				blockers: [],
			})) as ReturnType<typeof buildReleasePlanSnapshot>;
			const selectedPackageNames = releasePlanPackageSelection(plannedRelease.packageSelection).selected;
			const blockers = explicitResumeJournal
				? []
				: collectReleasePlanBlockers(session, session.mode, selectedPackageNames, {
					level, 					repairVersionLine: effectiveInput.repairVersionLine === true,
				});
			if (!explicitResumeJournal) {
				blockers.push(...collectReleaseHelperRepoBlockers(root));
				blockers.push(...stageCandidateAttestationBlockers(root));
			}
			const selectedVersions = releasePlanVersionMap(plannedRelease.plannedVersions);
			const releaseImageVersions = productionReleaseImageRefVersions(root, selectedVersions);
			const releaseImageRefs = productionReleaseImageRefEnv(releaseImageVersions);
			const plannedReadiness = await withContextEnv({ ...helpers.context.env, ...releaseImageRefs }, () =>
				collectDeploymentReadiness({
					tenantRoot: root, 					environment: 'prod', 					appId: singleSelectedWorkflowAppId(plannedRelease.applicationSelection),
				}));
			blockers.push(...plannedReadiness.checks
				.filter((check) => check.status === 'failed')
				.map((check) => `${check.id}: ${check.message}${check.remediation ? ` Remediation: ${check.remediation}` : ''}`));
			plannedRelease.blockers = blockers;
			const releaseBasePayload = {
				...plannedRelease, 				readiness: plannedReadiness, 				ciMode, 				level, 				fresh: input.fresh === true, 				sceneArtifacts: normalizeSceneArtifactsMode(effectiveInput.sceneArtifacts), 				releaseImageRefs, 				localCleanup,
				releaseHelperRepos: releaseHelperRepos.map((repo) => ({
					name: repo.name, 					kind: repo.kind, 					path: repo.relativeDir, 					remote: repo.remoteUrl,
				})),
				freshArchivedRuns: [],
				autoResumeCandidate: planAutoResumeRun
					? {
						runId: planAutoResumeRun.runId, 						branch: planAutoResumeRun.session.branchName, 						failure: planAutoResumeRun.failure,
					}
					: null, 				...worktreePayload(root, effectiveInput.worktreeMode),
			};
			if (executionMode === 'plan') {
				return runReleaseGateReconcileFacade(
					'release', 					helpers, 					root,
					{ kind: 'persistent', scope: 'prod' },
					{
						plan: true, 						verifyDeployedResources: effectiveInput.verifyDeployedResources, 						releaseImageRefs,
					},
					releaseBasePayload,
				);
			}
			if (blockers.length > 0) {
				workflowError('release', 'validation_failed', `Treeseed release cannot continue until blockers are resolved:\n${blockers.join('\n')}`, {
					details: { blockers, releasePlan: plannedRelease },
				});
			}
			const freshPreparation = input.fresh === true
				? prepareFreshReleaseRun(root, session.branchName, rootRepo, packageReports)
				: { archived: [], blockers: [] };
			const stableVersions = new Map([
				...releasePlanStableDependencyVersionMap(plannedRelease).entries(), 				...selectedVersions.entries(),
			]);
			const allVersions = new Map([
				['@treeseed/market', plannedRelease.rootVersion],
				...stableVersions.entries(),
			]);
			const selectedPackageSet = new Set(selectedPackageNames);
			const workflowRun = acquireWorkflowRun(
				'release', 				session,
				{
					...effectiveInput, 					bump: level, 					ciMode, 					fresh: input.fresh === true,
				} as Record<string, unknown>,
				[
					{ id: 'release-plan', description: 'Record immutable release plan and target versions', repoName: rootRepo.name, repoPath: rootRepo.path, branch: STAGING_BRANCH, resumable: true },
					{ id: 'release-gates', description: 'Run production release gates against staging evidence', repoName: rootRepo.name, repoPath: rootRepo.path, branch: STAGING_BRANCH, resumable: true },
					{ id: 'workspace-unlink', description: 'Remove local workspace links before stable release metadata', repoName: rootRepo.name, repoPath: rootRepo.path, branch: STAGING_BRANCH, resumable: true },
					{ id: 'prepare-release-metadata', description: 'Rewrite package metadata and lockfiles to production dependency mode', repoName: rootRepo.name, repoPath: rootRepo.path, branch: STAGING_BRANCH, resumable: true },
					...selectedPackageNames.map((name) => {
						const report = packageReports.find((entry) => entry.name === name);
						return {
							id: `release-${name}`,
							description: `Release ${name} ${selectedVersions.get(name) ?? '(planned)'}`,
							repoName: name, 							repoPath: report?.path ?? root, 							branch: STAGING_BRANCH, 							resumable: true,
						};
					}),
					{
						id: 'release-helper-repos', 						description: 'Promote starter templates and shared fixture repositories from staging to production', 						repoName: rootRepo.name, 						repoPath: rootRepo.path, 						branch: STAGING_BRANCH, 						resumable: true,
					},
					{ id: 'verify-published-artifacts', description: 'Verify immutable registry artifacts exist after publish workflows', repoName: rootRepo.name, repoPath: rootRepo.path, branch: PRODUCTION_BRANCH, resumable: true },
					{ id: 'production-package-deploy-workflows', description: 'Wait for production package deploy workflows before live verification', repoName: rootRepo.name, repoPath: rootRepo.path, branch: PRODUCTION_BRANCH, resumable: true },
					{ id: 'verify-api-environment-isolation', description: 'Verify production images and staging Git sources remained isolated', repoName: rootRepo.name, repoPath: rootRepo.path, branch: PRODUCTION_BRANCH, resumable: true },
					{ id: 'persist-production-image-refs', description: 'Persist released production image refs and verify deployment readiness', repoName: rootRepo.name, repoPath: rootRepo.path, branch: PRODUCTION_BRANCH, resumable: true },
					{ id: 'release-root', description: `Release market ${plannedRelease.rootVersion}`, repoName: rootRepo.name, repoPath: rootRepo.path, branch: STAGING_BRANCH, resumable: true },
					{ id: 'publish-wait', description: 'Wait for production release workflows', repoName: rootRepo.name, repoPath: rootRepo.path, branch: PRODUCTION_BRANCH, resumable: true },
					{ id: 'release-back-merge', description: 'Back-merge production release history into staging', repoName: rootRepo.name, repoPath: rootRepo.path, branch: STAGING_BRANCH, resumable: true },
					{ id: 'workspace-link', description: 'Restore local workspace links after release', repoName: rootRepo.name, repoPath: rootRepo.path, branch: STAGING_BRANCH, resumable: true },
				],
				explicitResumeRunId
					? {
						...helpers.context,
						workflow: {
							...(helpers.context.workflow ?? {}),
							resumeRunId: explicitResumeRunId,
						},
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
				helpers.write(`[workflow][resume] Resuming interrupted release ${autoResumeRun.runId}.`);
			}
			try {
				const releasePlan = await executeJournalStep(root, workflowRun.runId, 'release-plan', () => ({
					...releaseBasePayload, 					freshArchivedRuns: freshPreparation.archived,
				}));
				const releaseGates = await executeJournalStep(root, workflowRun.runId, 'release-gates', async () => {
					const workspaceLinks = ensureWorkflowWorkspaceLinks(root, helpers, effectiveInput.workspaceLinks ?? 'auto');
					const gates = await runReleaseGateReconcileFacade(
						'release', 						helpers, 						root,
						{ kind: 'persistent', scope: 'prod' },
						{
							execute: true, 							verifyDeployedResources: effectiveInput.verifyDeployedResources, 							releaseImageRefs,
						},
						{
							...releaseBasePayload, 							freshArchivedRuns: freshPreparation.archived,
						},
					) as unknown as Record<string, unknown>;
					return { workspaceLinks, gates };
				});
				const workspaceUnlink = await executeJournalStep(root, workflowRun.runId, 'workspace-unlink', () =>
					unlinkWorkflowWorkspaceLinks(root, helpers, effectiveInput.workspaceLinks ?? 'auto'));
				const releaseMetadata = await executeJournalStep(root, workflowRun.runId, 'prepare-release-metadata', () => {
					applyStableWorkspaceVersionChanges(root, allVersions, selectedPackageSet);
					const adapterMetadata = checkedOutWorkspacePackageRepos(root)
						.filter((pkg) => selectedPackageSet.has(pkg.name))
						.map((pkg) => ({
							name: pkg.name, 							version: selectedVersions.get(pkg.name) ?? null,
							result: selectedVersions.has(pkg.name)
								? { status: 'pending-package-release-step' }
								: { status: 'skipped', reason: 'no planned version' },
						}));
					const rootPackageLock = updatePackageLockRootVersion(root, plannedRelease.rootVersion);
					const remainingDevReferences = collectInternalDevReferenceIssues(root, selectedPackageSet, selectedPackageSet)
						.filter((issue) => !issue.reason.startsWith('lockfile-'));
					if (remainingDevReferences.length > 0) {
						const rendered = remainingDevReferences
							.map((issue) => `${issue.repoName}: ${issue.filePath} ${issue.dependencyName ?? ''} ${issue.reason} ${issue.spec}`)
							.join('\n');
						throw new Error(`Stable release metadata still contains development references.\n${rendered}`);
					}
					return {
						versions: Object.fromEntries(allVersions.entries()), 						adapterMetadata, 						rootPackageLock, 						workspaceUnlink,
					};
				});
				const packageReleases: Array<Record<string, unknown>> = [];
				const packageRepoByName = new Map(checkedOutWorkspacePackageRepos(root).map((entry) => [entry.name, entry]));
				const pendingPackageReleases = new Set(selectedPackageNames.filter((name) => selectedVersions.has(name) && packageRepoByName.has(name)));
				const completedPackageReleases = new Set<string>();
				const packageReleaseResults = new Map<string, Record<string, unknown>>();
					const selectedPackageDependencies = new Map([...pendingPackageReleases].map((packageName) => {
					const pkg = packageRepoByName.get(packageName);
					if (!pkg) return [packageName, []] as const;
					const manifest = readJsonFile<Record<string, any>>(resolve(pkg.dir, 'package.json'));
					if (!manifest) {
						throw new Error(`Release package manifest is missing or invalid for ${packageName}.`);
					}
					const dependencyNames = new Set([
						...Object.keys(manifest.dependencies ?? {}),
						...Object.keys(manifest.optionalDependencies ?? {}),
						...Object.keys(manifest.peerDependencies ?? {}),
					]);
						const dependencies = [...dependencyNames].filter((name) => pendingPackageReleases.has(name));
						if (packageName !== '@treeseed/sdk' && pendingPackageReleases.has('@treeseed/sdk') && !dependencies.includes('@treeseed/sdk')) {
							dependencies.push('@treeseed/sdk');
						}
						if (packageName === '@treeseed/api' && pendingPackageReleases.has('@treeseed/cli') && !dependencies.includes('@treeseed/cli')) {
							dependencies.push('@treeseed/cli');
						}
						return [packageName, dependencies] as const;
					}));
				while (pendingPackageReleases.size > 0) {
					const eligible = selectedPackageNames.filter((packageName) =>
						pendingPackageReleases.has(packageName)
						&& (selectedPackageDependencies.get(packageName) ?? []).every((dependency) => completedPackageReleases.has(dependency)));
					if (eligible.length === 0) {
						throw new Error(`Release package dependency graph is cyclic or unresolved: ${[...pendingPackageReleases].join(', ')}.`);
					}
					const batch = eligible.slice(0, 2);
					helpers.write(`[release][packages] starting batch ${batch.join(', ')} (concurrency=${batch.length}/2).`, 'stderr');
					const results = await Promise.all(batch.map(async (packageName) => {
						const pkg = packageRepoByName.get(packageName)!;
						const version = selectedVersions.get(pkg.name)!;
						const packageRelease = await executeJournalStep(root, workflowRun.runId, `release-${pkg.name}`, async () => {
							const adopted = await adoptPublishedPackageRelease(pkg, version);
							if (adopted) {
								helpers.write(`[release][packages] adopted verified published release ${pkg.name}@${version}.`, 'stderr');
								if (pkg.name === '@treeseed/api') {
									const publishWait = await waitForWorkflowGates('release', [{
										name: pkg.name, 										repoPath: pkg.dir, 										workflow: releaseWorkflowForPackage(root, pkg.name), 										branch: version, 										headSha: String(stringRecord(adopted.commit)?.commitSha ?? tagCommitSha(pkg.dir, version)),
									}], ciMode, {
										root, 										runId: workflowRun.runId, 										onProgress: (line, stream) => helpers.write(line, stream), 										retryFailedOnce: true,
									});
									return { ...adopted, publishWait };
								}
								return adopted;
							}
							const metadata = await prepareAdapterReleaseMetadata(root, pkg, version);
						const changelog = updateReleaseChangelog(pkg.dir, {
							version,
							sourceRef: `origin/${PRODUCTION_BRANCH}`,
							targetRef: 'HEAD',
						});
						const commit = commitAllIfChanged(pkg.dir, releaseAdminMessage({
							subject: `release: ${pkg.name} ${version}`,
							version, 							tagName: version, 							sourceRef: STAGING_BRANCH, 							targetRef: PRODUCTION_BRANCH, 							changelog,
						}));
						pushBranch(pkg.dir, STAGING_BRANCH);
						const promotion = promoteCommitToProductionBranch(pkg.dir, commit.commitSha);
						const tag = ensureReleaseTag(pkg.dir, version, commit.commitSha, `release: ${pkg.name} ${version}`);
						const publishGate = {
							name: pkg.name, 							repoPath: pkg.dir, 							workflow: releaseWorkflowForPackage(root, pkg.name), 							branch: version, 							headSha: commit.commitSha,
						};
						const publishWait = await waitForWorkflowGates('release', [publishGate], ciMode, {
							root, 							runId: workflowRun.runId, 							onProgress: (line, stream) => helpers.write(line, stream),
						});
						const publishedArtifacts = await verifyPublishedReleaseArtifacts(new Map([[pkg.name, version]]));
						return {
							name: pkg.name, 							path: relative(root, pkg.dir), 							version, 							changelog, 							metadata, 							commit, 							promotion, 							tag, 							publishWait, 							publishedArtifacts,
						};
					});
						return [packageName, packageRelease] as const;
					}));
					for (const [packageName, packageRelease] of results) {
						pendingPackageReleases.delete(packageName);
						completedPackageReleases.add(packageName);
						packageReleaseResults.set(packageName, packageRelease);
					}
				}
				packageReleases.push(...selectedPackageNames
					.map((name) => packageReleaseResults.get(name))
					.filter((entry): entry is Record<string, unknown> => Boolean(entry)));
				const managedHelperReleases = await executeJournalStep(root, workflowRun.runId, 'release-helper-repos', () => {
					const releases = releaseHelperRepos.map((repo) => releaseHelperRepoToProduction(repo));
					syncAllCheckedOutReleaseHelperRepos(root, STAGING_BRANCH);
					return { status: 'completed', repos: releases };
				});
				const publishedArtifacts = await executeJournalStep(root, workflowRun.runId, 'verify-published-artifacts', () =>
					verifyPublishedReleaseArtifacts(selectedVersions));
				const productionPackageDeployWorkflows = await executeJournalStep(root, workflowRun.runId, 'production-package-deploy-workflows', () => {
					const deployGates = productionPackageDeployGates(root, allVersions);
					if (deployGates.length === 0) {
						return { workflowGates: [], status: 'skipped', reason: 'no selected production package deploy workflows' };
					}
					return waitForWorkflowGates('release', deployGates, ciMode, {
						root, 						runId: workflowRun.runId, 						onProgress: (line, stream) => helpers.write(line, stream),
					}).then((workflowGates) => ({ workflowGates }));
				});
				const apiEnvironmentIsolation = effectiveInput.verifyDeployedResources === true
					? await executeJournalStep(root, workflowRun.runId, 'verify-api-environment-isolation', () =>
						verifyReleaseApiEnvironmentIsolation(root, helpers, releaseImageRefs))
					: (skipJournalStep(root, workflowRun.runId, 'verify-api-environment-isolation', {
						status: 'skipped', 						reason: '--verify-deployed-resources was not requested',
					}), { status: 'skipped', reason: '--verify-deployed-resources was not requested' });
				const productionImageRefs = await executeJournalStep(root, workflowRun.runId, 'persist-production-image-refs', async () => {
					const persisted = persistProductionReleaseImageRefs(root, releaseImageRefs);
					if (helpers.context.env) {
						Object.assign(helpers.context.env, persisted);
						Object.assign(process.env, persisted);
					}
					const readiness = await withContextEnv(persisted, () => collectDeploymentReadiness({
						tenantRoot: root, 						environment: 'prod', 						appId: singleSelectedWorkflowAppId(plannedRelease.applicationSelection),
					}));
					const failures = readiness.checks
						.filter((check) => check.status === 'failed')
						.map((check) => `${check.id}: ${check.message}${check.remediation ? ` Remediation: ${check.remediation}` : ''}`);
					if (failures.length > 0) {
						workflowError('release', 'hosted_live_verification_failed', `Production readiness failed after persisting released image refs:\n${failures.join('\n')}`, {
							details: { releaseImageRefs: persisted, readiness },
						});
					}
					return { persisted, readiness };
				});
				const rootRelease = await executeJournalStep(root, workflowRun.runId, 'release-root', async () => {
					const rootInstall = await runReleaseNpmInstall(root, { workspaceRoot: root });
					const changelog = updateReleaseChangelog(repoRoot(root), {
						version: plannedRelease.rootVersion,
						sourceRef: `origin/${PRODUCTION_BRANCH}`,
						targetRef: 'HEAD', 						extraDependencyBullets: versionLines(stableVersions),
					});
					const commit = commitAllIfChanged(repoRoot(root), releaseAdminMessage({
						subject: `release: market ${plannedRelease.rootVersion}`,
						version: plannedRelease.rootVersion, 						tagName: plannedRelease.releaseTag, 						sourceRef: STAGING_BRANCH, 						targetRef: PRODUCTION_BRANCH, 						changelog,
						extraLines: versionLines(stableVersions).map((line) => `Released package ${line}`),
					}));
					pushBranch(repoRoot(root), STAGING_BRANCH);
					const promotion = promoteCommitToProductionBranch(repoRoot(root), commit.commitSha);
					const tag = ensureReleaseTag(repoRoot(root), plannedRelease.releaseTag, commit.commitSha, `release: market ${plannedRelease.rootVersion}`);
					return {
						name: '@treeseed/market', 						version: plannedRelease.rootVersion, 						releaseTag: plannedRelease.releaseTag, 						changelog, 						rootInstall, 						commit, 						promotion, 						tag,
					};
				});
				const publishGates = [
					hostedDeployGate({
						name: '@treeseed/market', 						repoPath: repoRoot(root), 						workflow: 'deploy.yml', 						branch: plannedRelease.releaseTag,
						headSha: String((rootRelease.commit as { commitSha?: string }).commitSha ?? ''),
					}),
				].filter((gate) => gate.headSha);
				const publishWait = await executeJournalStep(root, workflowRun.runId, 'publish-wait', () =>
					waitForWorkflowGates('release', publishGates, ciMode, {
						root, 						runId: workflowRun.runId, 						onProgress: (line, stream) => helpers.write(line, stream),
					}).then((workflowGates) => ({ workflowGates })));
				const backMerge = await executeJournalStep(root, workflowRun.runId, 'release-back-merge', () => {
					const packageBackMerges = selectedPackageNames
						.map((name) => packageRepoByName.get(name))
						.filter((pkg): pkg is NonNullable<typeof pkg> => Boolean(pkg))
						.map((pkg) => backMergeProductionIntoStaging(pkg.dir, pkg.name, releaseAdminMessage({
							subject: `release: back-merge ${PRODUCTION_BRANCH} into ${STAGING_BRANCH}`,
							version: selectedVersions.get(pkg.name) ?? null, 							sourceRef: PRODUCTION_BRANCH, 							targetRef: STAGING_BRANCH,
						})));
					const rootBackMerge = backMergeRootProductionIntoStaging(root, true, {
						version: plannedRelease.rootVersion, 						selectedVersions: stableVersions,
					});
					return { packages: packageBackMerges, root: rootBackMerge };
				});
				const workspaceLinks = await executeJournalStep(root, workflowRun.runId, 'workspace-link', () =>
					ensureWorkflowWorkspaceLinks(root, helpers, effectiveInput.workspaceLinks ?? 'auto'));
				const payload = {
					...releaseBasePayload, 					mode: plannedRelease.mode, 					runId: workflowRun.runId, 					releasePlan, 					releaseGates, 					workspaceUnlink, 					releaseMetadata, 					packageReleases, 					managedHelperReleases, 					rootRelease, 					publishWait: publishWait.workflowGates, 					publishedArtifacts, 					productionPackageDeployWorkflows, 					apiEnvironmentIsolation, 					productionImageRefs, 					backMerge, 					workspaceLinks,
					releasedCommit: String((rootRelease.commit as { commitSha?: string }).commitSha ?? ''),
					touchedPackages: selectedPackageNames, 					finalBranch: STAGING_BRANCH,
				};
				completeWorkflowRun(root, workflowRun.runId, payload);
				return buildWorkflowResult('release', root, payload, {
					runId: workflowRun.runId, 					summary: 'Treeseed production release completed successfully.',
					nextSteps: createNextSteps([
						{ operation: 'status', reason: 'Inspect release state after production promotion.' },
					]),
				});
			} catch (error) {
				try {
					ensureWorkflowWorkspaceLinks(root, helpers, effectiveInput.workspaceLinks ?? 'auto');
				} catch {
					// Preserve the original release failure.
				}
				failWorkflowRun(root, workflowRun.runId, error, {
					resumable: true, 					runId: workflowRun.runId, 					command: 'release', 					message: 'Resume the interrupted production release after fixing the cause.', 					recoverCommand: 'treeseed recover',
					resumeCommand: `treeseed resume ${workflowRun.runId}`,
				});
				throw error;
			}
		});
	} catch (error) {
		toError('release', error);
	}
}
