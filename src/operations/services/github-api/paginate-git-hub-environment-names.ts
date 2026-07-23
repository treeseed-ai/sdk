import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { Octokit } from 'octokit';
import { createTreeseedManagedToolEnv, resolveTreeseedToolBinary } from '../../../managed-dependencies.ts';
import { resolveTreeseedGitHubToken } from '../../../service-credentials.ts';
import { GitHubApiClient, normalizeGitHubApiError, parseGitHubRepositorySlug, sodium, withGitHubApiRetries } from './require.ts';
import { createGitHubApiClient, paginateNames } from './create-git-hub-api-client.ts';

export async function paginateGitHubEnvironmentNames(
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

export async function listGitHubEnvironmentVariables(
	repository: string | { owner: string; name: string },
	environmentName: string,
	{ client = createGitHubApiClient() }: { client?: GitHubApiClient } = {},
) {
	const { owner, name } = typeof repository === 'string' ? parseGitHubRepositorySlug(repository) : repository;
	try {
		const paginate = client.paginate as unknown as (route: string, params: Record<string, unknown>) => Promise<Array<{ name?: string | null; value?: string | null }>>;
		const variables = await withGitHubApiRetries(() => paginate(
			'GET /repos/{owner}/{repo}/environments/{environment_name}/variables',
			{ owner, repo: name, environment_name: environmentName, per_page: 100 },
		));
		return new Map(variables
			.map((entry) => [String(entry.name ?? '').trim(), String(entry.value ?? '')] as const)
			.filter(([variableName]) => variableName.length > 0));
	} catch (error) {
		throw normalizeGitHubApiError(error, `Unable to list GitHub environment variables for ${owner}/${name}:${environmentName}`);
	}
}

export async function encryptGitHubSecret(secret: string, key: string) {
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
