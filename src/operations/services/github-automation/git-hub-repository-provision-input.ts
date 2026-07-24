import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { runRepositoryGit } from '../operations/git-runner.ts';
import { resolveEnvironmentRegistry } from '../../../platform/configuration/environment.ts';
import { packageRoot, loadCliDeployConfig } from '../agents/runtime-tools.ts';
import {
	filterManagedHostGitHubEnvironment,
	usesManagedHostOperationRequests,
} from '../hosting/audit/managed-host-security.ts';
import {
	createGitHubApiClient,
	ensureGitHubRepository,
	maybeGetGitHubRepository,
	parseGitHubRepositorySlug,
	listGitHubRepositorySecretNames,
	listGitHubRepositoryVariableNames,
	upsertGitHubRepositorySecret,
	upsertGitHubRepositoryVariable,
	waitForGitHubWorkflowRunCompletion,
} from '../repositories/github-api.ts';
import { resolveGitHubToken } from '../../../configuration/service-credentials.ts';


export interface GitHubRepositoryProvisionInput {
	owner: string;
	name: string;
	description?: string | null;
	visibility?: 'private' | 'public' | 'internal';
	homepageUrl?: string | null;
	topics?: string[];
}

export interface GitHubProvisionedRepository {
	slug: string;
	owner: string;
	name: string;
	url: string;
	sshUrl: string;
	httpsUrl: string;
	visibility: 'private' | 'public' | 'internal';
	defaultBranch: string;
}

export interface GitHubRepositoryTarget {
	owner: string;
	name: string;
	visibility: 'private' | 'public' | 'internal';
	source: 'config' | 'origin' | 'default';
}

export function envOrNull(key) {
	const value = process.env[key];
	return typeof value === 'string' && value.length > 0 ? value : null;
}

export function slugifySegment(value, fallback = 'project') {
	return String(value ?? '')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.replace(/-{2,}/g, '-')
		.slice(0, 96) || fallback;
}

export function getGitHubAutomationMode() {
	return 'real';
}

export function parseGitHubRepositoryFromRemote(remoteUrl) {
	if (!remoteUrl) {
		return null;
	}

	const sshMatch = remoteUrl.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
	if (sshMatch) {
		return `${sshMatch[1]}/${sshMatch[2]}`;
	}

	const httpsMatch = remoteUrl.match(/^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/);
	if (httpsMatch) {
		return `${httpsMatch[1]}/${httpsMatch[2]}`;
	}

	return null;
}

