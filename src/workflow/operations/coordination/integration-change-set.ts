import { createHash } from 'node:crypto';
import { existsSync,mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { dirname,relative,resolve } from 'node:path';
import { runRepositoryGit } from '../../../operations/services/operations/git-runner.ts';
import { discoverRepositorySaveNodes } from '../../../operations/services/repositories/repository-save-orchestrator.ts';
import { verifiedPlatformWorksetReceipt } from '../../../operations/services/repositories/platform-workset.ts';
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
	schemaVersion: 1 | 2;
	kind: 'treeseed.integration-change-set/v1' | 'treeseed.integration-change-set/v2';
	receiptId: string;
	runId: string;
	sourceBranch: string;
	createdAt: string;
	scope: 'repository' | 'federated';
	repositories: IntegrationRepository[];
	rootAuthority?: PlatformRootIntegrationAuthority | null;
};

export type PlatformRootIntegrationAuthority = {
	schemaVersion: 1;
	kind: 'treeseed.platform-root-integration-authority/v1';
	rootBaseCommit: string;
	rootCommit: string;
	changedPaths: string[];
	derivedPointerPaths: string[];
	childRefs: Array<{ repository: string; workspacePath: string; commit: string; remoteRef: string; remoteCommit: string }>;
};

type WorksetBase = { projectId: string; path: string; repository: string; commit: string };

function platformWorksetBases(root: string) {
	const receipt = verifiedPlatformWorksetReceipt(root);
	return new Map(receipt?.completed.map((entry) => [entry.path, {
		projectId: entry.projectId, path: entry.path, repository: entry.repository, commit: entry.commit,
	}] as [string, WorksetBase]) ?? []);
}

function worksetAuthorityBlockers(path: string, commit: string, base: WorksetBase, authorities: GovernedExecutionAuthority[]) {
	if (runRepositoryGit(['merge-base', '--is-ancestor', base.commit, commit], { cwd: path, mode: 'read', allowFailure: true }).status !== 0) {
		return [`Repository does not descend from its verified workset base ${base.commit}.`];
	}
	const changedPaths = runRepositoryGit(['diff', '--name-only', '-z', `${base.commit}..${commit}`], { cwd: path, mode: 'read', allowFailure: false }).stdout
		.split('\0').filter(Boolean)
		.filter((changedPath) => !['package.json', 'package-lock.json', 'npm-shrinkwrap.json'].includes(changedPath));
	if (!changedPaths.length) return [];
	const eligible = authorities.filter((authority) => authority.projectId === base.projectId && authority.baseCommit === base.commit);
	if (!eligible.length) return [`Workset project ${base.projectId} has source changes but no authority rooted at its exact inventory commit.`];
	return changedPaths.filter((changedPath) => !eligible.some((authority) => authority.changedPaths.includes(changedPath)))
		.map((changedPath) => `Workset path ${changedPath} has no project-scoped execution authority.`);
}

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

export function integrationChangeSetReceiptId(receipt: Pick<IntegrationChangeSet, 'sourceBranch' | 'scope' | 'repositories'|'rootAuthority'>) {
	return createHash('sha256').update(JSON.stringify({
		sourceBranch: receipt.sourceBranch,
		scope: receipt.scope,
		repositories: receipt.repositories.map(({ name,role,repository,workspacePath,sourceBranch,commit,dependencies,contractDigests,verification,executionAuthorities,remoteProof }) => ({
			name,role,repository,workspacePath,sourceBranch,commit,dependencies,contractDigests,verification,executionAuthorities,remoteProof,
		})),
		...('rootAuthority' in receipt ? { rootAuthority:receipt.rootAuthority ?? null } : {}),
	})).digest('hex');
}

export function readLatestIntegrationChangeSet(root: string): IntegrationChangeSet | null {
	try {
		const receipt = JSON.parse(readFileSync(receiptPaths(root, 'unused').latest, 'utf8')) as IntegrationChangeSet;
		if (!['treeseed.integration-change-set/v1','treeseed.integration-change-set/v2'].includes(receipt?.kind) || ![1,2].includes(receipt.schemaVersion)) return null;
		if (receipt.schemaVersion === 2 && receipt.scope === 'federated' && !receipt.rootAuthority) return null;
		const identityInput=receipt.schemaVersion === 1
			? { sourceBranch:receipt.sourceBranch,scope:receipt.scope,repositories:receipt.repositories }
			: receipt;
		if (receipt.receiptId !== integrationChangeSetReceiptId(identityInput)) return null;
		if (receipt.repositories.some((repository) => repository.executionAuthorities?.some((authority) => !governedExecutionAuthorityValid(authority)))) return null;
		return receipt;
	} catch {
		return null;
	}
}

