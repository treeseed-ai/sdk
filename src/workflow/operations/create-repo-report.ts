import { assertCleanWorktrees, headCommit } from "../../operations/services/git-workflow.ts";
import { createTreeseedWorkflowTimer, type TreeseedWorkflowTiming } from "../../operations/services/workflow-timing.ts";
import { currentBranch, gitStatusPorcelain, hasMeaningfulChanges, repoRoot } from "../../operations/services/workspace-save.ts";
import { type TreeseedHostingAuditEnvironment } from "../../operations/services/hosting-audit.ts";
import { collectTreeseedDeploymentReadiness } from "../../operations/services/deployment-readiness.ts";
import { discoverTreeseedApplications } from "../../hosting/apps.ts";
import { checkedOutWorkspacePackageRepos } from ".././session.ts";
import { checkedOutManagedWorkflowRepos } from "../../operations/services/managed-repositories.ts";
import type { TreeseedWorkflowExecutionMode, TreeseedWorkflowFact, TreeseedWorkflowNextStep, TreeseedWorkflowOperationId, TreeseedWorkflowRecovery, TreeseedWorkflowResult } from "../../workflow.ts";
import { WorkflowRepoReport, resolveWorkflowStateSnapshot, workflowError } from './run-release-production-guarantees.ts';
import { WorkflowOperationHelpers, WorkflowStatePayload, runGit } from './workflow-write.ts';

export function createRepoReport(name: string, path: string, branch: string | null, dirty: boolean): WorkflowRepoReport {
	return {
		name,
		path,
		branch,
		dirty,
		created: false,
		resumed: false,
		merged: false,
		verified: false,
		committed: false,
		pushed: false,
		deletedLocal: false,
		deletedRemote: false,
		tagName: null,
		commitSha: branch ? headCommit(path) : null,
		skippedReason: null,
		publishWait: null,
		workflowGates: [],
		backMerge: null,
	};
}

export function createWorkspaceRootRepoReport(root: string) {
	const gitRoot = repoRoot(root);
	return createRepoReport('@treeseed/market', gitRoot, currentBranch(gitRoot) || null, hasMeaningfulChanges(gitRoot));
}

export function createWorkspacePackageReports(root: string) {
	return checkedOutWorkspacePackageRepos(root).map((pkg) =>
		createRepoReport(pkg.name, pkg.dir, currentBranch(pkg.dir) || null, hasMeaningfulChanges(pkg.dir)));
}

export function createManagedWorkflowRepoReports(root: string) {
	return checkedOutManagedWorkflowRepos(root).map((repo) =>
		createRepoReport(repo.name, repo.dir, currentBranch(repo.dir) || null, hasMeaningfulChanges(repo.dir)));
}

export function findReportByName(reports: WorkflowRepoReport[], name: string) {
	return reports.find((report) => report.name === name) ?? null;
}

export function findReportByPath(reports: WorkflowRepoReport[], path: string) {
	return reports.find((report) => report.path === path) ?? null;
}

export function assertWorkspaceClean(root: string) {
	const repoDirs = [repoRoot(root), ...checkedOutManagedWorkflowRepos(root).map((repo) => repo.dir)];
	assertCleanWorktrees(repoDirs);
	return repoDirs;
}

