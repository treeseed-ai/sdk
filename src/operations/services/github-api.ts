import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { Octokit } from 'octokit';

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
	return configuredEnvValue(env, 'GH_TOKEN') || configuredEnvValue(env, 'GITHUB_TOKEN');
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
		throw new Error('Configure GH_TOKEN before using Treeseed GitHub automation.');
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
		return await paginateNames(() =>
			client.paginate(client.rest.actions.listRepoSecrets, {
				owner,
				repo: name,
				per_page: 100,
			}) as Promise<Array<{ name?: string | null }>>,
		);
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
		return await paginateNames(() =>
			client.paginate(client.rest.actions.listRepoVariables, {
				owner,
				repo: name,
				per_page: 100,
			}) as Promise<Array<{ name?: string | null }>>,
		);
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
	}: {
		client?: GitHubApiClient;
		branchName?: string | null;
	} = {},
) {
	const { owner, name: repo } = typeof repository === 'string' ? parseGitHubRepositorySlug(repository) : repository;
	try {
		await withGitHubApiRetries(() => client.request('PUT /repos/{owner}/{repo}/environments/{environment_name}', {
			owner,
			repo,
			environment_name: environmentName,
			...(branchName
				? {
					deployment_branch_policy: {
						protected_branches: false,
						custom_branch_policies: true,
					},
				}
				: {}),
		}));
		if (branchName) {
			await ensureGitHubEnvironmentBranchPolicy(client, {
				owner,
				repo,
				environmentName,
				branchName,
			});
		}
		return { repository: `${owner}/${repo}`, environment: environmentName };
	} catch (error) {
		throw normalizeGitHubApiError(error, `Unable to ensure GitHub environment ${environmentName} for ${owner}/${repo}`);
	}
}

async function ensureGitHubEnvironmentBranchPolicy(
	client: GitHubApiClient,
	{
		owner,
		repo,
		environmentName,
		branchName,
	}: {
		owner: string;
		repo: string;
		environmentName: string;
		branchName: string;
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
	const desired = policies.find((policy) => policy.name === branchName && (policy.type ?? 'branch') === 'branch');
	for (const policy of policies) {
		if (!policy.id || (policy.name === branchName && (policy.type ?? 'branch') === 'branch')) {
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
	if (desired) {
		return;
	}
	try {
		await withGitHubApiRetries(() => client.request(
			'POST /repos/{owner}/{repo}/environments/{environment_name}/deployment-branch-policies',
			{
				owner,
				repo,
				environment_name: environmentName,
				name: branchName,
				type: 'branch',
			},
		));
	} catch (error) {
		if (error && typeof error === 'object' && (error as { status?: unknown }).status === 303) {
			return;
		}
		throw error;
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
		return await paginateGitHubEnvironmentNames(
			client,
			'GET /repos/{owner}/{repo}/environments/{environment_name}/secrets',
			{ owner, repo: name, environment_name: environmentName },
		);
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
		return await paginateGitHubEnvironmentNames(
			client,
			'GET /repos/{owner}/{repo}/environments/{environment_name}/variables',
			{ owner, repo: name, environment_name: environmentName },
		);
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
		throw new Error('Configure GH_TOKEN before using Treeseed GitHub automation.');
	}
	const { owner, name: repo } = typeof repository === 'string' ? parseGitHubRepositorySlug(repository) : repository;
	const ghEnv = {
		...process.env,
		...env,
		GH_TOKEN: token,
		GITHUB_TOKEN: token,
	};
	const create = spawnSync(
		'gh',
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
		{ encoding: 'utf8', env: ghEnv },
	);
	if (create.status === 0) {
		return;
	}
	const combinedCreateOutput = `${create.stdout ?? ''}\n${create.stderr ?? ''}`.trim();
	if (!/already exists|HTTP 409|HTTP 422/iu.test(combinedCreateOutput)) {
		throw new Error(combinedCreateOutput || `gh api exited with status ${create.status ?? 1}`);
	}
	const update = spawnSync(
		'gh',
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
		{ encoding: 'utf8', env: ghEnv },
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
	};
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
	}: {
		client?: GitHubApiClient;
		workflow?: string;
		headSha?: string | null;
		branch?: string | null;
		timeoutSeconds?: number;
		pollSeconds?: number;
	} = {},
) {
	const { owner, name } = typeof repository === 'string' ? parseGitHubRepositorySlug(repository) : repository;
	const startedAt = Date.now();
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
				await sleep(pollSeconds * 1000);
				continue;
			}
			for (;;) {
				const current = await client.rest.actions.getWorkflowRun({
					owner,
					repo: name,
					run_id: match.id,
				});
				const normalized = normalizeWorkflowRun(current.data as Record<string, any>);
				if (normalized.status === 'completed') {
					return {
						status: 'completed',
						repository: `${owner}/${name}`,
						workflow,
						runId: normalized.id,
						headSha: normalized.headSha,
						conclusion: normalized.conclusion,
						url: normalized.url,
					};
				}
				await sleep(pollSeconds * 1000);
			}
		} catch (error) {
			throw normalizeGitHubApiError(error, `Unable to monitor GitHub workflow ${workflow} in ${owner}/${name}`);
		}
	}
	throw new Error(`Timed out waiting for GitHub workflow ${workflow} in ${owner}/${name}.`);
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
