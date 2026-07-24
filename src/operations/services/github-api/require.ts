import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { Octokit } from 'octokit';
import { createManagedToolEnv, resolveToolBinary } from '../../../entrypoints/runtime/managed-dependencies.ts';
import { resolveGitHubToken } from '../../../configuration/service-credentials.ts';
import { sleep } from './get-latest-git-hub-workflow-run.ts';

export const require = createRequire(import.meta.url);

export const sodium = require('libsodium-wrappers');

export const DEFAULT_GITHUB_API_TIMEOUT_MS = 60000;

export type GitHubApiClient = Octokit;

export interface GitHubRepositoryMetadataInput {
	owner: string;
	name: string;
	description?: string | null;
	homepageUrl?: string | null;
	visibility?: 'private' | 'public' | 'internal';
	topics?: string[];
}

export interface GitHubRepositorySummary {
	id: number;
	owner: string;
	name: string;
	slug: string;
	url: string;
	sshUrl: string;
	httpsUrl: string;
	defaultBranch: string;
	visibility: 'private' | 'public' | 'internal';
}

export interface GitHubWorkflowRunSummary {
	id: number;
	status: string | null;
	conclusion: string | null;
	url: string | null;
	headSha: string | null;
	headBranch: string | null;
	createdAt: string | null;
	updatedAt: string | null;
}

export interface GitHubWorkflowJobSummary {
	id: number;
	name: string;
	status: string | null;
	conclusion: string | null;
	url: string | null;
	steps?: GitHubWorkflowJobStepSummary[];
}

export interface GitHubWorkflowJobStepSummary {
	name: string;
	status: string | null;
	conclusion: string | null;
}

export type GitHubWorkflowProgressEvent = {
	type: 'waiting' | 'running' | 'completed';
	repository: string;
	workflow: string;
	branch: string | null;
	headSha: string | null;
	elapsedSeconds: number;
	runId: number | null;
	url: string | null;
	status: string | null;
	conclusion: string | null;
	jobs?: GitHubWorkflowJobSummary[];
	activeJobs?: GitHubWorkflowJobSummary[];
	completedJobs?: GitHubWorkflowJobSummary[];
	failedJobs?: GitHubWorkflowJobSummary[];
};

export interface GitHubWorkflowDispatchResult {
	repository: string;
	workflow: string;
	branch: string;
	inputs: Record<string, string> | undefined;
	status: number | null;
	dispatchedAt: string;
}

export interface GitHubWorkflowCancellationResult {
	ok: boolean;
	supported: boolean;
	repository: string | null;
	runId: number | null;
	url?: string | null;
	message: string;
	cancelledAt?: string | null;
}

export interface GitHubWorkflowFileStatus {
	ok: boolean;
	exists: boolean | null;
	repository: string;
	workflow: string;
	url: string | null;
	message: string;
}

export interface GitHubWorkflowFailureSummaryInput {
	repository?: string | null;
	workflow?: string | null;
	runId?: number | string | null;
	runUrl?: string | null;
	conclusion?: string | null;
	failedJobName?: string | null;
	lastActiveStep?: string | null;
	message?: string | null;
	blockerCode?: string | null;
	retrySafe?: boolean;
	resumeSafe?: boolean;
}

export interface GitHubWorkflowFailureSummary {
	summary: string;
	provider: 'github';
	repository: string | null;
	workflow: string | null;
	runId: number | null;
	runUrl: string | null;
	inspectCommand: string | null;
	failedJobName: string | null;
	lastActiveStep: string | null;
	conclusion: string | null;
	retrySafe: boolean;
	resumeSafe: boolean;
	blockerCode: string;
}

export function normalizeGitHubVisibility(value: string | null | undefined, fallback: GitHubRepositorySummary['visibility'] = 'private') {
	const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
	return normalized === 'public' || normalized === 'internal' || normalized === 'private'
		? normalized
		: fallback;
}