export function buildWorkflowResult<TPayload>(
	operation: TreeseedWorkflowOperationId,
	cwd: string,
	payload: TPayload,
	options: {
		nextSteps?: TreeseedWorkflowNextStep[];
		executionMode?: TreeseedWorkflowExecutionMode;
		runId?: string | null;
		summary?: string;
		facts?: TreeseedWorkflowFact[];
		recovery?: TreeseedWorkflowRecovery | null;
		errors?: Array<{ code: string; message: string; details?: Record<string, unknown> | null }>;
		includeFinalState?: boolean;
		timing?: TreeseedWorkflowTiming;
	} = {},
): TreeseedWorkflowResult<TPayload & { finalState?: WorkflowStatePayload; timing?: TreeseedWorkflowTiming }> {
	const timing = options.timing ?? createTreeseedWorkflowTimer().finish();
	const resolvedPayload = (options.includeFinalState ?? true)
		? {
			...(payload as Record<string, unknown>), 			timing, 			finalState: resolveWorkflowStateSnapshot(cwd),
		}
		: {
			...(payload as Record<string, unknown>), 			timing,
		};
	return {
		schemaVersion: 1,
		kind: 'treeseed.workflow.result',
		command: operation,
		executionMode: options.executionMode ?? 'execute',
		runId: options.runId ?? null,
		ok: true,
		operation,
		summary: options.summary,
		facts: options.facts,
		payload: resolvedPayload as TPayload & { finalState?: WorkflowStatePayload; timing?: TreeseedWorkflowTiming },
		result: resolvedPayload as TPayload & { finalState?: WorkflowStatePayload; timing?: TreeseedWorkflowTiming },
		nextSteps: options.nextSteps,
		recovery: options.recovery ?? null,
		errors: options.errors ?? [],
	};
}

export type WorkflowApplicationSelection = {
	selected: string[];
	skipped: Array<{ appId: string; reason: string }>;
	reasons: Array<{ appId: string; reason: string }>;
	source: 'changed-paths' | 'package-selection' | 'default';
};

export function parseGitStatusChangedPaths(status: string) {
	return status
		.split('\n')
		.map((line) => line.trimEnd())
		.filter(Boolean)
		.map((line) => {
			const value = line.slice(3).trim();
			return value.includes(' -> ') ? value.split(' -> ').at(-1)!.trim() : value;
		})
		.filter(Boolean);
}

export function availableWorkflowAppIds(root: string) {
	try {
		const ids = discoverTreeseedApplications(root).map((app) => app.id);
		return ids.length > 0 ? ids : ['web'];
	} catch {
		return ['web'];
	}
}

export function selectWorkflowApplications(root: string, input: {
	packageSelection?: { selected?: string[]; changed?: string[]; dependents?: string[] };
	changedPaths?: string[];
} = {}): WorkflowApplicationSelection {
	const available = availableWorkflowAppIds(root);
	const availableSet = new Set(available);
	const selected = new Set<string>();
	const reasons: Array<{ appId: string; reason: string }> = [];
	const add = (appId: string, reason: string) => {
		if (!availableSet.has(appId)) return;
		selected.add(appId);
		reasons.push({ appId, reason });
	};
	const packages = [
		...(input.packageSelection?.selected ?? []),
		...(input.packageSelection?.changed ?? []),
		...(input.packageSelection?.dependents ?? []),
	];
	const appByPackage = new Map(discoverTreeseedApplications(root)
		.filter((app) => app.relativeRoot.startsWith('packages/'))
		.map((app) => [`@treeseed/${app.relativeRoot.slice('packages/'.length).split('/')[0]}`, app.id]));
	for (const packageName of packages) {
		if (packageName === '@treeseed/api' || packageName === '@treeseed/treedx' || packageName === '@treeseed/agent') {
			add('api', `${packageName} changed`);
		} else if (packageName === '@treeseed/core' || packageName === '@treeseed/ui' || packageName === '@treeseed/admin') {
			add('web', `${packageName} changed`);
		} else if (packageName === '@treeseed/sdk' || packageName === '@treeseed/cli') {
			add('web', `${packageName} is shared`);
			add('api', `${packageName} is shared`);
		}
		const packageAppId = appByPackage.get(packageName);
		if (packageAppId) add(packageAppId, `${packageName} owns ${packageAppId}`);
	}

	const changedPaths = input.changedPaths ?? parseGitStatusChangedPaths(gitStatusPorcelain(root));
	const appByPackagePath = new Map(discoverTreeseedApplications(root)
		.filter((app) => app.relativeRoot.startsWith('packages/'))
		.map((app) => [app.relativeRoot, app.id]));
	for (const file of changedPaths) {
		if (file.startsWith('packages/api/') || file === 'packages/api') {
			add('api', `${file} is API-owned`);
		} else if (file.startsWith('packages/treedx/') || file === 'packages/treedx') {
			add('api', `${file} is TreeDX implementation`);
		} else if (file.startsWith('packages/core/') || file.startsWith('packages/ui/') || file.startsWith('packages/admin/') || file.startsWith('src/') || file.startsWith('content/') || file.startsWith('public/') || file === 'treeseed.site.yaml') {
			add('web', `${file} is web-owned`);
		} else if (file.startsWith('packages/sdk/') || file.startsWith('packages/cli/') || file === 'package.json' || file === 'package-lock.json' || file.startsWith('.github/')) {
			add('web', `${file} is shared workflow/config`);
			add('api', `${file} is shared workflow/config`);
		}
		for (const [packageRoot, appId] of appByPackagePath) {
			if (file === packageRoot || file.startsWith(`${packageRoot}/`)) {
				add(appId, `${file} is ${appId}-owned`);
			}
		}
	}

	const source: WorkflowApplicationSelection['source'] = packages.length > 0
		? 'package-selection'
		: changedPaths.length > 0
			? 'changed-paths'
			: 'default';
	const finalSelected = selected.size > 0
		? available.filter((appId) => selected.has(appId))
		: available;
	return {
		selected: finalSelected,
		skipped: available
			.filter((appId) => !finalSelected.includes(appId))
			.map((appId) => ({ appId, reason: 'No changed files or selected packages target this application.' })),
		reasons,
		source,
	};
}

