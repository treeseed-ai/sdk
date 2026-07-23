import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { Octokit } from 'octokit';
import { createTreeseedManagedToolEnv, resolveTreeseedToolBinary } from '../../../managed-dependencies.ts';
import { resolveTreeseedGitHubToken } from '../../../service-credentials.ts';
import { DEFAULT_GITHUB_API_TIMEOUT_MS, GitHubApiClient, GitHubRepositoryMetadataInput, createGitHubTimeoutFetch, normalizeGitHubApiError, normalizeRepositorySummary, parseGitHubRepositorySlug, resolveGitHubApiToken, withGitHubApiRetries } from './require.ts';

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

export async function paginateNames(
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

export async function ensureGitHubEnvironmentDeploymentPolicies(
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
