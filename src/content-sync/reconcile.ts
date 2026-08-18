import { runRepositoryGit } from '../operations/services/operations/git-runner.ts';

export type ContentSyncStatus = 'up-to-date' | 'fast-forward' | 'verification-required' | 'blocked';

export interface ContentSyncPlan {
	repositoryRoot: string;
	branch: string;
	localHead: string;
	upstreamHead: string | null;
	treeDxHead: string | null;
	publishedHead: string | null;
	publicationRevision: string | null;
	remoteUrl: string | null;
	canonicalRemoteUrl: string | null;
	providerHead: string | null;
	dirtyPaths: string[];
	status: ContentSyncStatus;
	blockers: string[];
}

export interface ContentSyncInput {
	repositoryRoot: string;
	branch: string;
	treeDxHead: string | null;
	publishedHead: string | null;
	publicationRevision: string | null;
	canonicalRemoteUrl?: string | null;
	providerHead?: string | null;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}

function output(root: string, args: string[], env?: ContentSyncInput['env']) {
	return runRepositoryGit(args, { cwd: root, mode: 'read', env }).stdout.trim();
}

function remoteHead(root: string, branch: string, env?: ContentSyncInput['env']) {
	const result = runRepositoryGit(['ls-remote', '--heads', 'origin', `refs/heads/${branch}`], {
		cwd: root, mode: 'read', allowFailure: true, env,
	});
	if (result.status !== 0) return null;
	return result.stdout.trim().split(/\s+/u)[0] || null;
}

function isAncestor(root: string, ancestor: string, descendant: string) {
	return runRepositoryGit(['merge-base', '--is-ancestor', ancestor, descendant], {
		cwd: root, mode: 'read', allowFailure: true,
	}).status === 0;
}

function hasCommit(root: string, commit: string) {
	return runRepositoryGit(['cat-file', '-e', `${commit}^{commit}`], {
		cwd: root, mode: 'read', allowFailure: true,
	}).status === 0;
}

function normalizedRemote(value: string | null | undefined) {
	return value?.trim().replace(/\.git$/u, '').replace(/\/$/u, '').toLowerCase() ?? null;
}