export function runGit(args, { cwd, allowFailure = false, capture = true } = {}) {
	const mutating = /^(add|commit|checkout|switch|merge|tag|push|fetch|worktree|submodule|reset|clean|restore|branch)$/u.test(args[0] ?? '');
	const result = runRepositoryGit(args, {
		cwd,
		mode: mutating ? 'mutate' : 'read',
		allowFailure,
	});
	if (!capture && result.stdout.trim()) process.stdout.write(result.stdout);
	if (!capture && result.stderr.trim()) process.stderr.write(result.stderr);

	if (result.status !== 0 && !allowFailure) {
		if (args[0] === 'push' && !args.includes('--force')) {
			const retryArgs = ['push', '--force', ...args.slice(1)];
			const retry = runRepositoryGit(retryArgs, {
				cwd,
				mode: 'mutate',
				allowFailure: true,
			});
			if (!capture && retry.stdout.trim()) process.stdout.write(retry.stdout);
			if (!capture && retry.stderr.trim()) process.stderr.write(retry.stderr);
			if (retry.status === 0) return retry;
			const retryDetail = retry.stderr?.trim() || retry.stdout?.trim();
			throw new Error(`git ${retryArgs.join(' ')} failed${retryDetail ? `: ${retryDetail}` : ''}`);
		}
		const detail = result.stderr?.trim() || result.stdout?.trim();
		throw new Error(`git ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
	}

	return result;
}

export function resolveGitHubRemoteUrls(owner, name) {
	const normalizedOwner = slugifySegment(owner, 'owner');
	const normalizedName = slugifySegment(name, 'repo');
	return {
		slug: `${normalizedOwner}/${normalizedName}`,
		owner: normalizedOwner,
		name: normalizedName,
		sshUrl: `git@github.com:${normalizedOwner}/${normalizedName}.git`,
		httpsUrl: `https://github.com/${normalizedOwner}/${normalizedName}.git`,
		url: `https://github.com/${normalizedOwner}/${normalizedName}`,
	};
}

export function ensureGitIdentity(cwd) {
	const currentName = runGit(['config', '--get', 'user.name'], { cwd, allowFailure: true }).stdout?.trim() ?? '';
	const currentEmail = runGit(['config', '--get', 'user.email'], { cwd, allowFailure: true }).stdout?.trim() ?? '';
	if (!currentName) {
		runGit(['config', 'user.name', envOrNull('TREESEED_GITHUB_COMMITTER_NAME') ?? 'Treeseed Launch'], { cwd });
	}
	if (!currentEmail) {
		runGit(['config', 'user.email', envOrNull('TREESEED_GITHUB_COMMITTER_EMAIL') ?? 'launch@knowledge.coop'], { cwd });
	}
}

export function resolveGitHubRepositorySlug(tenantRoot) {
	const remoteResult = runGit(['remote', 'get-url', 'origin'], { cwd: tenantRoot });
	const remoteUrl = remoteResult.stdout?.trim() ?? '';
	const repository = parseGitHubRepositoryFromRemote(remoteUrl);
	if (!repository) {
		throw new Error(`Unable to determine GitHub repository from origin remote "${remoteUrl}".`);
	}
	return repository;
}

export function maybeResolveGitHubRepositorySlug(tenantRoot) {
	try {
		return resolveGitHubRepositorySlug(tenantRoot);
	} catch {
		return null;
	}
}

export function resolveDefaultGitHubOwner() {
	const explicit = envOrNull('TREESEED_GITHUB_OWNER');
	if (explicit) {
		return explicit;
	}
	try {
		const repository = maybeResolveGitHubRepositorySlug(process.cwd());
		if (repository?.includes('/')) {
			return repository.split('/')[0];
		}
	} catch {
		// Ignore local remote resolution failures.
	}
	return 'treeseed-ai';
}

export function normalizeGitHubVisibility(value: unknown): GitHubRepositoryTarget['visibility'] {
	const normalized = String(value ?? '').trim().toLowerCase();
	return normalized === 'public' || normalized === 'internal' || normalized === 'private'
		? normalized
		: 'private';
}

export function configuredValue(values: Record<string, string | undefined> | undefined, key: string) {
	const value = values?.[key] ?? process.env[key];
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';
}

export function resolveGitHubRepositoryTarget(
	tenantRoot: string,
	{
		values = {},
		defaultName,
	}: {
		values?: Record<string, string | undefined>;
		defaultName?: string;
	} = {},
): GitHubRepositoryTarget {
	const origin = maybeResolveGitHubRepositorySlug(tenantRoot);
	const parsedOrigin = origin ? parseGitHubRepositorySlug(origin) : null;
	const owner = configuredValue(values, 'TREESEED_GITHUB_OWNER') || parsedOrigin?.owner || '';
	const name = configuredValue(values, 'TREESEED_GITHUB_REPOSITORY_NAME') || parsedOrigin?.name || defaultName || 'project';
	if (!owner) {
		throw new Error('Configure TREESEED_GITHUB_OWNER before GitHub repository bootstrap.');
	}
	return {
		owner: slugifySegment(owner, 'owner'),
		name: slugifySegment(name, 'project'),
		visibility: normalizeGitHubVisibility(configuredValue(values, 'TREESEED_GITHUB_REPOSITORY_VISIBILITY')),
		source: configuredValue(values, 'TREESEED_GITHUB_OWNER') || configuredValue(values, 'TREESEED_GITHUB_REPOSITORY_NAME')
			? 'config'
			: parsedOrigin
				? 'origin'
				: 'default',
	};
}

export function ensureGitRepositoryInitialized(cwd: string, defaultBranch: string) {
	const insideWorkTree = runGit(['rev-parse', '--is-inside-work-tree'], { cwd, allowFailure: true }).stdout?.trim() === 'true';
	if (!insideWorkTree) {
		runGit(['init', '-b', defaultBranch], { cwd });
	}
	ensureGitIdentity(cwd);
}

export function ensureOriginRemote(cwd: string, repository: { sshUrl: string; httpsUrl: string }, remoteName = 'origin') {
	const currentRemote = runGit(['remote', 'get-url', remoteName], { cwd, allowFailure: true }).stdout?.trim() ?? '';
	if (!currentRemote) {
		runGit(['remote', 'add', remoteName, repository.sshUrl], { cwd });
		return { changed: true, previous: null, next: repository.sshUrl };
	}
	if (currentRemote !== repository.sshUrl && currentRemote !== repository.httpsUrl) {
		runGit(['remote', 'set-url', remoteName, repository.sshUrl], { cwd });
		return { changed: true, previous: currentRemote, next: repository.sshUrl };
	}
	return { changed: false, previous: currentRemote, next: currentRemote };
}

export function pushAllGitHubRefs(cwd: string, remoteName = 'origin') {
	runGit(['push', '-u', remoteName, '--all'], { cwd, capture: false });
	runGit(['push', remoteName, '--tags'], { cwd, capture: false });
}
