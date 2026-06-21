import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { Octokit } from 'octokit';
import { createTreeseedManagedToolEnv, resolveTreeseedToolBinary } from '../../managed-dependencies.ts';
import { resolveTreeseedGitHubToken } from '../../service-credentials.ts';

const require = createRequire(import.meta.url);
const sodium = require('libsodium-wrappers');

const DEFAULT_GITHUB_API_TIMEOUT_MS = 60000;

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

function normalizeGitHubVisibility(value: string | null | undefined, fallback: GitHubRepositorySummary['visibility'] = 'private') {
	const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
	return normalized === 'public' || normalized === 'internal' || normalized === 'private'
		? normalized
		: fallback;
}

function configuredEnvValue(env: NodeJS.ProcessEnv | Record<string, string | undefined> | undefined, key: string) {
	const value = env?.[key];
	return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export function resolveGitHubApiToken(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env) {
	return resolveTreeseedGitHubToken(env);
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

function createGitHubRequestSignal(timeoutMs = DEFAULT_GITHUB_API_TIMEOUT_MS, upstreamSignal?: AbortSignal | null) {
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

function createGitHubTimeoutFetch(timeoutMs = DEFAULT_GITHUB_API_TIMEOUT_MS): typeof fetch {
	const baseFetch = globalThis.fetch.bind(globalThis);
	return ((input, init) => {
		const signal = createGitHubRequestSignal(timeoutMs, init?.signal ?? null);
		return baseFetch(input, signal ? { ...init, signal } : init);
	}) as typeof fetch;
}

function normalizeGitHubApiError(error: unknown, context: string) {
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

function isRetriableGitHubApiError(error: unknown) {
	const message = error instanceof Error ? error.message : String(error ?? '');
	return /timed out|timeout|aborted|ECONNRESET|ECONNREFUSED|fetch failed|socket hang up/iu.test(message);
}

async function withGitHubApiRetries<T>(operation: () => Promise<T>, retries = 2): Promise<T> {
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

function normalizeRepositorySummary(repository: Record<string, any>): GitHubRepositorySummary {
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

export function createGitHubApiClient({
	env = process.env,
	timeoutMs = DEFAULT_GITHUB_API_TIMEOUT_MS,
}: {
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	timeoutMs?: number;
} = {}): GitHubApiClient {
	const token = resolveGitHubApiToken(env);
	if (!token) {
		throw new Error('Configure TREESEED_GITHUB_TOKEN before using Treeseed GitHub automation.');
	}
	return new Octokit({
		auth: token,
		request: {
			fetch: createGitHubTimeoutFetch(timeoutMs),
		},
	});
}

export async function getGitHubRepository(
	repository: string | { owner: string; name: string },
	{ client = createGitHubApiClient() }: { client?: GitHubApiClient } = {},
) {
	const { owner, name } = typeof repository === 'string' ? parseGitHubRepositorySlug(repository) : repository;
	try {
		const response = await client.rest.repos.get({ owner, repo: name });
		return normalizeRepositorySummary(response.data as Record<string, any>);
	} catch (error) {
		throw normalizeGitHubApiError(error, `Unable to load GitHub repository ${owner}/${name}`);
	}
}

export async function maybeGetGitHubRepository(
	repository: string | { owner: string; name: string },
	{ client = createGitHubApiClient() }: { client?: GitHubApiClient } = {},
) {
	try {
		return await getGitHubRepository(repository, { client });
	} catch (error) {
		if (/not found/iu.test(error instanceof Error ? error.message : String(error ?? ''))) {
			return null;
		}
		throw error;
	}
}

export async function ensureGitHubRepository(
	input: GitHubRepositoryMetadataInput,
	{ client = createGitHubApiClient() }: { client?: GitHubApiClient } = {},
) {
	const existing = await maybeGetGitHubRepository({ owner: input.owner, name: input.name }, { client });
	let repository = existing;
	if (!repository) {
		try {
			const viewer = await client.rest.users.getAuthenticated();
			if (viewer.data.login === input.owner) {
				const created = await client.rest.repos.createForAuthenticatedUser({
					name: input.name,
					description: input.description ?? undefined,
					homepage: input.homepageUrl ?? undefined,
					private: (input.visibility ?? 'private') !== 'public',
				});
				repository = normalizeRepositorySummary(created.data as Record<string, any>);
			} else {
				const created = await client.rest.repos.createInOrg({
					org: input.owner,
					name: input.name,
					description: input.description ?? undefined,
					homepage: input.homepageUrl ?? undefined,
					visibility: input.visibility ?? 'private',
				});
				repository = normalizeRepositorySummary(created.data as Record<string, any>);
			}
		} catch (error) {
			throw normalizeGitHubApiError(error, `Unable to create GitHub repository ${input.owner}/${input.name}`);
		}
	}
	try {
		const updated = await client.rest.repos.update({
			owner: input.owner,
			repo: input.name,
			name: input.name,
			description: input.description ?? undefined,
			homepage: input.homepageUrl ?? undefined,
			private: (input.visibility ?? repository.visibility ?? 'private') === 'private',
			visibility: input.visibility ?? repository.visibility,
		});
		repository = normalizeRepositorySummary(updated.data as Record<string, any>);
		if (Array.isArray(input.topics)) {
			await client.rest.repos.replaceAllTopics({
				owner: input.owner,
				repo: input.name,
				names: input.topics,
			});
		}
		return repository;
	} catch (error) {
		throw normalizeGitHubApiError(error, `Unable to update GitHub repository ${input.owner}/${input.name}`);
	}
}

async function paginateNames(
	request: () => Promise<Array<{ name?: string | null }>>,
) {
	const items = await request();
	return new Set(
		items
			.map((entry) => (typeof entry?.name === 'string' ? entry.name.trim() : ''))
			.filter(Boolean),
	);
}

export async function listGitHubRepositorySecretNames(
	repository: string | { owner: string; name: string },
	{ client = createGitHubApiClient() }: { client?: GitHubApiClient } = {},
) {
	const { owner, name } = typeof repository === 'string' ? parseGitHubRepositorySlug(repository) : repository;
	try {
		return await withGitHubApiRetries(() => paginateNames(() =>
			client.paginate(client.rest.actions.listRepoSecrets, {
				owner,
				repo: name,
				per_page: 100,
			}) as Promise<Array<{ name?: string | null }>>,
		));
	} catch (error) {
		throw normalizeGitHubApiError(error, `Unable to list GitHub secrets for ${owner}/${name}`);
	}
}

export async function listGitHubRepositoryVariableNames(
	repository: string | { owner: string; name: string },
	{ client = createGitHubApiClient() }: { client?: GitHubApiClient } = {},
) {
	const { owner, name } = typeof repository === 'string' ? parseGitHubRepositorySlug(repository) : repository;
	try {
		return await withGitHubApiRetries(() => paginateNames(() =>
			client.paginate(client.rest.actions.listRepoVariables, {
				owner,
				repo: name,
				per_page: 100,
			}) as Promise<Array<{ name?: string | null }>>,
		));
	} catch (error) {
		throw normalizeGitHubApiError(error, `Unable to list GitHub variables for ${owner}/${name}`);
	}
}

export async function ensureGitHubActionsEnvironment(
	repository: string | { owner: string; name: string },
	environmentName: string,
	{
		client = createGitHubApiClient(),
		branchName,
		tagName,
	}: {
		client?: GitHubApiClient;
		branchName?: string | null;
		tagName?: string | null;
	} = {},
) {
	const { owner, name: repo } = typeof repository === 'string' ? parseGitHubRepositorySlug(repository) : repository;
	const desiredPolicies = [
		...(branchName ? [{ name: branchName, type: 'branch' as const }] : []),
		...(tagName ? [{ name: tagName, type: 'tag' as const }] : []),
	];
	try {
		await withGitHubApiRetries(() => client.request('PUT /repos/{owner}/{repo}/environments/{environment_name}', {
			owner,
			repo,
			environment_name: environmentName,
			...(desiredPolicies.length > 0
				? {
					deployment_branch_policy: {
						protected_branches: false,
						custom_branch_policies: true,
					},
				}
				: {}),
		}));
		if (desiredPolicies.length > 0) {
			await ensureGitHubEnvironmentDeploymentPolicies(client, {
				owner,
				repo,
				environmentName,
				policies: desiredPolicies,
			});
		}
		return { repository: `${owner}/${repo}`, environment: environmentName };
	} catch (error) {
		throw normalizeGitHubApiError(error, `Unable to ensure GitHub environment ${environmentName} for ${owner}/${repo}`);
	}
}

async function ensureGitHubEnvironmentDeploymentPolicies(
	client: GitHubApiClient,
	{
		owner,
		repo,
		environmentName,
		policies: desiredPolicies,
	}: {
		owner: string;
		repo: string;
		environmentName: string;
		policies: Array<{ name: string; type: 'branch' | 'tag' }>;
	},
) {
	type BranchPolicy = { id?: number | null; name?: string | null; type?: string | null };
	const response = await withGitHubApiRetries(() => client.request(
		'GET /repos/{owner}/{repo}/environments/{environment_name}/deployment-branch-policies',
		{
			owner,
			repo,
			environment_name: environmentName,
			per_page: 100,
		},
	));
	const policies = Array.isArray((response as { data?: { branch_policies?: BranchPolicy[] } }).data?.branch_policies)
		? (response as { data: { branch_policies: BranchPolicy[] } }).data.branch_policies
		: [];
	const desiredKey = (policy: { name?: string | null; type?: string | null }) => `${policy.type ?? 'branch'}:${policy.name ?? ''}`;
	const desiredKeys = new Set(desiredPolicies.map((policy) => desiredKey(policy)));
	for (const policy of policies) {
		if (!policy.id || desiredKeys.has(desiredKey(policy))) {
			continue;
		}
		await withGitHubApiRetries(() => client.request(
			'DELETE /repos/{owner}/{repo}/environments/{environment_name}/deployment-branch-policies/{branch_policy_id}',
			{
				owner,
				repo,
				environment_name: environmentName,
				branch_policy_id: policy.id!,
			},
		));
	}
	const existingKeys = new Set(policies.map((policy) => desiredKey(policy)));
	for (const policy of desiredPolicies) {
		if (existingKeys.has(desiredKey(policy))) {
			continue;
		}
		try {
			await withGitHubApiRetries(() => client.request(
				'POST /repos/{owner}/{repo}/environments/{environment_name}/deployment-branch-policies',
				{
					owner,
					repo,
					environment_name: environmentName,
					name: policy.name,
					type: policy.type,
				},
			));
		} catch (error) {
			if (error && typeof error === 'object' && (error as { status?: unknown }).status === 303) {
				continue;
			}
			throw error;
		}
	}
}

async function paginateGitHubEnvironmentNames(
	client: GitHubApiClient,
	route: string,
	params: Record<string, unknown>,
) {
	const paginate = client.paginate as unknown as (route: string, params: Record<string, unknown>) => Promise<Array<{ name?: string | null }>>;
	return await paginateNames(() => paginate(route, {
		...params,
		per_page: 100,
	}));
}

export async function listGitHubEnvironmentSecretNames(
	repository: string | { owner: string; name: string },
	environmentName: string,
	{ client = createGitHubApiClient() }: { client?: GitHubApiClient } = {},
) {
	const { owner, name } = typeof repository === 'string' ? parseGitHubRepositorySlug(repository) : repository;
	try {
		return await withGitHubApiRetries(() => paginateGitHubEnvironmentNames(
			client,
			'GET /repos/{owner}/{repo}/environments/{environment_name}/secrets',
			{ owner, repo: name, environment_name: environmentName },
		));
	} catch (error) {
		throw normalizeGitHubApiError(error, `Unable to list GitHub environment secrets for ${owner}/${name}:${environmentName}`);
	}
}

export async function listGitHubEnvironmentVariableNames(
	repository: string | { owner: string; name: string },
	environmentName: string,
	{ client = createGitHubApiClient() }: { client?: GitHubApiClient } = {},
) {
	const { owner, name } = typeof repository === 'string' ? parseGitHubRepositorySlug(repository) : repository;
	try {
		return await withGitHubApiRetries(() => paginateGitHubEnvironmentNames(
			client,
			'GET /repos/{owner}/{repo}/environments/{environment_name}/variables',
			{ owner, repo: name, environment_name: environmentName },
		));
	} catch (error) {
		throw normalizeGitHubApiError(error, `Unable to list GitHub environment variables for ${owner}/${name}:${environmentName}`);
	}
}

async function encryptGitHubSecret(secret: string, key: string) {
	await sodium.ready;
	const messageBytes = Buffer.from(secret);
	const keyBytes = Buffer.from(key, 'base64');
	return Buffer.from(sodium.crypto_box_seal(messageBytes, keyBytes)).toString('base64');
}

export async function upsertGitHubRepositorySecret(
	repository: string | { owner: string; name: string },
	name: string,
	value: string,
	{ client = createGitHubApiClient() }: { client?: GitHubApiClient } = {},
) {
	const { owner, name: repo } = typeof repository === 'string' ? parseGitHubRepositorySlug(repository) : repository;
	try {
		const key = await client.rest.actions.getRepoPublicKey({
			owner,
			repo,
		});
		const encryptedValue = await encryptGitHubSecret(value, key.data.key);
		await withGitHubApiRetries(() => client.rest.actions.createOrUpdateRepoSecret({
			owner,
			repo,
			secret_name: name,
			encrypted_value: encryptedValue,
			key_id: key.data.key_id,
		}));
	} catch (error) {
		throw normalizeGitHubApiError(error, `Unable to upsert GitHub secret ${name} for ${owner}/${repo}`);
	}
}

export async function upsertGitHubEnvironmentSecret(
	repository: string | { owner: string; name: string },
	environmentName: string,
	name: string,
	value: string,
	{ client = createGitHubApiClient() }: { client?: GitHubApiClient } = {},
) {
	const { owner, name: repo } = typeof repository === 'string' ? parseGitHubRepositorySlug(repository) : repository;
	try {
		const key = await client.request('GET /repos/{owner}/{repo}/environments/{environment_name}/secrets/public-key', {
			owner,
			repo,
			environment_name: environmentName,
		});
		const encryptedValue = await encryptGitHubSecret(value, String((key.data as Record<string, unknown>).key ?? ''));
		await withGitHubApiRetries(() => client.request('PUT /repos/{owner}/{repo}/environments/{environment_name}/secrets/{secret_name}', {
			owner,
			repo,
			environment_name: environmentName,
			secret_name: name,
			encrypted_value: encryptedValue,
			key_id: String((key.data as Record<string, unknown>).key_id ?? ''),
		}));
	} catch (error) {
		throw normalizeGitHubApiError(error, `Unable to upsert GitHub environment secret ${name} for ${owner}/${repo}:${environmentName}`);
	}
}

export async function upsertGitHubRepositoryVariable(
	repository: string | { owner: string; name: string },
	name: string,
	value: string,
	{ client = createGitHubApiClient() }: { client?: GitHubApiClient } = {},
) {
	const { owner, name: repo } = typeof repository === 'string' ? parseGitHubRepositorySlug(repository) : repository;
	try {
		const createOrUpdateRepoVariable = (client.rest.actions as Record<string, unknown>).createOrUpdateRepoVariable;
		if (typeof createOrUpdateRepoVariable === 'function') {
			await withGitHubApiRetries(() => (createOrUpdateRepoVariable as (params: {
				owner: string;
				repo: string;
				name: string;
				value: string;
			}) => Promise<unknown>)({
				owner,
				repo,
				name,
				value,
			}));
			return;
		}
		await withGitHubApiRetries(async () => {
			try {
				await client.request('POST /repos/{owner}/{repo}/actions/variables', {
					owner,
					repo,
					name,
					value,
				});
				return;
			} catch (error) {
				const status = typeof (error as { status?: unknown })?.status === 'number'
					? Number((error as { status: number }).status)
					: null;
				const message = error instanceof Error ? error.message : String(error ?? '');
				if (status !== 409 && status !== 422 && !/already exists/iu.test(message)) {
					throw error;
				}
			}
			await client.request('PATCH /repos/{owner}/{repo}/actions/variables/{name}', {
				owner,
				repo,
				name,
				value,
			});
		});
	} catch (error) {
		throw normalizeGitHubApiError(error, `Unable to upsert GitHub variable ${name} for ${owner}/${repo}`);
	}
}

export async function upsertGitHubEnvironmentVariable(
	repository: string | { owner: string; name: string },
	environmentName: string,
	name: string,
	value: string,
	{ client = createGitHubApiClient() }: { client?: GitHubApiClient } = {},
) {
	const { owner, name: repo } = typeof repository === 'string' ? parseGitHubRepositorySlug(repository) : repository;
	try {
		await withGitHubApiRetries(async () => {
			try {
				await client.request('POST /repos/{owner}/{repo}/environments/{environment_name}/variables', {
					owner,
					repo,
					environment_name: environmentName,
					name,
					value,
				});
				return;
			} catch (error) {
				const status = typeof (error as { status?: unknown })?.status === 'number'
					? Number((error as { status: number }).status)
					: null;
				const message = error instanceof Error ? error.message : String(error ?? '');
				if (status !== 409 && status !== 422 && !/already exists/iu.test(message)) {
					throw error;
				}
			}
			await client.request('PATCH /repos/{owner}/{repo}/environments/{environment_name}/variables/{name}', {
				owner,
				repo,
				environment_name: environmentName,
				name,
				value,
			});
		});
	} catch (error) {
		throw normalizeGitHubApiError(error, `Unable to upsert GitHub environment variable ${name} for ${owner}/${repo}:${environmentName}`);
	}
}

export function upsertGitHubRepositoryVariableWithGhCli(
	repository: string | { owner: string; name: string },
	name: string,
	value: string,
	{
		env = process.env,
	}: {
		env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	} = {},
) {
	const token = resolveGitHubApiToken(env);
	if (!token) {
		throw new Error('Configure TREESEED_GITHUB_TOKEN before using Treeseed GitHub automation.');
	}
	const { owner, name: repo } = typeof repository === 'string' ? parseGitHubRepositorySlug(repository) : repository;
	const ghEnv = {
		...process.env,
		...env,
		GH_TOKEN: token,
		GITHUB_TOKEN: token,
	};
	const gh = resolveTreeseedToolBinary('gh', { env: ghEnv });
	if (!gh) {
		throw new Error('GitHub CLI `gh` is unavailable.');
	}
	const create = spawnSync(
		gh,
		[
			'api',
			`repos/${owner}/${repo}/actions/variables`,
			'--method',
			'POST',
			'-f',
			`name=${name}`,
			'-f',
			`value=${value}`,
		],
		{ encoding: 'utf8', env: createTreeseedManagedToolEnv(ghEnv) },
	);
	if (create.status === 0) {
		return;
	}
	const combinedCreateOutput = `${create.stdout ?? ''}\n${create.stderr ?? ''}`.trim();
	if (!/already exists|HTTP 409|HTTP 422/iu.test(combinedCreateOutput)) {
		throw new Error(combinedCreateOutput || `gh api exited with status ${create.status ?? 1}`);
	}
	const update = spawnSync(
		gh,
		[
			'api',
			`repos/${owner}/${repo}/actions/variables/${name}`,
			'--method',
			'PATCH',
			'-f',
			`name=${name}`,
			'-f',
			`value=${value}`,
		],
		{ encoding: 'utf8', env: createTreeseedManagedToolEnv(ghEnv) },
	);
	if (update.status === 0) {
		return;
	}
	const combinedUpdateOutput = `${update.stdout ?? ''}\n${update.stderr ?? ''}`.trim();
	throw new Error(combinedUpdateOutput || `gh api exited with status ${update.status ?? 1}`);
}

function normalizeWorkflowRun(run: Record<string, any>): GitHubWorkflowRunSummary {
	return {
		id: Number(run.id ?? 0),
		status: typeof run.status === 'string' ? run.status : null,
		conclusion: typeof run.conclusion === 'string' ? run.conclusion : null,
		url: typeof run.html_url === 'string' ? run.html_url : null,
		headSha: typeof run.head_sha === 'string' ? run.head_sha : null,
		headBranch: typeof run.head_branch === 'string' ? run.head_branch : null,
		createdAt: typeof run.created_at === 'string' ? run.created_at : null,
		updatedAt: typeof run.updated_at === 'string' ? run.updated_at : null,
	};
}

function normalizeWorkflowJob(job: Record<string, any>): GitHubWorkflowJobSummary {
	return {
		id: Number(job.id ?? 0),
		name: String(job.name ?? ''),
		status: typeof job.status === 'string' ? job.status : null,
		conclusion: typeof job.conclusion === 'string' ? job.conclusion : null,
		url: typeof job.html_url === 'string' ? job.html_url : null,
		steps: Array.isArray(job.steps)
			? job.steps.map((step: Record<string, any>) => ({
				name: String(step.name ?? ''),
				status: typeof step.status === 'string' ? step.status : null,
				conclusion: typeof step.conclusion === 'string' ? step.conclusion : null,
			}))
			: [],
	};
}

function workflowInspectCommand(repository: string | null, runId: number | null) {
	return repository && runId ? `gh run view ${runId} --repo ${repository} --log-failed` : null;
}

export function formatGitHubWorkflowFailure(input: GitHubWorkflowFailureSummaryInput = {}): GitHubWorkflowFailureSummary {
	const repository = typeof input.repository === 'string' && input.repository.trim() ? input.repository.trim() : null;
	const workflow = typeof input.workflow === 'string' && input.workflow.trim() ? input.workflow.trim() : null;
	const numericRunId = Number(input.runId);
	const runId = Number.isFinite(numericRunId) && numericRunId > 0 ? numericRunId : null;
	const runUrl = typeof input.runUrl === 'string' && input.runUrl.trim() ? input.runUrl.trim() : null;
	const conclusion = typeof input.conclusion === 'string' && input.conclusion.trim() ? input.conclusion.trim() : null;
	const failedJobName = typeof input.failedJobName === 'string' && input.failedJobName.trim() ? input.failedJobName.trim() : null;
	const lastActiveStep = typeof input.lastActiveStep === 'string' && input.lastActiveStep.trim() ? input.lastActiveStep.trim() : null;
	const blockerCode = typeof input.blockerCode === 'string' && input.blockerCode.trim()
		? input.blockerCode.trim()
		: conclusion === 'cancelled'
			? 'github_workflow_cancelled'
			: conclusion === 'timed_out'
				? 'github_workflow_timed_out'
				: 'github_workflow_failed';
	const detail = failedJobName
		? ` Failed job: ${failedJobName}.`
		: lastActiveStep
			? ` Last active step: ${lastActiveStep}.`
			: '';
	const summary = typeof input.message === 'string' && input.message.trim()
		? input.message.trim()
		: `${workflow ?? 'GitHub workflow'} ${conclusion ? `completed with conclusion ${conclusion}` : 'failed'}.${detail}`;
	return {
		summary,
		provider: 'github',
		repository,
		workflow,
		runId,
		runUrl,
		inspectCommand: workflowInspectCommand(repository, runId),
		failedJobName,
		lastActiveStep,
		conclusion,
		retrySafe: input.retrySafe ?? true,
		resumeSafe: input.resumeSafe ?? false,
		blockerCode,
	};
}

export async function dispatchGitHubWorkflowRun(
	repository: string | { owner: string; name: string },
	{
		client = createGitHubApiClient(),
		workflow = 'deploy-web.yml',
		branch,
		inputs,
	}: {
		client?: GitHubApiClient;
		workflow?: string;
		branch: string;
		inputs?: Record<string, string>;
	},
): Promise<GitHubWorkflowDispatchResult> {
	const { owner, name } = typeof repository === 'string' ? parseGitHubRepositorySlug(repository) : repository;
	try {
		const result = await client.rest.actions.createWorkflowDispatch({
			owner,
			repo: name,
			workflow_id: workflow,
			ref: branch,
			inputs,
		});
		return {
			repository: `${owner}/${name}`,
			workflow,
			branch,
			inputs,
			status: typeof result.status === 'number' ? result.status : null,
			dispatchedAt: new Date().toISOString(),
		};
	} catch (error) {
		throw normalizeGitHubApiError(error, `Unable to dispatch GitHub workflow ${workflow} in ${owner}/${name}`);
	}
}

export async function cancelGitHubWorkflowRun(
	repository: string | { owner: string; name: string } | null | undefined,
	runId: number | string | null | undefined,
	{ client = createGitHubApiClient() }: { client?: GitHubApiClient } = {},
): Promise<GitHubWorkflowCancellationResult> {
	if (!repository || !runId) {
		return {
			ok: false,
			supported: false,
			repository: typeof repository === 'string' ? repository : null,
			runId: null,
			message: 'GitHub workflow cancellation requires a repository and run id.',
		};
	}
	const { owner, name } = typeof repository === 'string' ? parseGitHubRepositorySlug(repository) : repository;
	const numericRunId = Number(runId);
	if (!Number.isFinite(numericRunId) || numericRunId <= 0) {
		return {
			ok: false,
			supported: false,
			repository: `${owner}/${name}`,
			runId: null,
			message: 'GitHub workflow cancellation requires a numeric run id.',
		};
	}
	try {
		await client.rest.actions.cancelWorkflowRun({
			owner,
			repo: name,
			run_id: numericRunId,
		});
		return {
			ok: true,
			supported: true,
			repository: `${owner}/${name}`,
			runId: numericRunId,
			url: `https://github.com/${owner}/${name}/actions/runs/${numericRunId}`,
			message: 'GitHub workflow cancellation requested.',
			cancelledAt: new Date().toISOString(),
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error ?? '');
		if (/not supported|not found|404/iu.test(message)) {
			return {
				ok: false,
				supported: false,
				repository: `${owner}/${name}`,
				runId: numericRunId,
				message: 'GitHub workflow cancellation is not supported for this run.',
			};
		}
		throw normalizeGitHubApiError(error, `Unable to cancel GitHub workflow run ${numericRunId} in ${owner}/${name}`);
	}
}

export async function getGitHubWorkflowFileStatus(
	repository: string | { owner: string; name: string },
	workflow = 'deploy-web.yml',
	{ client = createGitHubApiClient() }: { client?: GitHubApiClient } = {},
): Promise<GitHubWorkflowFileStatus> {
	const { owner, name } = typeof repository === 'string' ? parseGitHubRepositorySlug(repository) : repository;
	const normalizedWorkflow = workflow.replace(/^\.github\/workflows\//u, '');
	const path = `.github/workflows/${normalizedWorkflow}`;
	try {
		const result = await client.rest.repos.getContent({
			owner,
			repo: name,
			path,
		});
		const data = result.data as Record<string, any>;
		return {
			ok: true,
			exists: true,
			repository: `${owner}/${name}`,
			workflow: normalizedWorkflow,
			url: typeof data.html_url === 'string' ? data.html_url : `https://github.com/${owner}/${name}/blob/HEAD/${path}`,
			message: `${normalizedWorkflow} is present.`,
		};
	} catch (error) {
		const status = typeof (error as { status?: unknown })?.status === 'number' ? (error as { status: number }).status : null;
		if (status === 404) {
			return {
				ok: true,
				exists: false,
				repository: `${owner}/${name}`,
				workflow: normalizedWorkflow,
				url: null,
				message: `${normalizedWorkflow} is missing from ${owner}/${name}.`,
			};
		}
		throw normalizeGitHubApiError(error, `Unable to inspect GitHub workflow file ${path} in ${owner}/${name}`);
	}
}

export async function getLatestGitHubWorkflowRun(
	repository: string | { owner: string; name: string },
	{
		client = createGitHubApiClient(),
		workflow = 'deploy-web.yml',
		branch,
	}: {
		client?: GitHubApiClient;
		workflow?: string;
		branch?: string | null;
	} = {},
): Promise<GitHubWorkflowRunSummary | null> {
	const { owner, name } = typeof repository === 'string' ? parseGitHubRepositorySlug(repository) : repository;
	try {
		const listed = await client.rest.actions.listWorkflowRuns({
			owner,
			repo: name,
			workflow_id: workflow,
			...(branch ? { branch } : {}),
			per_page: 1,
		});
		const run = listed.data.workflow_runs[0] ?? null;
		return run ? normalizeWorkflowRun(run as Record<string, any>) : null;
	} catch (error) {
		throw normalizeGitHubApiError(error, `Unable to inspect latest GitHub workflow run ${workflow} in ${owner}/${name}`);
	}
}

async function listWorkflowJobsForProgress(client: GitHubApiClient, owner: string, repo: string, runId: number) {
	try {
		const jobs = await client.rest.actions.listJobsForWorkflowRun({
			owner,
			repo,
			run_id: runId,
			per_page: 100,
		});
		return jobs.data.jobs.map((job) => normalizeWorkflowJob(job as Record<string, any>));
	} catch {
		return [];
	}
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForGitHubWorkflowRunCompletion(
	repository: string | { owner: string; name: string },
	{
		client = createGitHubApiClient(),
		workflow = 'publish.yml',
		headSha,
		branch,
		timeoutSeconds = 600,
		pollSeconds = 5,
		dispatchIfMissing = false,
		dispatchAfterSeconds = 60,
		dispatchInputs,
		onProgress,
	}: {
		client?: GitHubApiClient;
		workflow?: string;
		headSha?: string | null;
		branch?: string | null;
		timeoutSeconds?: number;
		pollSeconds?: number;
		dispatchIfMissing?: boolean;
		dispatchAfterSeconds?: number;
		dispatchInputs?: Record<string, string>;
		onProgress?: (event: GitHubWorkflowProgressEvent) => void;
	} = {},
) {
	const { owner, name } = typeof repository === 'string' ? parseGitHubRepositorySlug(repository) : repository;
	const startedAt = Date.now();
	let dispatchedMissingRun = false;
	let lastProgress: GitHubWorkflowProgressEvent | null = null;
	const emitProgress = (type: GitHubWorkflowProgressEvent['type'], run: GitHubWorkflowRunSummary | null = null, jobs: GitHubWorkflowJobSummary[] = []) => {
		const completedJobs = jobs.filter((job) => job.status === 'completed');
		const failedJobs = jobs.filter((job) => job.conclusion && job.conclusion !== 'success' && job.conclusion !== 'skipped');
		const activeJobs = jobs.filter((job) => job.status && job.status !== 'completed');
		const event: GitHubWorkflowProgressEvent = {
			type,
			repository: `${owner}/${name}`,
			workflow,
			branch: run?.headBranch ?? branch ?? null,
			headSha: run?.headSha ?? headSha ?? null,
			elapsedSeconds: Math.max(0, Math.round((Date.now() - startedAt) / 1000)),
			runId: run?.id ?? null,
			url: run?.url ?? null,
			status: run?.status ?? null,
			conclusion: run?.conclusion ?? null,
			jobs,
			activeJobs,
			completedJobs,
			failedJobs,
		};
		lastProgress = event;
		onProgress?.(event);
	};
	while ((Date.now() - startedAt) < timeoutSeconds * 1000) {
		try {
			const listed = await client.rest.actions.listWorkflowRuns({
				owner,
				repo: name,
				workflow_id: workflow,
				per_page: 20,
			});
			const match = listed.data.workflow_runs
				.map((run) => normalizeWorkflowRun(run as Record<string, any>))
				.find((run) => (!headSha || run.headSha === headSha) && (!branch || run.headBranch === branch));
			if (!match?.id) {
				emitProgress('waiting');
				if (dispatchIfMissing && branch && !dispatchedMissingRun && (Date.now() - startedAt) >= dispatchAfterSeconds * 1000) {
					try {
						await client.rest.actions.createWorkflowDispatch({
							owner,
							repo: name,
							workflow_id: workflow,
							ref: branch,
							inputs: dispatchInputs,
						});
						dispatchedMissingRun = true;
					} catch (error) {
						throw normalizeGitHubApiError(error, `Unable to dispatch GitHub workflow ${workflow} in ${owner}/${name}`);
					}
				}
				await sleep(pollSeconds * 1000);
				continue;
			}
			for (;;) {
				if ((Date.now() - startedAt) >= timeoutSeconds * 1000 && lastProgress?.runId === match.id) {
					break;
				}
				const current = await client.rest.actions.getWorkflowRun({
					owner,
					repo: name,
					run_id: match.id,
				});
				const normalized = normalizeWorkflowRun(current.data as Record<string, any>);
				const progressJobs = await listWorkflowJobsForProgress(client, owner, name, match.id);
				if (normalized.status === 'completed') {
					const normalizedJobs = progressJobs;
					emitProgress('completed', normalized, normalizedJobs);
					return {
						status: 'completed',
						repository: `${owner}/${name}`,
						workflow,
						runId: normalized.id,
						headSha: normalized.headSha,
						branch: normalized.headBranch,
						createdAt: normalized.createdAt,
						updatedAt: normalized.updatedAt,
						conclusion: normalized.conclusion,
						url: normalized.url,
						jobs: normalizedJobs,
						failedJobs: normalizedJobs.filter((job) => job.conclusion && job.conclusion !== 'success' && job.conclusion !== 'skipped'),
					};
				}
				emitProgress('running', normalized, progressJobs);
				await sleep(pollSeconds * 1000);
			}
		} catch (error) {
			throw normalizeGitHubApiError(error, `Unable to monitor GitHub workflow ${workflow} in ${owner}/${name}`);
		}
	}
	const lastState = lastProgress
		? ` Last known state: run ${lastProgress.runId ?? '(not created)'} ${lastProgress.status ?? 'waiting'}${lastProgress.conclusion ? `/${lastProgress.conclusion}` : ''}${lastProgress.url ? ` ${lastProgress.url}` : ''}.`
		: '';
	throw new Error(`Timed out waiting for GitHub workflow ${workflow} in ${owner}/${name}.${lastState}`);
}

export async function ensureGitHubBranchFromBase(
	repository: string | { owner: string; name: string },
	branch: string,
	{
		baseBranch = 'main',
		client = createGitHubApiClient(),
	}: {
		baseBranch?: string;
		client?: GitHubApiClient;
	} = {},
) {
	const { owner, name } = typeof repository === 'string' ? parseGitHubRepositorySlug(repository) : repository;
	try {
		const existing = await client.rest.repos.getBranch({
			owner,
			repo: name,
			branch,
		});
		return {
			branch,
			baseBranch,
			existed: true,
			created: false,
			sha: existing.data.commit.sha,
		};
	} catch (error) {
		if (!/not found/iu.test(error instanceof Error ? error.message : String(error ?? ''))) {
			throw normalizeGitHubApiError(error, `Unable to resolve GitHub branch ${branch} in ${owner}/${name}`);
		}
	}
	try {
		const base = await client.rest.repos.getBranch({
			owner,
			repo: name,
			branch: baseBranch,
		});
		await client.rest.git.createRef({
			owner,
			repo: name,
			ref: `refs/heads/${branch}`,
			sha: base.data.commit.sha,
		});
		return {
			branch,
			baseBranch,
			existed: false,
			created: true,
			sha: base.data.commit.sha,
		};
	} catch (error) {
		throw normalizeGitHubApiError(error, `Unable to create GitHub branch ${branch} from ${baseBranch} in ${owner}/${name}`);
	}
}
