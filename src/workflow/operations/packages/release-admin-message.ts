import { resolve } from 'node:path';
import { createBranchPreviewDeployTarget, loadDeployState } from "../../../operations/services/hosting/deployment/deploy.ts";
import { gitWorkflowRoot, headCommit, listTaskBranches, PRODUCTION_BRANCH, STAGING_BRANCH } from "../../../operations/services/operations/git-workflow.ts";
import { resolveGitHubRepositorySlug } from "../../../operations/services/repositories/github-automation.ts";
import { inspectGitHubActionsVerification, type GitHubActionsVerificationTarget } from "../../../operations/services/repositories/github-actions-verification.ts";
import { hostedWorkflowForPackage } from "../../../operations/services/guarantees/release-proof-planner.ts";
import { renderAdministrativeCommitMessage, type ReleaseHistoryCommit, type ReleaseHistorySummary } from "../../../operations/services/packages/release-history.ts";
import { loadPlatformConfig } from "../../../platform/configuration/config.ts";
import { gitStatusPorcelain } from "../../../operations/services/treedx/workspaces/workspace-save.ts";
import { discoverPackageAdapters } from "../../../operations/services/reconciliation/package-adapters.ts";
import { workspaceRoot } from "../../../operations/services/treedx/workspaces/workspace-tools.ts";
import { resolveWorkflowState, type WorkflowStatusOptions } from "../../../operations/workflow-state.ts";
import { readWorkflowRunJournal } from "../../runs.ts";
import { checkedOutWorkspacePackageRepos, resolveWorkflowSession, type WorkflowSession } from "../../session.ts";
import type { CiInput, TaskBranchMetadata, WorkflowNextStep, WorkflowResult } from "../../../operations/workflow.ts";
import { stringRecord } from '../repositories/gates-for-saved-repository-reports.ts';
import { ageDays, renderWorkflowStep } from '../commerce/catalog/run-release-production-guarantees.ts';
import { buildWorkflowResult, submodulePointerForRef } from '../support/create-repo-report.ts';

export function releaseAdminMessage(input: {
	subject: string;
	version?: string | null;
	tagName?: string | null;
	sourceRef?: string;
	targetRef?: string;
	commits?: ReleaseHistoryCommit[];
	changelog?: ReleaseHistorySummary | null;
	extraLines?: string[];
}) {
	return renderAdministrativeCommitMessage({
		subject: input.subject,
		version: input.version,
		tagName: input.tagName,
		sourceRef: input.sourceRef ?? STAGING_BRANCH,
		targetRef: input.targetRef ?? PRODUCTION_BRANCH,
		commits: input.commits ?? [],
		changelog: input.changelog ?? null,
		extraLines: input.extraLines,
	});
}

export function completedJournalStepData(root: string, runId: string, stepId: string) {
	const journal = readWorkflowRunJournal(root, runId);
	return stringRecord(journal?.steps.find((step) => step.id === stepId && step.status === 'completed')?.data);
}

export function shouldResumeReleaseAtRootGates(root: string, runId: string) {
	const journal = readWorkflowRunJournal(root, runId);
	if (!journal || journal.command !== 'release') return false;
	const rootStep = journal.steps.find((step) => step.id === 'release-root');
	const gateStep = journal.steps.find((step) => step.id === 'release-root-gates');
	return rootStep?.status === 'completed' && gateStep?.status !== 'completed';
}

export function createNextSteps(steps: WorkflowNextStep[]) {
	return steps.map(renderWorkflowStep);
}

export function createStatusResult(cwd: string, options: WorkflowStatusOptions = {}): WorkflowResult<ReturnType<typeof resolveWorkflowState>> {
	const state = resolveWorkflowState(cwd, options);
	return buildWorkflowResult('status', cwd, state, {
		nextSteps: createNextSteps(state.recommendations),
		includeFinalState: false,
	});
}

export function normalizeCiScope(value: CiInput['scope']): 'workspace' | 'root' | 'packages' {
	return value === 'root' || value === 'packages' ? value : 'workspace';
}

export function normalizeCiLogLines(value: CiInput['logLines']) {
	const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseInt(value, 10) : 120;
	return Number.isFinite(parsed) ? Math.max(20, Math.min(1000, Math.floor(parsed))) : 120;
}

export function normalizeCiWorkflows(input: CiInput) {
	const raw = input.workflows ?? input.workflow ?? [];
	return (Array.isArray(raw) ? raw : [raw])
		.map((workflow) => String(workflow ?? '').trim())
		.filter(Boolean);
}

export function defaultCiWorkflows(_kind: 'root' | 'package', _branch: string | null) {
	return ['verify.yml'];
}

export function packageCiWorkflowsForRepo(repoDir: string) {
	const adapters = discoverPackageAdapters(workspaceRoot(repoDir));
	const adapter = adapters.find((candidate) => resolve(candidate.dir) === resolve(repoDir));
	return adapter ? [hostedWorkflowForPackage(adapter)] : null;
}

export function githubRepositoryForRepo(repoDir: string) {
	try {
		return resolveGitHubRepositorySlug(repoDir);
	} catch {
		return null;
	}
}