function platformRootAuthority(root: string, report: RepositorySaveReport, repositories: IntegrationRepository[]): PlatformRootIntegrationAuthority {
	const rootCommit=report.commitSha ?? '';
	const rootBaseCommit=report.baseCommit ?? '';
	if (!/^[a-f0-9]{40}$/u.test(rootBaseCommit) || !/^[a-f0-9]{40}$/u.test(rootCommit)) throw new Error('Platform root integration requires exact base and resulting commits.');
	if (runRepositoryGit(['merge-base','--is-ancestor',rootBaseCommit,rootCommit],{ cwd:root,mode:'read',allowFailure:true }).status !== 0) throw new Error('Platform root integration commit does not descend from its recorded base.');
	const changedPaths=runRepositoryGit(['diff','--name-only','-z',`${rootBaseCommit}..${rootCommit}`],{ cwd:root,mode:'read',allowFailure:false }).stdout.split('\0').filter(Boolean).sort();
	const childRefs=repositories.filter((entry) => entry.role !== 'root').map((entry) => ({ repository:entry.repository.canonicalKey,workspacePath:entry.workspacePath,commit:entry.commit,remoteRef:entry.remoteProof.ref,remoteCommit:entry.remoteProof.refCommit })).sort((a,b) => a.repository.localeCompare(b.repository));
	const dependencyPaths=new Set(['package.json','package-lock.json','npm-shrinkwrap.json','.gitmodules',...childRefs.map((entry) => entry.workspacePath)]);
	return { schemaVersion:1,kind:'treeseed.platform-root-integration-authority/v1',rootBaseCommit,rootCommit,changedPaths,
		derivedPointerPaths:changedPaths.filter((path) => dependencyPaths.has(path)),childRefs };
}

function reportForNode(nodePath: string, result: RepositorySaveResult) {
	return [result.rootRepo, ...result.repos].find((report) => resolve(report.path) === resolve(nodePath)) ?? null;
}

function governedAssignmentCommits(path: string, commit: string) {
	const parse = (log: string) => {
		const chunks = log.split('\0');
		const assignments: Array<{ commit: string; assignmentId: string }> = [];
		for (let index = 0; index + 1 < chunks.length; index += 2) {
			const commitSha = chunks[index]?.trim() ?? '';
			const body = chunks[index + 1] ?? '';
			for (const match of body.matchAll(/^Treeseed-Assignment:\s*(\S+)\s*$/gimu)) assignments.push({ commit: commitSha, assignmentId: match[1]! });
		}
		return assignments;
	};
	for (const ref of ['origin/staging', 'origin/main']) {
		const base = runRepositoryGit(['merge-base', ref, commit], { cwd: path, mode: 'read', allowFailure: true });
		if (base.status === 0 && base.stdout.trim()) {
			const log = runRepositoryGit(['log', '--format=%H%x00%B%x00', `${base.stdout.trim()}..${commit}`], { cwd: path, mode: 'read', allowFailure: false }).stdout;
			return parse(log);
		}
	}
	const assignments = parse(runRepositoryGit(['log', '--format=%H%x00%B%x00', commit], { cwd: path, mode: 'read', allowFailure: false }).stdout);
	if (assignments.length) throw new Error('Cannot establish the staging merge base for governed commit coverage.');
	return assignments;
}

function authorityCoverageBlockers(path: string, commit: string, authorities: GovernedExecutionAuthority[]) {
	const blockers: string[] = [];
	for (const authority of authorities) {
		if(authority.executionMode!=='production'||authority.upstreamMutationPolicy!=='exact-approved-ref') {
			blockers.push(`Assignment ${authority.assignmentId} has ${authority.executionMode}/${authority.upstreamMutationPolicy} authority and cannot cover an upstream save.`);
			continue;
		}
		const unchanged = runRepositoryGit(['diff', '--quiet', authority.integratedCommit, commit, '--', ...authority.changedPaths], {
			cwd: path, mode: 'read', allowFailure: true,
		}).status === 0;
		if (!unchanged) blockers.push(`Governed paths for assignment ${authority.assignmentId} changed after authority commit ${authority.integratedCommit}.`);
	}
	for (const marker of governedAssignmentCommits(path, commit)) {
		const authority = authorities.find((candidate) => candidate.assignmentId === marker.assignmentId && candidate.checkpointCommit === marker.commit);
		if (!authority) blockers.push(`Assignment checkpoint ${marker.commit} (${marker.assignmentId}) has no matching governed execution authority.`);
	}
	return blockers;
}

function verifiedRepository(input: {
	root: string;
	branch: string;
	node: ReturnType<typeof discoverRepositorySaveNodes>[number];
	report: RepositorySaveReport;
	namesById: Map<string, string>;
	worksetBases: Map<string, WorksetBase>;
}): IntegrationRepository {
	const { root,branch,node,report,namesById,worksetBases } = input;
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
	const authorityBlockers = authorityCoverageBlockers(node.path, commit, executionAuthorities);
	const worksetBase = worksetBases.get(relative(root, node.path).replaceAll('\\', '/') || '.');
	if (worksetBase && repositoryIdentityKey(worksetBase.repository) !== canonicalKey) authorityBlockers.push('Verified workset repository identity does not match the saved repository.');
	if (worksetBase) authorityBlockers.push(...worksetAuthorityBlockers(node.path, commit, worksetBase, executionAuthorities));
	if (authorityBlockers.length) throw new Error(`${node.name} governance coverage failed: ${authorityBlockers.join(' ')}`);
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
	const worksetBases = platformWorksetBases(input.root);
	const repositories = nodes.map((node) => {
		const report = reportForNode(node.path, input.result);
		if (!report) throw new Error(`Saved repository report is missing for ${node.name}.`);
		return verifiedRepository({ root: input.root, branch: input.branch, node, report, namesById, worksetBases });
	}).sort((left, right) => left.repository.canonicalKey.localeCompare(right.repository.canonicalKey));
	const rootReport=reportForNode(input.gitRoot,input.result);
	const rootAuthority=input.result.repositoryScope === 'federated' && rootReport ? platformRootAuthority(input.gitRoot,rootReport,repositories) : null;
	const receiptId = integrationChangeSetReceiptId({ sourceBranch: input.branch, scope: input.result.repositoryScope, repositories,rootAuthority });
	return writeReceipt(input.root, {
		schemaVersion: 2,
		kind: 'treeseed.integration-change-set/v2',
		receiptId,
		runId: input.runId,
		sourceBranch: input.branch,
		createdAt: new Date().toISOString(),
		scope: input.result.repositoryScope,
		repositories,
		rootAuthority,
	});
}

