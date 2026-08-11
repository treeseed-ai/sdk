import { createHash } from 'node:crypto';
import { existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,renameSync,rmSync,writeFileSync } from 'node:fs';
import { dirname,relative,resolve } from 'node:path';
import { resolveRepositoryIdentity } from '../../../repositories/repository-identity.js';
import { resolveGitHubCredentialForRepository } from '../configuration/github-credentials.js';
import { resolveMachineEnvironmentValues } from '../config-runtime/support/resolve-entry-value-from-buckets.js';
import { classifyGitMode,runRepositoryGit } from '../operations/git-runner.js';

export type PlatformWorksetAction = {
	path: string;
	repository: string;
	commit: string;
	branch: string | null;
	action: 'create' | 'noop' | 'blocked';
	reason: string;
};

export type PlatformWorksetPlan = {
	schemaVersion: 1;
	kind: 'treeseed.platform-workset-plan';
	root: string;
	branch: string | null;
	actions: PlatformWorksetAction[];
	summary: { create: number; noop: number; blocked: number };
};

type PortfolioRepository = { path: string; repository: string; commit: string };

function readPortfolio(root: string) {
	const path = resolve(root, 'treeseed.portfolio.json');
	if (!existsSync(path)) throw new Error(`Platform portfolio is missing: ${path}`);
	const value = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
	if (value.schemaVersion !== 1 || value.kind !== 'treeseed.portfolio' || value.materialization !== 'ephemeral_workset' || !Array.isArray(value.repositories)) {
		throw new Error('Platform portfolio must be a schemaVersion 1 treeseed.portfolio with ephemeral_workset materialization.');
	}
	return value.repositories.map((entry, index) => validateRepository(root, entry, index));
}

function validateRepository(root: string, value: unknown, index: number): PortfolioRepository {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Platform portfolio repository ${index} is invalid.`);
	const entry = value as Record<string, unknown>;
	const path = typeof entry.path === 'string' ? entry.path.trim().replaceAll('\\', '/') : '';
	const repository = typeof entry.repository === 'string' ? entry.repository.trim() : '';
	const commit = typeof entry.commit === 'string' ? entry.commit.trim().toLowerCase() : '';
	if (!path || path.startsWith('/') || path.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error(`Platform portfolio path "${path}" must be a safe relative path.`);
	if (['.git', '.treeseed', 'node_modules'].includes(path.split('/')[0]!)) throw new Error(`Platform portfolio path "${path}" uses a reserved directory.`);
	const target = resolve(root, path);
	if (relative(resolve(root), target).startsWith('..')) throw new Error(`Platform portfolio path "${path}" escapes the workspace.`);
	if (!/^[a-f0-9]{40}$/u.test(commit)) throw new Error(`Platform portfolio repository ${repository || index} must use an exact 40-character commit.`);
	const identity = resolveRepositoryIdentity(repository.includes('://') || repository.startsWith('/') ? repository : `https://github.com/${repository}.git`);
	if (/^(market|market-api)$/u.test(identity.repository) || identity.repository.endsWith('-content')) throw new Error(`Platform cannot materialize ${repository}.`);
	return { path, repository, commit };
}

function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv | Record<string, string | undefined>, allowFailure = false) {
	return runRepositoryGit(args, { cwd, env, allowFailure, mode: classifyGitMode(args) });
}

function repositoryUrl(repository: string) {
	return resolveRepositoryIdentity(repository.includes('://') || repository.startsWith('/') ? repository : `https://github.com/${repository}.git`).canonicalRemoteUrl;
}

