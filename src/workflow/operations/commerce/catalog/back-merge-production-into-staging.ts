import { checkoutBranch, headCommit, PRODUCTION_BRANCH, pushBranch, remoteHeadCommit, remoteBranchExists, STAGING_BRANCH, syncBranchWithOrigin } from "../../../../operations/services/operations/git-workflow.ts";
import type { ProofDriver } from "../../../../operations/services/guarantees/release-proof.ts";
import { runProof } from "../../../../operations/services/guarantees/release-proof-runner.ts";
import { type ReleaseHistorySummary } from "../../../../operations/services/packages/release-history.ts";
import { collectMergeConflictReport, currentBranch, formatMergeConflictReport, hasMeaningfulChanges, highestStableGitTagOnLine, originRemoteUrl, repoRoot } from "../../../../operations/services/treedx/workspaces/workspace-save.ts";
import { workspacePackages } from "../../../../operations/services/treedx/workspaces/workspace-tools.ts";
import { type ManagedRepository } from "../../../../operations/services/support/managed-repositories.ts";
import type { WorkflowOperationId } from "../../../../operations/workflow.ts";
import { ReleaseCandidateMode, WorkflowError, runGit } from '../../recovery/workflow-write.ts';
import { commitAllIfChanged, promoteCommitToProductionBranch, releaseHistoryCommits, versionLines } from '../../packages/plan-root-package-version.ts';
import { releaseAdminMessage } from '../../packages/release-admin-message.ts';
import { syncAllCheckedOutPackageRepos } from '../../support/sync-current-branch-to-origin.ts';
import { checkedOutReleaseHelperRepos } from '../../coordination/staging-candidate-workflow-gates.ts';
import { normalizeReleaseCandidateMode } from '../../packages/normalize-release-candidate-mode.ts';
import { workflowError } from './run-release-production-guarantees.ts';

export function backMergeProductionIntoStaging(repoDir: string, repoName: string, message?: string) {
	syncBranchWithOrigin(repoDir, STAGING_BRANCH);
	if (!remoteBranchExists(repoDir, PRODUCTION_BRANCH)) {
		throw new Error(`Remote branch "origin/${PRODUCTION_BRANCH}" does not exist.`);
	}
	checkoutBranch(repoDir, STAGING_BRANCH);
	try {
		runGit(['merge-base', '--is-ancestor', `origin/${PRODUCTION_BRANCH}`, 'HEAD'], { cwd: repoDir, capture: true });
		return {
			status: 'up-to-date', 			merged: false, 			repoName, 			sourceBranch: PRODUCTION_BRANCH, 			targetBranch: STAGING_BRANCH, 			commitSha: headCommit(repoDir),
		};
	} catch {
		// A non-zero merge-base result means staging does not yet contain main.
	}
	try {
		runGit(['merge', '--no-ff', `origin/${PRODUCTION_BRANCH}`, '-m', message ?? `release: back-merge ${PRODUCTION_BRANCH} into ${STAGING_BRANCH}`], { cwd: repoDir });
	} catch (error) {
		const report = collectMergeConflictReport(repoDir);
		throw new WorkflowError('release', 'merge_conflict', formatMergeConflictReport(report, repoDir, STAGING_BRANCH), {
			details: { repoName, branch: STAGING_BRANCH, sourceBranch: PRODUCTION_BRANCH, report, originalError: error instanceof Error ? error.message : String(error) },
			exitCode: 12,
		});
	}
	pushBranch(repoDir, STAGING_BRANCH);
	return {
		status: 'merged',
		merged: true,
		repoName,
		sourceBranch: PRODUCTION_BRANCH,
		targetBranch: STAGING_BRANCH,
		commitSha: headCommit(repoDir),
	};
}

export function releaseHelperRepoToProduction(repo: ManagedRepository) {
	syncBranchWithOrigin(repo.dir, STAGING_BRANCH);
	if (!remoteBranchExists(repo.dir, STAGING_BRANCH)) {
		throw new Error(`${repo.name} has no origin/${STAGING_BRANCH} branch to release.`);
	}
	const stagingHead = remoteHeadCommit(repo.dir, STAGING_BRANCH);
	const promotion = promoteCommitToProductionBranch(repo.dir, stagingHead);
	const backMerge = backMergeProductionIntoStaging(repo.dir, repo.name, releaseAdminMessage({
		subject: `release: back-merge ${PRODUCTION_BRANCH} into ${STAGING_BRANCH}`,
		version: null,
		sourceRef: PRODUCTION_BRANCH,
		targetRef: STAGING_BRANCH,
	}));
	return {
		name: repo.name,
		kind: repo.kind,
		path: repo.relativeDir,
		stagingHead,
		promotion,
		backMerge,
	};
}

