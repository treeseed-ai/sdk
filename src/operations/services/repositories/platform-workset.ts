import { createHash } from 'node:crypto';
import { existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,renameSync,rmSync,writeFileSync } from 'node:fs';
import { dirname,relative,resolve } from 'node:path';
import { resolveRepositoryIdentity } from '../../../repositories/repository-identity.js';
import { resolveGitHubCredentialForRepository } from '../configuration/github-credentials.js';
import { resolveMachineEnvironmentValues } from '../config-runtime/support/resolve-entry-value-from-buckets.js';
import { classifyGitMode,runRepositoryGit } from '../operations/git-runner.js';

export type PlatformWorksetAction = {
	projectId: string;
	role: string;
	path: string;
	repository: string;
	commit: string;
	sourceBranch: string;
	branch: string | null;
	custody: 'read-only' | 'assignment-write';
	action: 'create' | 'noop' | 'blocked';
	reason: string;
};

export type PlatformWorksetPlan = {
	schemaVersion: 2;
	kind: 'treeseed.platform-workset-plan';
	root: string;
	teamId: string;
	branch: string | null;
	authority: PlatformWorksetAuthority | null;
	actions: PlatformWorksetAction[];
	summary: { create: number; noop: number; blocked: number };
};

export type PlatformWorksetInventoryRepository = {
	projectId: string;
	role: string;
	path: string;
	repository: string;
	branch: string;
};

export type PlatformWorksetReceipt = {
	schemaVersion: 1 | 2;
	kind: 'treeseed.platform-workset-receipt';
	status: 'verified';
	teamId: string;
	branch: string | null;
	authority?: PlatformWorksetAuthority | null;
	inventoryDigest: string;
	completed: PlatformWorksetAction[];
	updatedAt: string;
};

export type PlatformWorksetAuthority = {
	schemaVersion: 1;
	kind: 'treeseed.governed-workset-authority';
	status: 'active';
	teamId: string;
	projectId: string;
	decisionId: string;
	capacityPlanId: string;
	workDayId: string;
	assignmentId: string;
	mode: 'acting';
	baseCommit: string;
	expiresAt: string;
};

type ObservedRepository = PlatformWorksetInventoryRepository & { commit: string };

function validateRepository(root: string, value: PlatformWorksetInventoryRepository, index: number): PlatformWorksetInventoryRepository {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Platform team inventory repository ${index} is invalid.`);
	const entry = value as Record<string, unknown>;
	const projectId = typeof entry.projectId === 'string' ? entry.projectId.trim() : '';
	const role = typeof entry.role === 'string' ? entry.role.trim() : '';
	const path = typeof entry.path === 'string' ? entry.path.trim().replaceAll('\\', '/') : '';
	const repository = typeof entry.repository === 'string' ? entry.repository.trim() : '';
	const branch = typeof entry.branch === 'string' ? entry.branch.trim() : '';
	if (!projectId || !role || !repository || !branch) throw new Error(`Platform team inventory repository ${index} is missing projectId, role, repository, or branch.`);
	if (!path || path.startsWith('/') || path.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error(`Platform inventory path "${path}" must be a safe relative path.`);
	if (['.git', '.treeseed', 'node_modules'].includes(path.split('/')[0]!)) throw new Error(`Platform inventory path "${path}" uses a reserved directory.`);
	const target = resolve(root, path);
	if (relative(resolve(root), target).startsWith('..')) throw new Error(`Platform inventory path "${path}" escapes the workspace.`);
	const identity = resolveRepositoryIdentity(repository.includes('://') || repository.startsWith('/') ? repository : `https://github.com/${repository}.git`);
	if (/^(market|market-api)$/u.test(identity.repository) || identity.repository.endsWith('-content')) throw new Error(`Platform cannot materialize ${repository}.`);
	return { projectId, role, path, repository, branch };
}

function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv | Record<string, string | undefined>, allowFailure = false) {
	return runRepositoryGit(args, { cwd, env, allowFailure, mode: classifyGitMode(args) });
}

function repositoryUrl(repository: string) {
	return resolveRepositoryIdentity(repository.includes('://') || repository.startsWith('/') ? repository : `https://github.com/${repository}.git`).canonicalRemoteUrl;
}