function credentialEnvironment(root: string, repository: string, env: NodeJS.ProcessEnv | Record<string, string | undefined>) {
	if (!/^treeseed-ai\//iu.test(repository)) return { ...process.env, ...env, GIT_TERMINAL_PROMPT: '0' };
	const values = resolveMachineEnvironmentValues(root, 'staging');
	const credential = resolveGitHubCredentialForRepository(repository, { values, env: { ...values, ...env } });
	if (!credential.token) return { ...process.env, ...env, GIT_TERMINAL_PROMPT: '0' };
	const basic = Buffer.from(`x-access-token:${credential.token}`, 'utf8').toString('base64');
	return { ...process.env, ...env, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader', GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`, GIT_TERMINAL_PROMPT: '0' };
}

function existingParent(path: string) {
	let candidate = path;
	while (!existsSync(candidate)) candidate = dirname(candidate);
	return candidate;
}

function ensureContained(root: string, target: string) {
	const actualRoot = realpathSync(root);
	const parent = realpathSync(existingParent(target));
	if (parent !== actualRoot && relative(actualRoot, parent).startsWith('..')) throw new Error(`Workset target escapes the Platform workspace: ${target}`);
}

function classifyExisting(root: string, entry: PortfolioRepository, branch: string | null): PlatformWorksetAction {
	const target = resolve(root, entry.path);
	if (!existsSync(target)) return { ...entry, branch, action: 'create', reason: 'Materialize the exact portfolio commit as an independent repository.' };
	if (lstatSync(target).isSymbolicLink() || !lstatSync(target).isDirectory()) return { ...entry, branch, action: 'blocked', reason: 'The workset path exists but is not an independent repository directory.' };
	const top = git(target, ['rev-parse', '--show-toplevel'], undefined, true);
	if (top.status !== 0 || resolve(top.stdout.trim()) !== resolve(target)) return { ...entry, branch, action: 'blocked', reason: 'The workset path is not an independent Git repository.' };
	const origin = git(target, ['remote', 'get-url', 'origin'], undefined, true);
	if (origin.status !== 0 || resolveRepositoryIdentity(origin.stdout.trim()).canonicalKey !== resolveRepositoryIdentity(repositoryUrl(entry.repository)).canonicalKey) return { ...entry, branch, action: 'blocked', reason: 'The existing checkout has a different canonical origin repository.' };
	if (git(target, ['status', '--porcelain']).stdout.trim()) return { ...entry, branch, action: 'blocked', reason: 'The existing checkout has uncommitted changes.' };
	const head = git(target, ['rev-parse', 'HEAD'], undefined, true).stdout.trim();
	if (head !== entry.commit) return { ...entry, branch, action: 'blocked', reason: `The existing checkout is at ${head || 'an unknown commit'}, not ${entry.commit}.` };
	const currentBranch = git(target, ['branch', '--show-current'], undefined, true).stdout.trim() || null;
	if (currentBranch !== branch) return { ...entry, branch, action: 'blocked', reason: branch ? `The exact checkout is not on requested branch ${branch}.` : 'The exact checkout must be detached when no work branch is requested.' };
	return { ...entry, branch, action: 'noop', reason: 'The independent checkout already matches the exact portfolio ref.' };
}

function summarize(actions: PlatformWorksetAction[]) {
	return {
		create: actions.filter((entry) => entry.action === 'create').length,
		noop: actions.filter((entry) => entry.action === 'noop').length,
		blocked: actions.filter((entry) => entry.action === 'blocked').length,
	};
}

export function planPlatformWorkset(input: { root: string; branch?: string | null }) {
	const root = resolve(input.root);
	const branch = input.branch?.trim() || null;
	if (branch && (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(branch) || branch.includes('..') || branch.endsWith('/') || branch.includes('//'))) throw new Error(`Invalid workset branch "${branch}".`);
	const repositories = readPortfolio(root);
	const paths = new Set<string>();
	const identities = new Set<string>();
	for (const entry of repositories) {
		if (paths.has(entry.path)) throw new Error(`Platform portfolio contains duplicate path ${entry.path}.`);
		const identity = resolveRepositoryIdentity(repositoryUrl(entry.repository)).canonicalKey;
		if (identities.has(identity)) throw new Error(`Platform portfolio contains duplicate repository ${entry.repository}.`);
		paths.add(entry.path); identities.add(identity); ensureContained(root, resolve(root, entry.path));
	}
	const actions = repositories.map((entry) => classifyExisting(root, entry, branch));
	return { schemaVersion: 1, kind: 'treeseed.platform-workset-plan', root, branch, actions, summary: summarize(actions) } satisfies PlatformWorksetPlan;
}

function journalPath(root: string) {
	return resolve(root, '.treeseed', 'worksets', 'platform', 'latest.json');
}

function persistJournal(plan: PlatformWorksetPlan, completed: PlatformWorksetAction[], status: 'partial' | 'verified') {
	const path = journalPath(plan.root);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify({ schemaVersion: 1, kind: 'treeseed.platform-workset-receipt', status, branch: plan.branch, portfolioDigest: createHash('sha256').update(JSON.stringify(plan.actions.map(({ path: target, repository, commit }) => ({ path: target, repository, commit })))).digest('hex'), completed, updatedAt: new Date().toISOString() }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

function materialize(plan: PlatformWorksetPlan, action: PlatformWorksetAction, env: NodeJS.ProcessEnv | Record<string, string | undefined>) {
	const target = resolve(plan.root, action.path);
	const parent = dirname(target); mkdirSync(parent, { recursive: true }); ensureContained(plan.root, target);
	const temporaryRoot = resolve(plan.root, '.treeseed', 'worksets', 'materializing'); mkdirSync(temporaryRoot, { recursive: true });
	const temporary = mkdtempSync(resolve(temporaryRoot, 'repository-'));
	const gitEnv = credentialEnvironment(plan.root, action.repository, env);
	try {
		git(temporary, ['init', '--quiet'], gitEnv);
		git(temporary, ['remote', 'add', 'origin', repositoryUrl(action.repository)], gitEnv);
		git(temporary, ['fetch', '--quiet', '--no-tags', '--depth=1', 'origin', action.commit], gitEnv);
		const fetched = git(temporary, ['rev-parse', 'FETCH_HEAD']).stdout.trim();
		if (fetched !== action.commit) throw new Error(`Fetched ${fetched || 'no commit'} for ${action.repository}, expected ${action.commit}.`);
		if (action.branch) {
			const remoteBranch = git(temporary, ['fetch', '--quiet', '--no-tags', '--depth=1', 'origin', `refs/heads/${action.branch}:refs/remotes/origin/${action.branch}`], gitEnv, true);
			if (remoteBranch.status === 0) {
				const remoteCommit = git(temporary, ['rev-parse', `refs/remotes/origin/${action.branch}`]).stdout.trim();
				if (remoteCommit !== action.commit) throw new Error(`Remote work branch ${action.repository}@${action.branch} is ${remoteCommit}, not portfolio commit ${action.commit}.`);
				git(temporary, ['checkout', '--quiet', '-b', action.branch, '--track', `origin/${action.branch}`], gitEnv);
			} else {
				git(temporary, ['checkout', '--quiet', '-b', action.branch, action.commit], gitEnv);
			}
		} else git(temporary, ['checkout', '--quiet', '--detach', action.commit], gitEnv);
		if (existsSync(target)) throw new Error(`Workset target appeared during materialization: ${action.path}`);
		renameSync(temporary, target);
	} finally {
		if (existsSync(temporary)) rmSync(temporary, { recursive: true, force: true });
	}
}

export function applyPlatformWorkset(input: { root: string; branch?: string | null; env?: NodeJS.ProcessEnv | Record<string, string | undefined> }) {
	const plan = planPlatformWorkset(input);
	if (plan.summary.blocked) throw new Error(plan.actions.filter((entry) => entry.action === 'blocked').map((entry) => `${entry.path}: ${entry.reason}`).join('\n'));
	const completed = plan.actions.filter((entry) => entry.action === 'noop');
	for (const action of plan.actions.filter((entry) => entry.action === 'create')) {
		materialize(plan, action, input.env ?? process.env);
		const verified = classifyExisting(plan.root, action, plan.branch);
		if (verified.action !== 'noop') throw new Error(`Fresh workset verification failed for ${action.path}: ${verified.reason}`);
		completed.push(verified); persistJournal(plan, completed, completed.length === plan.actions.length ? 'verified' : 'partial');
	}
	if (completed.length === plan.actions.length) persistJournal(plan, completed, 'verified');
	return { ...planPlatformWorkset(input), receiptPath: journalPath(plan.root), status: 'verified' as const };
}
