import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { branchExists, headCommit, PRODUCTION_BRANCH, remoteHeadCommit, remoteBranchExists, STAGING_BRANCH, syncBranchWithOrigin } from "../../operations/services/git-workflow.ts";
import { type GitHubActionsWorkflowGate } from "../../operations/services/github-actions-verification.ts";
import { currentBranch, hasMeaningfulChanges, originRemoteUrl, repoRoot } from "../../operations/services/workspace-save.ts";
import { discoverTreeseedPackageAdapters } from "../../operations/services/package-adapters.ts";
import { run } from "../../operations/services/workspace-tools.ts";
import { checkedOutManagedWorkflowRepos, type TreeseedManagedRepository } from "../../operations/services/managed-repositories.ts";
import type { TreeseedStageInput } from "../../workflow.ts";
import { StageCandidateManifest, StageCiMode, StageCleanupMode, StageRepoPlan, StageVerifyMode } from './workflow-close.ts';
import { workflowFileExists } from './connect-treeseed-market-project.ts';
import { hostedDeployGate } from './normalize-release-candidate-mode.ts';
import { TreeseedWorkflowError } from './workflow-write.ts';

export function stagingCandidateWorkflowGates(root: string, manifest: StageCandidateManifest): GitHubActionsWorkflowGate[] {
	const gates: GitHubActionsWorkflowGate[] = [];
	const adapters = discoverTreeseedPackageAdapters(root);
	const add = (name: string, repoPath: string, headSha: string, workflow: string, deploy = false) => {
		if (!workflowFileExists(repoPath, workflow)) return;
		const gate: GitHubActionsWorkflowGate = { name, repoPath, workflow, branch: STAGING_BRANCH, headSha };
		gates.push(deploy ? hostedDeployGate(gate) : gate);
	};
	for (const pkg of manifest.packages) {
		const repoPath = resolve(root, pkg.path);
		const adapter = adapters.find((candidate) => candidate.id === pkg.name || candidate.name === pkg.name);
		if (manifest.stagingHeadsBefore[pkg.name] !== pkg.commit) {
			add(pkg.name, repoPath, pkg.commit, 'verify.yml');
		}
		if (manifest.stagingHeadsBefore[pkg.name] !== pkg.commit
			&& adapter?.capabilities.deploy === true
			&& existsSync(resolve(repoPath, 'treeseed.site.yaml'))) {
			add(pkg.name, repoPath, pkg.commit, 'deploy.yml', true);
		}
	}
	const marketRoot = repoRoot(root);
	add('@treeseed/market', marketRoot, manifest.root.commit, 'verify.yml');
	add('@treeseed/market', marketRoot, manifest.root.commit, 'deploy.yml', true);
	return gates;
}

export function normalizeStageVerifyMode(value: unknown): StageVerifyMode {
	return value === 'local' || value === 'none' ? value : 'action';
}

export function normalizeStageCiMode(input: TreeseedStageInput): StageCiMode {
	if (input.async === true || input.ciMode !== 'hosted') return 'off';
	return 'hosted';
}

export function sha256File(filePath: string) {
	return existsSync(filePath)
		? createHash('sha256').update(readFileSync(filePath)).digest('hex')
		: null;
}

export function internalPackageDependencies(repoPath: string) {
	const packageJsonPath = resolve(repoPath, 'package.json');
	if (!existsSync(packageJsonPath)) return [];
	const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as Record<string, unknown>;
	const names = new Set<string>();
	for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']) {
		const values = packageJson[field];
		if (!values || typeof values !== 'object' || Array.isArray(values)) continue;
		for (const name of Object.keys(values)) {
			if (name.startsWith('@treeseed/')) names.add(name);
		}
	}
	return [...names].sort();
}

export function normalizeStageCleanupMode(input: TreeseedStageInput): StageCleanupMode {
	if (input.cleanupMode === 'manual' || input.deleteBranch === false) return 'manual';
	return 'success';
}

export function stageCandidateManifestPath(root: string, runId: string) {
	return {
		latest: resolve(root, '.treeseed', 'workflow', 'stage-candidates', 'latest.json'),
		run: resolve(root, '.treeseed', 'workflow', 'runs', runId, 'stage-candidate.json'),
	};
}

