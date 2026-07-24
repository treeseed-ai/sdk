import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkoutBranch } from "../../../operations/services/operations/git-workflow.ts";
import { currentBranch, repoRoot } from "../../../operations/services/treedx/workspaces/workspace-save.ts";
import { type RepositorySaveReport } from "../../../operations/services/repositories/repository-save-orchestrator.ts";
import { discoverPackageAdapters } from "../../../operations/services/reconciliation/package-adapters.ts";
import { type WorkspaceLinksMode } from "../../../operations/services/treedx/workspaces/workspace-dependency-mode.ts";
import { archiveWorkflowRun, classifyWorkflowRunJournal, listInterruptedWorkflowRuns, type WorkflowRunJournal } from "../../runs.ts";
import { checkedOutWorkspacePackageRepos } from "../../session.ts";
import { DiscoveredPackageAdapter, hostedWorkflowsForSavedRepository } from '../projects/projects-core/connect-market-project.ts';
import { WorkflowOperationHelpers, ensureWorkflowWorkspaceLinks, runGit } from '../recovery/workflow-write.ts';
import { WorkflowRepoReport, workflowError } from '../commerce/catalog/run-release-production-guarantees.ts';

export function gatesForSavedRepositoryReports(root: string, reports: RepositorySaveReport[]) {
	const adapterByPath = new Map(discoverPackageAdapters(root).map((adapter) => [resolve(adapter.dir), adapter]));
	return reports
		.filter((repo) => repo.pushed && repo.commitSha && repo.branch && (repo.committed || repo.tagName))
		.flatMap((repo) => {
			const adapter = adapterByPath.get(resolve(repo.path));
			return hostedWorkflowsForSavedRepository(root, repo, adapter).map((workflow) => {
				const gate = {
					name: repo.name, 					repoPath: repo.path, 					workflow, 					branch: String(repo.branch), 					headSha: String(repo.commitSha),
					...(packageHostedVerifyTimeoutSeconds(adapter) ? { timeoutSeconds: packageHostedVerifyTimeoutSeconds(adapter) } : {}),
				};
				return gate;
			});
		});
}

export function packageHostedVerifyWorkflow(adapter: DiscoveredPackageAdapter | undefined) {
	const workflow = adapter?.metadata?.hostedVerifyWorkflow;
	return typeof workflow === 'string' && workflow.trim()
		? workflow.trim().replace(/^\.github\/workflows\//u, '')
		: null;
}

export function packageHostedVerifyTimeoutSeconds(adapter: DiscoveredPackageAdapter | undefined) {
	const timeoutSeconds = adapter?.metadata?.hostedVerifyTimeoutSeconds;
	return typeof timeoutSeconds === 'number' && Number.isFinite(timeoutSeconds) && timeoutSeconds > 0
		? Math.floor(timeoutSeconds)
		: null;
}

export function gateForSavedRootReport(report: RepositorySaveReport, branch: string | null, scope: string) {
	if (!branch || scope === 'local' || !report.pushed || !report.commitSha) {
		return [];
	}
	return [{
		name: report.name,
		repoPath: report.path,
		workflow: 'verify.yml',
		branch,
		headSha: report.commitSha,
	}];
}

export function findAutoResumableTaskRun(root: string, command: 'stage' | 'close', branch: string | null) {
	if (!branch) return null;
	const currentHeads = Object.fromEntries([
		['@treeseed/market', runGit(['rev-parse', 'HEAD'], { cwd: repoRoot(root), capture: true }).trim()],
		...checkedOutWorkspacePackageRepos(root).map((repo) => [
			repo.name,
			runGit(['rev-parse', 'HEAD'], { cwd: repo.dir, capture: true }).trim(),
		] as const),
	]);
	return listInterruptedWorkflowRuns(root).find((journal) => {
		if (journal.command !== command || !journal.resumable || journal.session.branchName !== branch) {
			return false;
		}
		const classification = classifyWorkflowRunJournal(journal, {
			currentBranch: branch, 			currentHeads,
		});
		if (classification.state === 'resumable') {
			return true;
		}
		if (classification.state === 'stale') {
			archiveWorkflowRun(root, journal.runId, {
				...classification,
				reasons: [`${command} implicit resume skipped stale failed run`, ...classification.reasons],
			});
		}
		return false;
	}) ?? null;
}

export function rejectImplicitWorkflowResume(
	operation: 'save' | 'stage' | 'close',
	journal: WorkflowRunJournal | null,
) {
	if (!journal) return;
	workflowError(operation, 'resume_unavailable',
		`Treeseed ${operation} found interrupted run ${journal.runId} for this branch and will not auto-resume recorded inputs. `
		+ `Run \`trsd resume ${journal.runId}\` to continue it, or \`trsd recover --obsolete ${journal.runId} --reason "superseded by a fresh ${operation}"\` before starting a new ${operation}.`, {
			details: {
				recovery: {
					resumable: true, 					runId: journal.runId,
					resumeCommand: `trsd resume ${journal.runId}`,
					obsoleteCommand: `trsd recover --obsolete ${journal.runId} --reason "superseded by a fresh ${operation}"`,
				},
			},
		});
}

export function stringRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}