export function backMergeRootProductionIntoStaging(root: string, syncPackageStagingHeads: boolean, options: {
	version?: string | null;
	changelog?: ReleaseHistorySummary | null;
	selectedVersions?: Map<string, string>;
} = {}) {
	const gitRoot = repoRoot(root);
	const commits = releaseHistoryCommits(gitRoot, STAGING_BRANCH, `origin/${PRODUCTION_BRANCH}`);
	const backMerge = backMergeProductionIntoStaging(gitRoot, '@treeseed/market', releaseAdminMessage({
		subject: `release: back-merge ${PRODUCTION_BRANCH} into ${STAGING_BRANCH}`,
		version: options.version,
		sourceRef: PRODUCTION_BRANCH,
		targetRef: STAGING_BRANCH,
		commits,
		changelog: options.changelog ?? null,
		extraLines: versionLines(options.selectedVersions).map((line) => `Released package ${line}`),
	}));
	if (!syncPackageStagingHeads) {
		return backMerge;
	}
	syncAllCheckedOutPackageRepos(root, STAGING_BRANCH);
	const pointerCommits = releaseHistoryCommits(gitRoot, `origin/${STAGING_BRANCH}`, 'HEAD');
	const pointerSync = commitAllIfChanged(gitRoot, releaseAdminMessage({
		subject: 'release: sync package staging heads',
		version: options.version,
		sourceRef: 'package staging heads',
		targetRef: STAGING_BRANCH,
		commits: pointerCommits,
		changelog: options.changelog ?? null,
		extraLines: versionLines(options.selectedVersions).map((line) => `Staging package ${line}`),
	}));
	if (pointerSync.committed) {
		pushBranch(gitRoot, STAGING_BRANCH);
	}
	return {
		...backMerge,
		packageStagingPointersSynced: pointerSync.committed,
		packageStagingPointerCommit: pointerSync.commitSha,
	};
}

export function releasePlanVersionMap(plannedVersions: Record<string, unknown>) {
	return new Map(
		Object.entries(plannedVersions)
			.filter(([name]) => name !== '@treeseed/market')
			.map(([name, version]) => [name, String(version)] as const),
	);
}

export function releasePlanStableDependencyVersionMap(plannedRelease: { stableDependencyVersions?: unknown }) {
	const stableDependencyVersions = plannedRelease.stableDependencyVersions && typeof plannedRelease.stableDependencyVersions === 'object' && !Array.isArray(plannedRelease.stableDependencyVersions)
		? plannedRelease.stableDependencyVersions as Record<string, unknown>
		: {};
	return new Map(Object.entries(stableDependencyVersions).map(([name, version]) => [name, String(version)] as const));
}

export function collectReleaseHelperRepoBlockers(root: string) {
	const blockers: string[] = [];
	for (const repo of checkedOutReleaseHelperRepos(root)) {
		const branch = currentBranch(repo.dir) || null;
		if (hasMeaningfulChanges(repo.dir)) {
			blockers.push(`${repo.name} has uncommitted changes.`);
		}
		if (branch !== STAGING_BRANCH) {
			blockers.push(`${repo.name} is on ${branch ?? '(detached)'} instead of ${STAGING_BRANCH}.`);
		}
		try {
			originRemoteUrl(repo.dir);
		} catch {
			blockers.push(`${repo.name} has no readable origin remote.`);
		}
		if (!remoteBranchExists(repo.dir, STAGING_BRANCH)) {
			blockers.push(`${repo.name} has no origin/${STAGING_BRANCH} branch.`);
		}
	}
	return blockers;
}

export function releasePlanPackageSelection(value: unknown): { changed: string[]; dependents: string[]; selected: string[] } {
	const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
	return {
		changed: Array.isArray(record.changed) ? record.changed.map(String) : [],
		dependents: Array.isArray(record.dependents) ? record.dependents.map(String) : [],
		selected: Array.isArray(record.selected) ? record.selected.map(String) : [],
	};
}

