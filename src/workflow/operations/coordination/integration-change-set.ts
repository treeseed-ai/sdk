import { createHash } from 'node:crypto';
import { existsSync,mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { dirname,relative,resolve } from 'node:path';
import { runRepositoryGit } from '../../../operations/services/operations/git-runner.ts';
import { discoverRepositorySaveNodes } from '../../../operations/services/repositories/repository-save-orchestrator.ts';
import type { RepositorySaveReport,RepositorySaveResult } from '../../../operations/services/repositories/repository-save-orchestrator.ts';
import { currentBranch,originRemoteUrl } from '../../../operations/services/treedx/workspaces/workspace-save.ts';
import { authorityMatchesRepository,governedExecutionAuthorityValid,readGovernedExecutionAuthorities,type GovernedExecutionAuthority } from '../../../operations/agents/execution-authority-receipt.ts';
import { repositoryIdentityKey } from '../../../repositories/repository-identity.ts';

export type IntegrationRepository = {
	name: string;
	role: 'root' | 'package' | 'project' | 'template' | 'fixture';
	repository: {
		canonicalKey: string;
		remoteUrl: string;
	};
	workspacePath: string;
	sourceBranch: string;
	commit: string;
	dependencies: string[];
	contractDigests: {
		packageManifest: string | null;
		lockfile: string | null;
	};
	verification: {
		status: 'passed' | 'skipped';
		mode: string | null;
	};
	executionAuthorities: GovernedExecutionAuthority[];
	remoteProof: {
		kind: 'branch_head' | 'reachable';
		ref: string;
		refCommit: string;
	};
	remoteVerified: true;
};

export type IntegrationChangeSet = {
	schemaVersion: 1;
	kind: 'treeseed.integration-change-set/v1';
	receiptId: string;
	runId: string;
	sourceBranch: string;
	createdAt: string;
	scope: 'repository' | 'federated';
	repositories: IntegrationRepository[];
};

function digestFile(path: string) {
	return existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null;
}

export function observeRemoteBranchCommit(path: string, branch: string) {
	const output = runRepositoryGit(['ls-remote', '--heads', 'origin', branch], {
		cwd: path,
		mode: 'read',
		allowFailure: false,
	}).stdout.trim();
	const commit = output.split(/\s+/u)[0] ?? '';
	if (!/^[a-f0-9]{40}$/u.test(commit)) throw new Error(`Remote branch ${branch} is missing.`);
	return commit;
}

function observeRemoteCommit(path: string, branch: string, commit: string, requireBranchHead: boolean) {
	try {
		const observed = observeRemoteBranchCommit(path, branch);
		if (observed === commit) return { kind: 'branch_head' as const, ref: branch, refCommit: commit };
		if (requireBranchHead) throw new Error(`Remote ${branch} is ${observed}, expected ${commit}.`);
	} catch (error) {
		if (requireBranchHead) throw error;
	}
	runRepositoryGit(['fetch', '--prune', 'origin'], { cwd: path, mode: 'mutate', allowFailure: false });
	const refs = runRepositoryGit(['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin'], {
		cwd: path,
		mode: 'read',
		allowFailure: false,
	}).stdout.split(/\r?\n/u).map((entry) => entry.trim()).filter((entry) => entry.startsWith('origin/') && entry !== 'origin/HEAD');
	const containing = refs.find((ref) => runRepositoryGit(['merge-base', '--is-ancestor', commit, ref], {
		cwd: path,
		mode: 'read',
		allowFailure: true,
	}).status === 0);
	if (!containing) throw new Error(`Saved commit ${commit} is not reachable from a live remote ref.`);
	return {
		kind: 'reachable' as const,
		ref: containing.replace(/^origin\//u, ''),
		refCommit: runRepositoryGit(['rev-parse', containing], { cwd: path, mode: 'read', allowFailure: false }).stdout.trim(),
	};
}

function receiptPaths(root: string, runId: string) {
	return {
		latest: resolve(root, '.treeseed', 'workflow', 'integration-receipts', 'latest.json'),
		run: resolve(root, '.treeseed', 'workflow', 'runs', runId, 'integration-change-set.json'),
	};
}

function writeReceipt(root: string, receipt: IntegrationChangeSet) {
	const paths = receiptPaths(root, receipt.runId);
	for (const path of [paths.latest, paths.run]) {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
	}
	return receipt;
}

function receiptIdentity(receipt: Pick<IntegrationChangeSet, 'sourceBranch' | 'scope' | 'repositories'>) {
	return createHash('sha256').update(JSON.stringify({
		sourceBranch: receipt.sourceBranch,
		scope: receipt.scope,
		repositories: receipt.repositories.map(({ name,role,repository,workspacePath,sourceBranch,commit,dependencies,contractDigests,verification,executionAuthorities,remoteProof }) => ({
			name,role,repository,workspacePath,sourceBranch,commit,dependencies,contractDigests,verification,executionAuthorities,remoteProof,
		})),
	})).digest('hex');
}

export function readLatestIntegrationChangeSet(root: string): IntegrationChangeSet | null {
	try {
		const receipt = JSON.parse(readFileSync(receiptPaths(root, 'unused').latest, 'utf8')) as IntegrationChangeSet;
		if (receipt?.kind !== 'treeseed.integration-change-set/v1' || receipt.schemaVersion !== 1) return null;
		if (receipt.receiptId !== receiptIdentity(receipt)) return null;
		if (receipt.repositories.some((repository) => repository.executionAuthorities?.some((authority) => !governedExecutionAuthorityValid(authority)))) return null;
		return receipt;
	} catch {
		return null;
	}
}

function reportForNode(nodePath: string, result: RepositorySaveResult) {
	return [result.rootRepo, ...result.repos].find((report) => resolve(report.path) === resolve(nodePath)) ?? null;
}

function verifiedRepository(input: {
	root: string;
	branch: string;
	node: ReturnType<typeof discoverRepositorySaveNodes>[number];
	report: RepositorySaveReport;
	namesById: Map<string, string>;
}): IntegrationRepository {
	const { root,branch,node,report,namesById } = input;
	const remoteUrl = originRemoteUrl(node.path);
	const canonicalKey = repositoryIdentityKey(remoteUrl);
	if (!canonicalKey) throw new Error(`${node.name} has no canonical repository identity.`);
	const commit = report.commitSha;
	if (!commit) throw new Error(`${node.name} save did not produce an exact commit.`);
	if (currentBranch(node.path) !== branch) throw new Error(`${node.name} is not on saved branch ${branch}.`);
	let remoteProof: IntegrationRepository['remoteProof'];
	try {
		remoteProof = observeRemoteCommit(node.path, branch, commit, report.pushed);
	} catch (error) {
		throw new Error(`${node.name} remote verification failed: ${error instanceof Error ? error.message : String(error)}`);
	}
	const verificationStatus = report.verification?.status;
	if (verificationStatus === 'failed') throw new Error(`${node.name} has a failed save verification.`);
	const executionAuthorities = readGovernedExecutionAuthorities(root).filter((authority) =>
		authority.sourceBranch === branch
		&& authorityMatchesRepository(authority, remoteUrl)
		&& runRepositoryGit(['merge-base', '--is-ancestor', authority.integratedCommit, commit], {
			cwd: node.path,
			mode: 'read',
			allowFailure: true,
		}).status === 0);
	return {
		name: node.name,
		role: node.id === '.' ? 'root' : node.kind,
		repository: { canonicalKey, remoteUrl },
		workspacePath: relative(root, node.path).replaceAll('\\', '/') || '.',
		sourceBranch: branch,
		commit,
		dependencies: node.dependencies.map((id) => namesById.get(id) ?? id).sort(),
		contractDigests: {
			packageManifest: digestFile(resolve(node.path, 'package.json')),
			lockfile: digestFile(resolve(node.path, 'package-lock.json')),
		},
		verification: {
			status: verificationStatus === 'passed' ? 'passed' : 'skipped',
			mode: report.verification?.mode ?? null,
		},
		executionAuthorities,
		remoteProof,
		remoteVerified: true,
	};
}

export function writeIntegrationChangeSet(input: {
	root: string;
	gitRoot: string;
	runId: string;
	branch: string;
	result: RepositorySaveResult;
}) {
	const selectedIds = new Set(input.result.repositoryIds);
	const nodes = discoverRepositorySaveNodes(input.root, input.gitRoot, input.branch).filter((node) => selectedIds.has(node.id));
	if (nodes.length !== selectedIds.size) throw new Error('Saved repository selection no longer matches the managed repository graph.');
	const namesById = new Map(nodes.map((node) => [node.id, node.name]));
	const repositories = nodes.map((node) => {
		const report = reportForNode(node.path, input.result);
		if (!report) throw new Error(`Saved repository report is missing for ${node.name}.`);
		return verifiedRepository({ root: input.root, branch: input.branch, node, report, namesById });
	}).sort((left, right) => left.repository.canonicalKey.localeCompare(right.repository.canonicalKey));
	const receiptId = receiptIdentity({ sourceBranch: input.branch, scope: input.result.repositoryScope, repositories });
	return writeReceipt(input.root, {
		schemaVersion: 1,
		kind: 'treeseed.integration-change-set/v1',
		receiptId,
		runId: input.runId,
		sourceBranch: input.branch,
		createdAt: new Date().toISOString(),
		scope: input.result.repositoryScope,
		repositories,
	});
}

export function integrationChangeSetBlockers(root: string, branch: string) {
	const receipt = readLatestIntegrationChangeSet(root);
	if (!receipt) return ['No integration change-set receipt is available. Run `trsd save` first.'];
	const blockers: string[] = [];
	if (receipt.scope !== 'federated') blockers.push('The latest integration receipt is repository-scoped. Run `trsd save --federated` before staging.');
	if (receipt.sourceBranch !== branch) blockers.push(`Integration receipt is for ${receipt.sourceBranch}, not ${branch}.`);
	for (const repository of receipt.repositories) {
		const path = resolve(root, repository.workspacePath);
		if (!existsSync(path)) {
			blockers.push(`${repository.name} receipt checkout is not materialized at ${repository.workspacePath}.`);
			continue;
		}
		let remoteUrl: string;
		try {
			remoteUrl = originRemoteUrl(path);
		} catch {
			blockers.push(`${repository.name} receipt checkout has no origin remote.`);
			continue;
		}
		if (repositoryIdentityKey(remoteUrl) !== repository.repository.canonicalKey) {
			blockers.push(`${repository.name} checkout does not match receipt repository ${repository.repository.canonicalKey}.`);
			continue;
		}
		try {
			const observed = observeRemoteBranchCommit(path, repository.remoteProof.ref);
			if (observed !== repository.remoteProof.refCommit) {
				throw new Error(`Remote ${repository.remoteProof.ref} is ${observed}, expected receipt ref ${repository.remoteProof.refCommit}.`);
			}
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			blockers.push(`${repository.name} remote ${repository.remoteProof.ref} moved after receipt ${receipt.receiptId}: ${detail}`);
		}
	}
	return blockers;
}