export function releasePlanHead(plan: Record<string, unknown>, repoName: string) {
	if (repoName === '@treeseed/market') {
		const rootRepo = stringRecord(plan.rootRepo);
		return typeof rootRepo?.commitSha === 'string' ? rootRepo.commitSha : null;
	}
	const repos = Array.isArray(plan.repos) ? plan.repos : [];
	for (const repo of repos) {
		const record = stringRecord(repo);
		if (record?.name === repoName) {
			return typeof record.commitSha === 'string' ? record.commitSha : null;
		}
	}
	return null;
}

export function releasePlanMatchesCurrentHeads(plan: Record<string, unknown>, rootRepo: WorkflowRepoReport, packageReports: WorkflowRepoReport[]) {
	if (releasePlanHead(plan, rootRepo.name) !== rootRepo.commitSha) {
		return false;
	}
	const packageSelection = stringRecord(plan.packageSelection);
	const selected = Array.isArray(packageSelection?.selected)
		? packageSelection.selected.filter((name): name is string => typeof name === 'string')
		: packageReports.map((report) => report.name);
	for (const name of selected) {
		const current = packageReports.find((report) => report.name === name);
		if (!current || releasePlanHead(plan, name) !== current.commitSha) {
			return false;
		}
	}
	return true;
}

export function releaseRunHasCompletedMutation(journal: WorkflowRunJournal) {
	return journal.steps.some((step) =>
		step.status === 'completed'
		&& step.id !== 'release-plan'
		&& step.id !== 'workspace-unlink');
}

export type ReleaseCleanupRepoSnapshot = {
	name: string;
	path: string;
	branch: string | null;
	files: string[];
};

export type ReleaseCleanupSnapshot = {
	repos: ReleaseCleanupRepoSnapshot[];
};

export function generatedReleaseMetadataFiles(repoDir: string) {
	return ['package.json', 'package-lock.json', 'npm-shrinkwrap.json']
		.filter((filePath) => {
			if (existsSync(resolve(repoDir, filePath))) return true;
			try {
				runGit(['ls-files', '--error-unmatch', filePath], { cwd: repoDir, capture: true });
				return true;
			} catch {
				return false;
			}
		});
}

export function collectReleaseCleanupSnapshot(root: string, selectedPackageNames: Set<string>): ReleaseCleanupSnapshot {
	return {
		repos: [
			{
				name: '@treeseed/market', 				path: repoRoot(root), 				branch: currentBranch(repoRoot(root)) || null, 				files: generatedReleaseMetadataFiles(repoRoot(root)),
			},
			...checkedOutWorkspacePackageRepos(root)
				.filter((pkg) => selectedPackageNames.has(pkg.name))
				.map((pkg) => ({
					name: pkg.name, 					path: pkg.dir, 					branch: currentBranch(pkg.dir) || null, 					files: generatedReleaseMetadataFiles(pkg.dir),
				})),
		],
	};
}

export function restoreReleaseGeneratedMetadata(repo: ReleaseCleanupRepoSnapshot) {
	const restored: string[] = [];
	const skipped: string[] = [];
	for (const filePath of repo.files) {
		const status = runGit(['status', '--porcelain', '--', filePath], { cwd: repo.path, capture: true });
		if (!status.trim()) {
			skipped.push(filePath);
			continue;
		}
		runGit(['restore', '--staged', '--worktree', '--', filePath], { cwd: repo.path, capture: true });
		restored.push(filePath);
	}
	return { restored, skipped };
}

export function cleanupFailedReleaseLocalState(
	root: string,
	helpers: WorkflowOperationHelpers,
	snapshot: ReleaseCleanupSnapshot | null,
	workspaceLinksMode: WorkspaceLinksMode | undefined,
) {
	const report: {
		restored: Array<Record<string, unknown>>;
		skipped: Array<Record<string, unknown>>;
		manualReview: Array<Record<string, unknown>>;
	} = { restored: [], skipped: [], manualReview: [] };
	try {
		ensureWorkflowWorkspaceLinks(root, helpers, workspaceLinksMode ?? 'auto');
	} catch (error) {
		report.manualReview.push({
			scope: 'workspace-links', 			reason: error instanceof Error ? error.message : String(error),
		});
	}
	if (!snapshot) {
		report.skipped.push({ scope: 'release-metadata', reason: 'cleanup snapshot was not recorded before failure' });
		return report;
	}
	for (const repo of snapshot.repos) {
		try {
			const restored = restoreReleaseGeneratedMetadata(repo);
			if (repo.branch && currentBranch(repo.path) !== repo.branch) {
				checkoutBranch(repo.path, repo.branch);
			}
			if (restored.restored.length > 0) {
				report.restored.push({ repo: repo.name, path: repo.path, files: restored.restored });
			}
			if (restored.skipped.length > 0) {
				report.skipped.push({ repo: repo.name, path: repo.path, files: restored.skipped, reason: 'unchanged' });
			}
		} catch (error) {
			report.manualReview.push({
				repo: repo.name, 				path: repo.path, 				branch: repo.branch, 				files: repo.files, 				reason: error instanceof Error ? error.message : String(error),
				nextCommand: repo.branch ? `git -C ${repo.path} restore --staged --worktree -- ${repo.files.join(' ')} && git -C ${repo.path} checkout ${repo.branch}` : null,
			});
		}
	}
	return report;
}