export function planContentSync(input: ContentSyncInput): ContentSyncPlan {
	const repositoryRoot = output(input.repositoryRoot, ['rev-parse', '--show-toplevel'], input.env);
	const branch = output(repositoryRoot, ['rev-parse', '--abbrev-ref', 'HEAD'], input.env);
	const localHead = output(repositoryRoot, ['rev-parse', 'HEAD'], input.env);
	const dirtyPaths = output(repositoryRoot, ['status', '--porcelain=v1'], input.env)
		.split(/\r?\n/u).filter(Boolean).map((line) => line.slice(3));
	const remoteUrl = runRepositoryGit(['remote', 'get-url', 'origin'], {
		cwd: repositoryRoot, mode: 'read', allowFailure: true, env: input.env,
	}).stdout.trim() || null;
	const upstreamHead = remoteUrl ? remoteHead(repositoryRoot, input.branch, input.env) : null;
	const blockers: string[] = [];
	if (branch === 'HEAD') blockers.push('The local checkout is detached.');
	if (branch !== input.branch) blockers.push(`The local branch is ${branch}; expected ${input.branch}.`);
	if (dirtyPaths.length) blockers.push('The local checkout has uncommitted changes. Save them before content sync.');
	if (!remoteUrl) blockers.push('The repository has no origin remote.');
	if (input.canonicalRemoteUrl && normalizedRemote(remoteUrl) !== normalizedRemote(input.canonicalRemoteUrl)) {
		blockers.push(`The local origin ${remoteUrl ?? 'is unavailable'}; the project binding requires ${input.canonicalRemoteUrl}.`);
	}
	if (!upstreamHead) blockers.push(`The origin branch ${input.branch} is unavailable.`);
	if (!input.providerHead) blockers.push('The repository provider did not resolve the publication ref.');
	if (upstreamHead && input.providerHead && upstreamHead !== input.providerHead) {
		blockers.push(`The provider resolves ${input.providerHead}, but origin/${input.branch} resolves ${upstreamHead}. Re-plan after provider reconciliation.`);
	}
	if (!input.treeDxHead) blockers.push('TreeDX did not resolve the requested publication ref.');
	if (!input.publishedHead || !input.publicationRevision) blockers.push('The project is not included in an atomic knowledge publication.');
	if (upstreamHead && input.treeDxHead && upstreamHead !== input.treeDxHead) {
		blockers.push(`TreeDX resolves ${input.treeDxHead}, but origin/${input.branch} resolves ${upstreamHead}. Refresh TreeDX before syncing the checkout.`);
	}
	if (upstreamHead && input.publishedHead && upstreamHead !== input.publishedHead) {
		blockers.push(`Published knowledge resolves ${input.publishedHead}, but origin/${input.branch} resolves ${upstreamHead}. Publish the exact source closure before syncing the checkout.`);
	}
	const upstreamCommitAvailable = Boolean(upstreamHead && hasCommit(repositoryRoot, upstreamHead));
	const remoteCanFastForward = !upstreamHead || localHead === upstreamHead
		|| (upstreamCommitAvailable && isAncestor(repositoryRoot, localHead, upstreamHead));
	if (upstreamHead && localHead !== upstreamHead && upstreamCommitAvailable && !remoteCanFastForward) {
		blockers.push('The local checkout and publication ref have diverged; fast-forward sync is unsafe.');
	}
	const needsVerification = Boolean(upstreamHead && localHead !== upstreamHead && !upstreamCommitAvailable);
	return {
		repositoryRoot, branch, localHead, upstreamHead, treeDxHead: input.treeDxHead,
		publishedHead: input.publishedHead, publicationRevision: input.publicationRevision, remoteUrl,
		canonicalRemoteUrl: input.canonicalRemoteUrl ?? null, providerHead: input.providerHead ?? null, dirtyPaths,
		status: blockers.length
			? 'blocked'
			: localHead === upstreamHead
				? 'up-to-date'
				: needsVerification ? 'verification-required' : 'fast-forward',
		blockers,
	};
}

export function applyContentSync(expected: ContentSyncPlan, env?: ContentSyncInput['env']) {
	const current = planContentSync({
		repositoryRoot: expected.repositoryRoot, branch: expected.branch, treeDxHead: expected.treeDxHead,
		publishedHead: expected.publishedHead, publicationRevision: expected.publicationRevision,
		canonicalRemoteUrl: expected.canonicalRemoteUrl, providerHead: expected.providerHead, env,
	});
	if (current.blockers.length) throw new Error(`Content sync is blocked:\n- ${current.blockers.join('\n- ')}`);
	if (current.localHead !== expected.localHead || current.upstreamHead !== expected.upstreamHead) {
		throw new Error('Content sync state changed after planning. Run the plan again.');
	}
	if (current.status === 'up-to-date') return current;
	runRepositoryGit(['fetch', 'origin', current.branch], { cwd: current.repositoryRoot, mode: 'mutate', env });
	const fetchedHead = output(current.repositoryRoot, ['rev-parse', `origin/${current.branch}`], env);
	if (fetchedHead !== current.upstreamHead) throw new Error('The upstream ref changed during content sync. Run the plan again.');
	if (!isAncestor(current.repositoryRoot, current.localHead, fetchedHead)) {
		throw new Error('The local checkout and publication ref have diverged; fast-forward sync is unsafe.');
	}
	runRepositoryGit(['merge', '--ff-only', `origin/${current.branch}`], { cwd: current.repositoryRoot, mode: 'mutate', env });
	return planContentSync({ repositoryRoot: current.repositoryRoot, branch: current.branch, treeDxHead: current.treeDxHead,
		publishedHead: current.publishedHead, publicationRevision: current.publicationRevision,
		canonicalRemoteUrl: current.canonicalRemoteUrl, providerHead: current.providerHead, env });
}