export function configuredEnvValue(env: NodeJS.ProcessEnv | Record<string, string | undefined> | undefined, key: string) {
	const value = env?.[key];
	return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export function resolveGitHubApiToken(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env) {
	return resolveGitHubToken(env);
}

export function parseGitHubRepositorySlug(value: string) {
	const normalized = String(value ?? '').trim().replace(/\.git$/u, '');
	const [owner, ...rest] = normalized.split('/').filter(Boolean);
	if (!owner || rest.length === 0) {
		throw new Error(`Invalid GitHub repository slug "${value}". Expected owner/name.`);
	}
	return {
		owner,
		name: rest.join('/'),
	};
}

export function createGitHubRequestSignal(timeoutMs = DEFAULT_GITHUB_API_TIMEOUT_MS, upstreamSignal?: AbortSignal | null) {
	if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
		const timeoutSignal = AbortSignal.timeout(timeoutMs);
		if (upstreamSignal) {
			const abortSignalAny = (AbortSignal as typeof AbortSignal & {
				any?: (signals: AbortSignal[]) => AbortSignal;
			}).any;
			return typeof abortSignalAny === 'function'
				? abortSignalAny([upstreamSignal, timeoutSignal])
				: timeoutSignal;
		}
		return timeoutSignal;
	}
	return upstreamSignal ?? undefined;
}

export function createGitHubTimeoutFetch(timeoutMs = DEFAULT_GITHUB_API_TIMEOUT_MS): typeof fetch {
	const baseFetch = globalThis.fetch.bind(globalThis);
	return ((input, init) => {
		const signal = createGitHubRequestSignal(timeoutMs, init?.signal ?? null);
		return baseFetch(input, signal ? { ...init, signal } : init);
	}) as typeof fetch;
}

export function normalizeGitHubApiError(error: unknown, context: string) {
	if (error && typeof error === 'object') {
		const status = typeof (error as { status?: unknown }).status === 'number'
			? (error as { status: number }).status
			: null;
		const message = typeof (error as { message?: unknown }).message === 'string'
			? (error as { message: string }).message.trim()
			: '';
		if (status === 401 || status === 403) {
			return new Error(`${context}: GitHub authentication failed.`);
		}
		if (status === 404) {
			return new Error(`${context}: GitHub resource was not found.`);
		}
		if (status === 422) {
			return new Error(`${context}: ${message || 'GitHub rejected the request.'}`);
		}
		if (status && message) {
			return new Error(`${context}: ${message}`);
		}
	}
	if (error instanceof Error && error.message.trim()) {
		return new Error(`${context}: ${error.message.trim()}`);
	}
	return new Error(`${context}: GitHub API request failed.`);
}

export function isRetriableGitHubApiError(error: unknown) {
	const message = error instanceof Error ? error.message : String(error ?? '');
	return /timed out|timeout|aborted|ECONNRESET|ECONNREFUSED|fetch failed|socket hang up/iu.test(message);
}

export async function withGitHubApiRetries<T>(operation: () => Promise<T>, retries = 2): Promise<T> {
	let attempt = 0;
	let lastError: unknown;
	while (attempt <= retries) {
		try {
			return await operation();
		} catch (error) {
			lastError = error;
			if (attempt >= retries || !isRetriableGitHubApiError(error)) {
				throw error;
			}
			await sleep(1000 * (attempt + 1));
			attempt += 1;
		}
	}
	throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'GitHub API request failed.'));
}

export function normalizeRepositorySummary(repository: Record<string, any>): GitHubRepositorySummary {
	return {
		id: Number(repository.id ?? 0),
		owner: String(repository.owner?.login ?? repository.owner?.name ?? ''),
		name: String(repository.name ?? ''),
		slug: `${String(repository.owner?.login ?? repository.owner?.name ?? '')}/${String(repository.name ?? '')}`,
		url: String(repository.html_url ?? repository.url ?? ''),
		sshUrl: String(repository.ssh_url ?? ''),
		httpsUrl: String(repository.clone_url ?? ''),
		defaultBranch: String(repository.default_branch ?? 'main'),
		visibility: normalizeGitHubVisibility(repository.visibility, repository.private ? 'private' : 'public'),
	};
}