export function readJsonFile<T>(filePath: string): T | null {
	if (!existsSync(filePath)) return null;
	try {
		return JSON.parse(readFileSync(filePath, 'utf8')) as T;
	} catch {
		return null;
	}
}

export function stageCandidateAttestationBlockers(root: string) {
	const manifest = readJsonFile<StageCandidateManifest>(stageCandidateManifestPath(root, 'unused').latest);
	if (!manifest) return ['No staging candidate manifest is available. Run `trsd stage` and wait for staging verification and deployment workflows.'];
	const blockers: string[] = [];
	if (manifest.root.commit !== headCommit(repoRoot(root))) blockers.push('The local Market staging head no longer matches the latest staged candidate.');
	for (const pkg of manifest.packages) {
		const repoPath = resolve(root, pkg.path);
		if (!existsSync(repoPath) || headCommit(repoPath) !== pkg.commit) blockers.push(`${pkg.name} no longer matches staged commit ${pkg.commit}.`);
	}
	return blockers;
}

export function writeStageCandidateManifest(root: string, runId: string, manifest: StageCandidateManifest) {
	const paths = stageCandidateManifestPath(root, runId);
	for (const filePath of [paths.latest, paths.run]) {
		mkdirSync(dirname(filePath), { recursive: true });
		writeFileSync(filePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
	}
	return manifest;
}

export function dedupeManagedReposByRemote(repos: TreeseedManagedRepository[]) {
	const seen = new Set<string>();
	const deduped: TreeseedManagedRepository[] = [];
	for (const repo of repos) {
		const key = repo.remoteUrl ? `remote:${repo.remoteUrl}` : `path:${repo.dir}`;
		if (seen.has(key)) continue;
		seen.add(key);
		deduped.push(repo);
	}
	return deduped;
}

export function checkedOutStagePromotionRepos(root: string) {
	return dedupeManagedReposByRemote(checkedOutManagedWorkflowRepos(root)
		.filter((repo) => repo.kind === 'package' || repo.kind === 'template' || repo.kind === 'fixture'));
}

export function checkedOutReleaseHelperRepos(root: string) {
	return dedupeManagedReposByRemote(checkedOutManagedWorkflowRepos(root)
		.filter((repo) => repo.kind === 'template' || repo.kind === 'fixture'));
}

export function syncAllCheckedOutReleaseHelperRepos(root: string, branchName: string) {
	for (const repo of checkedOutManagedWorkflowRepos(root).filter((entry) => entry.kind === 'template' || entry.kind === 'fixture')) {
		if (remoteBranchExists(repo.dir, branchName)) {
			syncBranchWithOrigin(repo.dir, branchName);
		}
	}
}

export function buildStagePromotionPlan(root: string, branchName: string, input: {
	verifyMode: StageVerifyMode;
	ciMode: StageCiMode;
	cleanupMode: StageCleanupMode;
	updateFrom: typeof STAGING_BRANCH;
}): {
	schemaVersion: 1;
	branchName: string;
	targetBranch: typeof STAGING_BRANCH;
	updateFrom: typeof STAGING_BRANCH;
	verifyMode: StageVerifyMode;
	ciMode: StageCiMode;
	cleanupMode: StageCleanupMode;
	repos: StageRepoPlan[];
	phases: string[];
} {
	const gitRoot = repoRoot(root);
	const repos: StageRepoPlan[] = [
		...checkedOutStagePromotionRepos(root).map((repo) => ({
			name: repo.name, 			path: repo.dir, 			kind: 'managed' as const, 			repoKind: repo.kind, 			sourceBranch: branchName, 			targetBranch: STAGING_BRANCH, 			remoteSourceExists: remoteBranchExists(repo.dir, branchName), 			beforeHead: branchExists(repo.dir, branchName) ? headCommit(repo.dir, branchName) : null, 			stagingHeadBefore: remoteBranchExists(repo.dir, STAGING_BRANCH) ? remoteHeadCommit(repo.dir, STAGING_BRANCH) : null,
		})),
		{
			name: '@treeseed/market', 			path: gitRoot, 			kind: 'root' as const, 			sourceBranch: branchName, 			targetBranch: STAGING_BRANCH, 			remoteSourceExists: remoteBranchExists(gitRoot, branchName), 			beforeHead: branchExists(gitRoot, branchName) ? headCommit(gitRoot, branchName) : null, 			stagingHeadBefore: remoteBranchExists(gitRoot, STAGING_BRANCH) ? remoteHeadCommit(gitRoot, STAGING_BRANCH) : null,
		},
	];
	return {
		schemaVersion: 1,
		branchName,
		targetBranch: STAGING_BRANCH,
		updateFrom: input.updateFrom,
		verifyMode: input.verifyMode,
		ciMode: input.ciMode,
		cleanupMode: input.cleanupMode,
		repos,
		phases: [
			'preflight', 			'merge-staging-down', 			'save-integrated-feature', 			'verify-integrated-feature', 			'promote-to-staging', 			'verify-staging-refs', 			'workspace-link-restore', 			'cleanup-source',
		],
	};
}

export function stagePreflightBlockers(root: string, branchName: string, plan: { repos: StageRepoPlan[] }) {
	const blockers: string[] = [];
	if (!branchName || branchName === STAGING_BRANCH || branchName === PRODUCTION_BRANCH) {
		blockers.push(`stage requires a feature branch; current branch is ${branchName || '(none)'}.`);
	}
	for (const repo of plan.repos) {
		const branch = currentBranch(repo.path) || null;
		if (hasMeaningfulChanges(repo.path)) {
			blockers.push(`${repo.name} has uncommitted changes.`);
		}
		if (branch !== branchName && repo.kind === 'managed' && repo.remoteSourceExists) {
			blockers.push(`${repo.name} is on ${branch ?? '(detached)'} instead of ${branchName}.`);
		}
		if (repo.kind === 'root' && branch !== branchName) {
			blockers.push(`${repo.name} is on ${branch ?? '(detached)'} instead of ${branchName}.`);
		}
		try {
			originRemoteUrl(repo.path);
		} catch {
			blockers.push(`${repo.name} has no readable origin remote.`);
		}
		if (repo.kind === 'root' && !repo.remoteSourceExists) {
			blockers.push(`${repo.name} feature branch ${branchName} has not been pushed to origin.`);
		}
		if (repo.kind === 'managed' && branchExists(repo.path, branchName) && repo.remoteSourceExists) {
			const localHead = headCommit(repo.path, branchName);
			const remoteHead = remoteHeadCommit(repo.path, branchName);
			if (localHead !== remoteHead) {
				blockers.push(`${repo.name} local ${branchName} (${localHead.slice(0, 12)}) does not match origin/${branchName} (${remoteHead.slice(0, 12)}). Run save first.`);
			}
		}
	}
	return blockers;
}

export function stageConflictError(message: string, details: Record<string, unknown>) {
	return new TreeseedWorkflowError('stage', 'merge_conflict', message, {
		details,
		exitCode: 12,
	});
}

export function createStageCandidateManifest(root: string, runId: string, branchName: string, plan: { repos: StageRepoPlan[] }, verification: StageCandidateManifest['verification']): StageCandidateManifest {
	const gitRoot = repoRoot(root);
	const packageRepos = plan.repos.filter((repo) => repo.kind === 'managed');
	const rootCommit = headCommit(gitRoot);
	const submodules = packageRepos
		.map((repo) => `${relative(root, repo.path).replaceAll('\\', '/')}:${headCommit(repo.path)}`)
		.sort();
	const candidateId = createHash('sha256').update(JSON.stringify({
		rootSha: rootCommit,
		submodules,
	})).digest('hex');
	return {
		schemaVersion: 2,
		kind: 'treeseed.stage-candidate',
		candidateId,
		runId,
		branchName,
		targetBranch: STAGING_BRANCH,
		createdAt: new Date().toISOString(),
		root: {
			repo: '@treeseed/market', 			commit: rootCommit, 			verified: verification.status === 'passed' || verification.status === 'skipped',
		},
		packages: packageRepos.map((repo) => ({
			name: repo.name, 			path: repo.path, 			repoKind: repo.repoKind, 			commit: headCommit(repo.path), 			lockfileHash: sha256File(resolve(repo.path, 'package-lock.json')), 			dependencies: internalPackageDependencies(repo.path),
			remote: (() => {
				try {
					return originRemoteUrl(repo.path);
				} catch {
					return null;
				}
			})(),
			verified: verification.status === 'passed' || verification.status === 'skipped',
		})),
		verification,
		stagingHeadsBefore: Object.fromEntries(plan.repos.map((repo) => [repo.name, repo.stagingHeadBefore])),
	};
}