export function integrationChangeSetBlockers(root: string, branch: string) {
	const receipt = readLatestIntegrationChangeSet(root);
	if (!receipt) return ['No integration change-set receipt is available. Run `trsd save` first.'];
	const blockers: string[] = [];
	if (receipt.scope !== 'federated') blockers.push('The latest integration receipt is repository-scoped. Run `trsd save --federated` before staging.');
	if (receipt.sourceBranch !== branch) blockers.push(`Integration receipt is for ${receipt.sourceBranch}, not ${branch}.`);
	if (receipt.scope === 'federated') {
		const authority=receipt.rootAuthority;
		const rootRepository=receipt.repositories.find((entry) => entry.role === 'root');
		if (!authority || !rootRepository || authority.rootCommit !== rootRepository.commit) blockers.push('Platform root base and pointer-update authority is missing or stale.');
		else {
			const current=runRepositoryGit(['rev-parse',authority.rootCommit],{ cwd:root,mode:'read',allowFailure:true });
			if (current.status !== 0) blockers.push(`Platform root authority commit ${authority.rootCommit} is unavailable locally.`);
			const childKeys=new Set(receipt.repositories.filter((entry) => entry.role !== 'root').map((entry) => `${entry.repository.canonicalKey}:${entry.commit}`));
			for (const child of authority.childRefs) if (!childKeys.has(`${child.repository}:${child.commit}`)) blockers.push(`Platform root authority child ${child.repository}@${child.commit} is absent from the federation receipt.`);
		}
	}
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
		try { blockers.push(...authorityCoverageBlockers(path, repository.commit, repository.executionAuthorities ?? []).map((entry) => `${repository.name}: ${entry}`)); }
		catch (error) { blockers.push(`${repository.name} governance coverage could not be verified: ${error instanceof Error ? error.message : String(error)}`); }
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

export async function validateIntegrationGovernanceAuthorities(
	root: string,
	validator: ((authorities: GovernedExecutionAuthority[]) => Promise<Array<{ authorityId: string | null; valid: boolean; code: string | null; message: string | null }>>) | undefined,
) {
	const receipt = readLatestIntegrationChangeSet(root);
	if (!receipt) return { status: 'not_required' as const, checkedAt: null, authorityIds: [], results: [], blockers: [] };
	const authorities = receipt.repositories.flatMap((repository) => repository.executionAuthorities ?? []);
	if (!authorities.length) return { status: 'not_required' as const, checkedAt: null, authorityIds: [], results: [], blockers: [] };
	const authorityIds = authorities.map((authority) => authority.authorityId).sort();
	if (!validator) return { status: 'failed' as const, checkedAt: new Date().toISOString(), authorityIds, results: [], blockers: ['The integration receipt contains governed execution, but no control-plane authority validator is configured.'] };
	let results: Awaited<ReturnType<NonNullable<typeof validator>>>;
	try { results = await validator(authorities); }
	catch (error) { return { status: 'failed' as const, checkedAt: new Date().toISOString(), authorityIds, results: [], blockers: [`Governance authority validation failed: ${error instanceof Error ? error.message : String(error)}`] }; }
	const byId = new Map(results.map((result) => [result.authorityId, result]));
	const blockers = authorities.flatMap((authority) => {
		const result = byId.get(authority.authorityId);
		if (!result) return [`Governance authority ${authority.authorityId} was not validated by the control plane.`];
		return result.valid ? [] : [`Governance authority ${authority.authorityId} is invalid${result.code ? ` (${result.code})` : ''}: ${result.message ?? 'current decision authority was not proven.'}`];
	});
	return { status: blockers.length ? 'failed' as const : 'passed' as const, checkedAt: new Date().toISOString(), authorityIds, results, blockers };
}

export async function integrationGovernanceAuthorityBlockers(
	root: string,
	validator: ((authorities: GovernedExecutionAuthority[]) => Promise<Array<{ authorityId: string | null; valid: boolean; code: string | null; message: string | null }>>) | undefined,
) {
	return (await validateIntegrationGovernanceAuthorities(root, validator)).blockers;
}