function observeRepository(root: string, entry: PlatformWorksetInventoryRepository, env: NodeJS.ProcessEnv | Record<string, string | undefined>): ObservedRepository {
	const result = git(root, ['ls-remote', repositoryUrl(entry.repository), `refs/heads/${entry.branch}`], credentialEnvironment(root, entry.repository, env), true);
	const commit = result.status === 0 ? result.stdout.trim().split(/\s+/u)[0]?.toLowerCase() ?? '' : '';
	if (!/^[a-f0-9]{40}$/u.test(commit)) throw new Error(`Live branch ${entry.repository}@${entry.branch} could not be resolved to an exact commit.`);
	return { ...entry, commit };
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

function classifyExisting(root: string, entry: ObservedRepository, branch: string | null, custody: PlatformWorksetAction['custody']): PlatformWorksetAction {
	const target = resolve(root, entry.path);
	if (!existsSync(target)) return { ...entry, sourceBranch: entry.branch, branch, custody, action: 'create', reason: 'Materialize the exact live team-inventory commit as an independent repository.' };
	const actionEntry = { ...entry, sourceBranch: entry.branch, branch, custody };
	if (lstatSync(target).isSymbolicLink() || !lstatSync(target).isDirectory()) return { ...actionEntry, action: 'blocked', reason: 'The workset path exists but is not an independent repository directory.' };
	const top = git(target, ['rev-parse', '--show-toplevel'], undefined, true);
	if (top.status !== 0 || resolve(top.stdout.trim()) !== resolve(target)) return { ...actionEntry, action: 'blocked', reason: 'The workset path is not an independent Git repository.' };
	const origin = git(target, ['remote', 'get-url', 'origin'], undefined, true);
	if (origin.status !== 0 || resolveRepositoryIdentity(origin.stdout.trim()).canonicalKey !== resolveRepositoryIdentity(repositoryUrl(entry.repository)).canonicalKey) return { ...actionEntry, action: 'blocked', reason: 'The existing checkout has a different canonical origin repository.' };
	if (git(target, ['status', '--porcelain']).stdout.trim()) return { ...actionEntry, action: 'blocked', reason: 'The existing checkout has uncommitted changes.' };
	const head = git(target, ['rev-parse', 'HEAD'], undefined, true).stdout.trim();
	if (head !== entry.commit) return { ...actionEntry, action: 'blocked', reason: `The existing checkout is at ${head || 'an unknown commit'}, not ${entry.commit}.` };
	const currentBranch = git(target, ['branch', '--show-current'], undefined, true).stdout.trim() || null;
	if (currentBranch !== branch) return { ...actionEntry, action: 'blocked', reason: branch ? `The exact checkout is not on requested branch ${branch}.` : 'The exact checkout must be detached when no work branch is requested.' };
	return { ...actionEntry, action: 'noop', reason: 'The independent checkout already matches the exact observed team-inventory ref.' };
}

function summarize(actions: PlatformWorksetAction[]) {
	return {
		create: actions.filter((entry) => entry.action === 'create').length,
		noop: actions.filter((entry) => entry.action === 'noop').length,
		blocked: actions.filter((entry) => entry.action === 'blocked').length,
	};
}

function validateAuthority(teamId: string, authority: PlatformWorksetAuthority | null, repositories: PlatformWorksetInventoryRepository[]) {
	if (!authority) return;
	if (authority.schemaVersion !== 1 || authority.kind !== 'treeseed.governed-workset-authority' || authority.status !== 'active' || authority.mode !== 'acting') throw new Error('Writable Platform workset authority is invalid or inactive.');
	for (const [field, value] of Object.entries({ decisionId: authority.decisionId, capacityPlanId: authority.capacityPlanId, workDayId: authority.workDayId, assignmentId: authority.assignmentId })) {
		if (!value.trim()) throw new Error(`Writable Platform workset authority is missing ${field}.`);
	}
	if (authority.teamId !== teamId) throw new Error('Writable Platform workset authority belongs to a different team.');
	if (!repositories.some((entry) => entry.projectId === authority.projectId)) throw new Error('Writable Platform workset authority project is absent from the team inventory.');
	if (!/^[a-f0-9]{40}$/u.test(authority.baseCommit)) throw new Error('Writable Platform workset authority requires an exact base commit.');
	if (!Number.isFinite(Date.parse(authority.expiresAt)) || Date.parse(authority.expiresAt) <= Date.now()) throw new Error('Writable Platform workset authority is expired.');
}

export function planPlatformWorkset(input: { root: string; teamId: string; inventory: PlatformWorksetInventoryRepository[]; branch?: string | null; authority?: PlatformWorksetAuthority | null; env?: NodeJS.ProcessEnv | Record<string, string | undefined> }) {
	const root = resolve(input.root);
	const teamId = input.teamId.trim();
	if (!teamId) throw new Error('Platform workset requires an authenticated team inventory identity.');
	const branch = input.branch?.trim() || null;
	if (branch && (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(branch) || branch.includes('..') || branch.endsWith('/') || branch.includes('//'))) throw new Error(`Invalid workset branch "${branch}".`);
	const repositories = input.inventory.map((entry, index) => validateRepository(root, entry, index));
	const authority = input.authority ?? null;
	validateAuthority(teamId, authority, repositories);
	if (branch && !authority) throw new Error('A writable Platform workset branch requires an active acting-assignment authority.');
	if (repositories.length === 0) throw new Error(`Team ${teamId} has no materializable project repositories.`);
	const paths = new Set<string>();
	const identities = new Set<string>();
	for (const entry of repositories) {
		if (paths.has(entry.path)) throw new Error(`Platform team inventory contains duplicate path ${entry.path}.`);
		const identity = resolveRepositoryIdentity(repositoryUrl(entry.repository)).canonicalKey;
		if (identities.has(identity)) throw new Error(`Platform team inventory contains duplicate repository ${entry.repository}.`);
		paths.add(entry.path); identities.add(identity); ensureContained(root, resolve(root, entry.path));
	}
	const observed = repositories.map((entry) => observeRepository(root, entry, input.env ?? process.env));
	if (authority) {
		const owned = observed.find((entry) => entry.projectId === authority.projectId)!;
		if (owned.commit !== authority.baseCommit) throw new Error(`Acting assignment base ${authority.baseCommit} is stale; live inventory resolved ${owned.commit}.`);
	}
	const actions = observed.map((entry) => {
		const writable = Boolean(authority && entry.projectId === authority.projectId);
		return classifyExisting(root, entry, writable ? branch : null, writable ? 'assignment-write' : 'read-only');
	});
	return { schemaVersion: 2, kind: 'treeseed.platform-workset-plan', root, teamId, branch, authority, actions, summary: summarize(actions) } satisfies PlatformWorksetPlan;
}

function journalPath(root: string) {
	return resolve(root, '.treeseed', 'worksets', 'platform', 'latest.json');
}

function inventoryDigest(actions: PlatformWorksetAction[], authority?: PlatformWorksetAuthority | null) {
	return createHash('sha256').update(JSON.stringify({
		repositories: actions.map(({ projectId, role, path, repository, sourceBranch, commit }) =>
			({ projectId, role, path, repository, branch: sourceBranch, commit })),
		...(authority ? { authority } : {}),
	})).digest('hex');
}

export function verifiedPlatformWorksetReceipt(root: string): PlatformWorksetReceipt | null {
	const path = journalPath(root);
	if (!existsSync(path)) return null;
	try {
		const receipt = JSON.parse(readFileSync(path, 'utf8')) as PlatformWorksetReceipt;
		if (![1, 2].includes(receipt.schemaVersion) || receipt.kind !== 'treeseed.platform-workset-receipt' || receipt.status !== 'verified' || !Array.isArray(receipt.completed)) return null;
		const digest = receipt.schemaVersion === 1
			? createHash('sha256').update(JSON.stringify(receipt.completed.map(({ projectId, role, path, repository, sourceBranch, commit }) =>
				({ projectId, role, path, repository, branch: sourceBranch, commit })))).digest('hex')
			: inventoryDigest(receipt.completed, receipt.authority);
		return receipt.inventoryDigest === digest ? receipt : null;
	} catch {
		return null;
	}
}

function persistJournal(plan: PlatformWorksetPlan, completed: PlatformWorksetAction[], status: 'partial' | 'verified') {
	const path = journalPath(plan.root);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify({ schemaVersion: 2, kind: 'treeseed.platform-workset-receipt', status, teamId: plan.teamId, branch: plan.branch, authority: plan.authority, inventoryDigest: inventoryDigest(plan.actions, plan.authority), completed, updatedAt: new Date().toISOString() }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
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
				if (remoteCommit !== action.commit) throw new Error(`Remote work branch ${action.repository}@${action.branch} is ${remoteCommit}, not observed inventory commit ${action.commit}.`);
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

export function applyPlatformWorkset(input: { root: string; teamId: string; inventory: PlatformWorksetInventoryRepository[]; branch?: string | null; authority?: PlatformWorksetAuthority | null; env?: NodeJS.ProcessEnv | Record<string, string | undefined> }) {
	const plan = planPlatformWorkset(input);
	if (plan.summary.blocked) throw new Error(plan.actions.filter((entry) => entry.action === 'blocked').map((entry) => `${entry.path}: ${entry.reason}`).join('\n'));
	const completed = plan.actions.filter((entry) => entry.action === 'noop');
	for (const action of plan.actions.filter((entry) => entry.action === 'create')) {
		materialize(plan, action, input.env ?? process.env);
		const verified = classifyExisting(plan.root, {
			projectId: action.projectId, role: action.role, path: action.path, repository: action.repository,
			branch: action.sourceBranch, commit: action.commit,
		}, action.branch, action.custody);
		if (verified.action !== 'noop') throw new Error(`Fresh workset verification failed for ${action.path}: ${verified.reason}`);
		completed.push(verified); persistJournal(plan, completed, completed.length === plan.actions.length ? 'verified' : 'partial');
	}
	if (completed.length === plan.actions.length) persistJournal(plan, completed, 'verified');
	return { ...plan, actions: completed, summary: summarize(completed), receiptPath: journalPath(plan.root), status: 'verified' as const };
}