export const RELEASE_PACKAGE_DEPENDENCIES: Record<string, string[]> = {
	'@treeseed/api': ['treedx'],
};

export function orderReleasePackageNames(packageNames: string[]) {
	const selected = new Set(packageNames);
	const ordered: string[] = [];
	const visiting = new Set<string>();
	const visited = new Set<string>();

	const visit = (name: string) => {
		if (visited.has(name)) return;
		if (visiting.has(name)) {
			throw new Error(`Cycle detected in release package dependency order at ${name}.`);
		}
		visiting.add(name);
		for (const dependency of RELEASE_PACKAGE_DEPENDENCIES[name] ?? []) {
			if (selected.has(dependency)) visit(dependency);
		}
		visiting.delete(name);
		visited.add(name);
		ordered.push(name);
	};

	for (const name of packageNames) visit(name);
	return ordered;
}

export function stableDependencyVersionsForReleaseLine(root: string, options: {
	targetLine?: unknown;
	group?: unknown;
	selected: Set<string>;
}) {
	const targetLine = typeof options.targetLine === 'string' ? options.targetLine : null;
	const group = new Set(Array.isArray(options.group) ? options.group.map(String) : []);
	if (!targetLine || group.size === 0) return {};
	const versions: Record<string, string> = {};
	for (const pkg of workspacePackages(root)) {
		if (!group.has(pkg.name) || options.selected.has(pkg.name)) continue;
		const stableVersion = highestStableGitTagOnLine(pkg.dir, targetLine);
		if (stableVersion) {
			versions[pkg.name] = stableVersion;
		}
	}
	return versions;
}

export function releaseCandidateProofDriver(mode: ReleaseCandidateMode, lane: 'fast' | 'promotion' = 'fast'): ProofDriver {
	if (lane === 'promotion' || mode === 'strict') return 'github-hosted';
	return 'local';
}

export async function runReleaseCandidateProofForPlan(
	operation: Extract<WorkflowOperationId, 'save' | 'stage' | 'release'>,
	root: string,
	plannedRelease: { plannedVersions?: unknown; packageSelection?: unknown },
	options: { mode?: ReleaseCandidateMode; lane?: 'fast' | 'promotion'; write?: (line: string, stream?: 'stdout' | 'stderr') => void } = {},
) {
	const packageSelection = releasePlanPackageSelection(plannedRelease.packageSelection);
	const mode = options.mode ?? normalizeReleaseCandidateMode(undefined, operation);
	const driver = releaseCandidateProofDriver(mode, options.lane ?? 'fast');
	const proof = await runProof({
		root,
		target: operation === 'release' ? 'prod' : 'staging',
		driver,
		write: options.write,
	});
	if (proof.failures.length > 0) {
		const first = proof.failures[0]!;
		workflowError(operation, 'validation_failed', [
			'Treeseed release-candidate proof failed.',
			`- ${first.subject.id}: ${first.invalidationReasons[0] ?? first.status}`,
			first.result.workflow?.url ? `Run: ${first.result.workflow.url}` : null,
			driver === 'github-hosted'
				? 'Hosted GitHub workflow proof is authoritative; local action simulation is advisory.'
				: 'Local proof is exact-input cached in the proof ledger and reruns only missing or invalid subjects.',
		].filter(Boolean).join('\n'), { details: { proof } });
	}
	return {
		mode,
		driver,
		selectedPackageNames: packageSelection.selected,
		proof,
		status: 'passed',
		reused: proof.reused.length,
		records: proof.records.length,
	};
}

export function parseProofOlderThan(value: string | null | undefined) {
	if (!value) return 30 * 24 * 60 * 60 * 1000;
	const match = value.trim().match(/^(\d+)([smhd])?$/u);
	if (!match) return 30 * 24 * 60 * 60 * 1000;
	const amount = Number(match[1]);
	const unit = match[2] ?? 'd';
	if (!Number.isFinite(amount) || amount < 0) return 30 * 24 * 60 * 60 * 1000;
	if (unit === 's') return amount * 1000;
	if (unit === 'm') return amount * 60 * 1000;
	if (unit === 'h') return amount * 60 * 60 * 1000;
	return amount * 24 * 60 * 60 * 1000;
}