export function ciTargetForRepo(
	repo: { name: string; path: string; branchName: string | null },
	kind: 'root' | 'package',
	input: CiInput,
	workflowOverrides: string[],
): GitHubActionsVerificationTarget {
	const branch = typeof input.branch === 'string' && input.branch.trim() ? input.branch.trim() : repo.branchName;
	const workflows = workflowOverrides.length > 0
		? workflowOverrides
		: kind === 'package'
			? packageCiWorkflowsForRepo(repo.path) ?? defaultCiWorkflows(kind, branch)
			: defaultCiWorkflows(kind, branch);
	return {
		name: repo.name,
		repoPath: repo.path,
		repository: githubRepositoryForRepo(repo.path),
		branch,
		headSha: branch ? headCommit(repo.path) : null,
		workflows,
		kind,
	};
}

export function ciTargetsForSession(session: WorkflowSession, input: CiInput) {
	const scope = normalizeCiScope(input.scope);
	const workflows = normalizeCiWorkflows(input);
	const targets: GitHubActionsVerificationTarget[] = [];
	if (scope === 'workspace' || scope === 'root') {
		targets.push(ciTargetForRepo(session.rootRepo, 'root', input, workflows));
	}
	if (scope === 'workspace' || scope === 'packages') {
		targets.push(...session.packageRepos.map((repo) => ciTargetForRepo(repo, 'package', input, workflows)));
	}
	return { scope, targets };
}

export async function createCiResult(cwd: string, input: CiInput): Promise<WorkflowResult<CiResult>> {
	const session = resolveWorkflowSession(cwd);
	const { scope, targets } = ciTargetsForSession(session, input);
	const strict = input.strict === true;
	const includeLogs = input.logs === true || input.includeLogs === true;
	const report = await inspectGitHubActionsVerification(targets, {
		includeLogs,
		logLines: normalizeCiLogLines(input.logLines),
	});
	const hasFailures = report.failures.length > 0;
	const hasPending = report.summary.pending > 0;
	const exitCode = hasFailures || (strict && hasPending) ? 1 : 0;
	const payload: CiResult = {
		...report,
		mode: session.mode,
		branch: typeof input.branch === 'string' && input.branch.trim() ? input.branch.trim() : session.branchName,
		scope,
		strict,
		hasFailures,
		hasPending,
		exitCode,
	};
	return buildWorkflowResult('ci', cwd, payload, {
		includeFinalState: false,
		summary: hasFailures
			? 'Treeseed CI found remote GitHub Actions failures.'
			: strict && hasPending
				? 'Treeseed CI found pending remote GitHub Actions runs.'
				: 'Treeseed CI status is clear.',
	});
}

export function createTasksResult(cwd: string): WorkflowResult<{ tasks: TaskBranchMetadata[]; workstreams: Array<{
	id: string;
	title: string;
	linkedDirectRefs: Array<{ model: 'objective' | 'question' | 'note'; id: string }>;
	branch: string;
	local: boolean;
	remote: boolean;
	current: boolean;
	previewUrl: string | null;
	lastSaveAt: string | null;
	verificationResult: 'ready' | 'needs_attention' | 'unknown';
	stagingCandidate: boolean;
	archived: boolean;
}> }> {
	const tenantRoot = cwd;
	const repoDir = gitWorkflowRoot(tenantRoot);
	const deployConfig = loadPlatformConfig({ tenantRoot, environment: 'staging', env: process.env }).deployConfig;
	const dirty = gitStatusPorcelain(repoDir).length > 0;
	const tasks = listTaskBranches(repoDir).map((branch) => {
		const previewState = loadDeployState(tenantRoot, deployConfig, {
			target: createBranchPreviewDeployTarget(branch.name),
		});
		const packages = checkedOutWorkspacePackageRepos(tenantRoot).map((pkg) => {
			const packageBranches = listTaskBranches(pkg.dir);
			const match = packageBranches.find((candidate) => candidate.name === branch.name) ?? null;
			const pointer = submodulePointerForRef(repoDir, branch.name, pkg.relativeDir);
			return {
				name: pkg.name, 				path: pkg.relativeDir, 				local: match?.local === true, 				remote: match?.remote === true, 				current: match?.current === true, 				head: match?.head ?? null, 				pointer, 				aligned: pointer != null && match?.head != null ? pointer === match.head : match != null,
			};
		});
		return {
			...branch, 			ageDays: ageDays(branch.lastCommitDate), 			dirtyCurrent: branch.current && dirty,
			preview: {
				enabled: previewState.previewEnabled === true || previewState.readiness?.initialized === true, 				url: previewState.lastDeployedUrl ?? null, 				lastDeploymentTimestamp: previewState.lastDeploymentTimestamp ?? null,
			},
			packages,
		};
	});
	const workstreams = tasks.map((task) => ({
		id: task.name,
		title: task.name.replace(/^task\//u, '').replace(/[-_]+/gu, ' '),
		linkedDirectRefs: [],
		branch: task.name,
		local: task.local,
		remote: task.remote,
		current: task.current,
		previewUrl: task.preview.url,
		lastSaveAt: task.lastCommitDate ?? null,
		verificationResult: task.dirtyCurrent ? 'needs_attention' : task.head ? 'ready' : 'unknown',
		stagingCandidate: task.name === STAGING_BRANCH,
		archived: false,
	}));
	return buildWorkflowResult('tasks', cwd, { tasks, workstreams }, { includeFinalState: false });
}

export function normalizeOptionalString(value: unknown) {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