export function singleSelectedWorkflowAppId(selection: WorkflowApplicationSelection) {
	return selection.selected.length === 1 ? selection.selected[0] : undefined;
}

export async function workflowHostedVerificationGateRequired(
	operation: TreeseedWorkflowOperationId,
	root: string,
	helpers: WorkflowOperationHelpers,
	environment: TreeseedHostingAuditEnvironment,
	options: { enabled: boolean; strict?: boolean; live?: boolean; appId?: string } = { enabled: true },
) {
	if (!options.enabled) return null;
	const target = environment === 'prod' ? 'prod' : environment === 'local' ? 'local' : 'staging';
	const readiness = collectTreeseedDeploymentReadiness({
		tenantRoot: root,
		environment: target,
		appId: options.appId,
	});
	if (options.strict && !readiness.ok) {
		const failures = readiness.checks
			.filter((check) => check.status === 'failed')
			.map((check) => `${check.id}: ${check.message}${check.remediation ? ` Remediation: ${check.remediation}` : ''}`);
		workflowError(operation, 'validation_failed', `Deployment readiness failed for ${target}:\n${failures.join('\n')}`, {
			details: { readiness },
		});
	}
	workflowError(operation, 'validation_failed', `Hosted live verification for ${target} is reconciler-owned. Use stage/release release-gate:hosted-reconcile and release-gate:live-verify resources, or run trsd reconcile verify with a hosted selector.`, {
		details: {
			readiness, 			live: options.live === true, 			appId: options.appId ?? null,
		},
	});
}

export function normalizeExecutionMode(input: { plan?: boolean } | undefined): TreeseedWorkflowExecutionMode {
	return input?.plan === true ? 'plan' : 'execute';
}

export function submodulePointerForRef(repoDir: string, ref: string, relativeDir: string) {
	try {
		const output = runGit(['ls-tree', ref, relativeDir], { cwd: repoDir, capture: true }).trim();
		if (!output) {
			return null;
		}
		const match = output.match(/^[0-9]{6}\s+commit\s+([0-9a-f]{40})\t/u);
		return match?.[1] ?? null;
	} catch {
		return null;
	}
}

export function ensureLocalReadinessOrThrow(operation: TreeseedWorkflowOperationId, tenantRoot: string) {
	const state = resolveWorkflowStateSnapshot(tenantRoot);
	if (!state.readiness.local.ready) {
		workflowError(
			operation, 			'validation_failed',
			[
				`Treeseed ${operation} requires the local environment to be configured.`,
				...state.readiness.local.blockers, 				'Run `treeseed config --environment local` first.',
			].join('\n'),
			{ details: { readiness: state.readiness.local } },
		);
	}
	return state;
}
