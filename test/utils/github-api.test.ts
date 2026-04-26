import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import {
	createGitHubApiClient,
	ensureGitHubActionsEnvironment,
	listGitHubEnvironmentSecretNames,
	listGitHubEnvironmentVariableNames,
	upsertGitHubEnvironmentSecret,
	upsertGitHubEnvironmentVariable,
} from '../../src/operations/services/github-api.ts';

function createMockClient() {
	return {
		request: vi.fn(),
		paginate: vi.fn(),
	} as any;
}

describe('github environment api helpers', () => {
	it('uses a fresh timeout signal for each GitHub request', async () => {
		const fetchMock = vi.fn(async () => new Response(JSON.stringify({ resources: {}, rate: {} }), {
			status: 200,
			headers: { 'content-type': 'application/json' },
		}));
		vi.stubGlobal('fetch', fetchMock);
		try {
			const client = createGitHubApiClient({ env: { GH_TOKEN: 'github-token' }, timeoutMs: 60_000 });

			await client.request('GET /rate_limit');
			await client.request('GET /rate_limit');

			expect(fetchMock).toHaveBeenCalledTimes(2);
			const firstInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
			const secondInit = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined;
			expect(firstInit?.signal).toBeInstanceOf(AbortSignal);
			expect(secondInit?.signal).toBeInstanceOf(AbortSignal);
			expect(firstInit?.signal).not.toBe(secondInit?.signal);
			expect(firstInit?.signal?.aborted).toBe(false);
			expect(secondInit?.signal?.aborted).toBe(false);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('ensures GitHub Actions environments by repository slug', async () => {
		const client = createMockClient();
		client.request.mockResolvedValue({ data: {} });

		await expect(ensureGitHubActionsEnvironment('owner/repo', 'staging', { client })).resolves.toEqual({
			repository: 'owner/repo',
			environment: 'staging',
		});

		expect(client.request).toHaveBeenCalledWith('PUT /repos/{owner}/{repo}/environments/{environment_name}', {
			owner: 'owner',
			repo: 'repo',
			environment_name: 'staging',
		});
	});

	it('locks GitHub Actions environments to the configured deployment branch', async () => {
		const client = createMockClient();
		client.request
			.mockResolvedValueOnce({ data: {} })
			.mockResolvedValueOnce({
				data: {
					branch_policies: [
						{ id: 1, name: 'main', type: 'branch' },
					],
				},
			})
			.mockResolvedValueOnce({ data: {} })
			.mockResolvedValueOnce({ data: { id: 2, name: 'staging', type: 'branch' } });

		await expect(ensureGitHubActionsEnvironment('owner/repo', 'staging', {
			client,
			branchName: 'staging',
		})).resolves.toEqual({
			repository: 'owner/repo',
			environment: 'staging',
		});

		expect(client.request).toHaveBeenNthCalledWith(1, 'PUT /repos/{owner}/{repo}/environments/{environment_name}', {
			owner: 'owner',
			repo: 'repo',
			environment_name: 'staging',
			deployment_branch_policy: {
				protected_branches: false,
				custom_branch_policies: true,
			},
		});
		expect(client.request).toHaveBeenNthCalledWith(2, 'GET /repos/{owner}/{repo}/environments/{environment_name}/deployment-branch-policies', {
			owner: 'owner',
			repo: 'repo',
			environment_name: 'staging',
			per_page: 100,
		});
		expect(client.request).toHaveBeenNthCalledWith(3, 'DELETE /repos/{owner}/{repo}/environments/{environment_name}/deployment-branch-policies/{branch_policy_id}', {
			owner: 'owner',
			repo: 'repo',
			environment_name: 'staging',
			branch_policy_id: 1,
		});
		expect(client.request).toHaveBeenNthCalledWith(4, 'POST /repos/{owner}/{repo}/environments/{environment_name}/deployment-branch-policies', {
			owner: 'owner',
			repo: 'repo',
			environment_name: 'staging',
			name: 'staging',
			type: 'branch',
		});
	});

	it('lists environment secret and variable names', async () => {
		const client = createMockClient();
		client.paginate
			.mockResolvedValueOnce([{ name: 'CLOUDFLARE_API_TOKEN' }])
			.mockResolvedValueOnce([{ name: 'CLOUDFLARE_ACCOUNT_ID' }]);

		await expect(listGitHubEnvironmentSecretNames('owner/repo', 'production', { client }))
			.resolves.toEqual(new Set(['CLOUDFLARE_API_TOKEN']));
		await expect(listGitHubEnvironmentVariableNames('owner/repo', 'production', { client }))
			.resolves.toEqual(new Set(['CLOUDFLARE_ACCOUNT_ID']));

		expect(client.paginate).toHaveBeenNthCalledWith(
			1,
			'GET /repos/{owner}/{repo}/environments/{environment_name}/secrets',
			expect.objectContaining({ owner: 'owner', repo: 'repo', environment_name: 'production' }),
		);
		expect(client.paginate).toHaveBeenNthCalledWith(
			2,
			'GET /repos/{owner}/{repo}/environments/{environment_name}/variables',
			expect.objectContaining({ owner: 'owner', repo: 'repo', environment_name: 'production' }),
		);
	});

	it('encrypts and upserts environment secrets', async () => {
		const client = createMockClient();
		client.request
			.mockResolvedValueOnce({
				data: {
					key: Buffer.alloc(32, 1).toString('base64'),
					key_id: 'key-1',
				},
			})
			.mockResolvedValueOnce({ data: {} });

		await upsertGitHubEnvironmentSecret('owner/repo', 'staging', 'RAILWAY_API_TOKEN', 'railway-token', { client });

		expect(client.request).toHaveBeenNthCalledWith(
			1,
			'GET /repos/{owner}/{repo}/environments/{environment_name}/secrets/public-key',
			{ owner: 'owner', repo: 'repo', environment_name: 'staging' },
		);
		expect(client.request).toHaveBeenNthCalledWith(
			2,
			'PUT /repos/{owner}/{repo}/environments/{environment_name}/secrets/{secret_name}',
			expect.objectContaining({
				owner: 'owner',
				repo: 'repo',
				environment_name: 'staging',
				secret_name: 'RAILWAY_API_TOKEN',
				key_id: 'key-1',
			}),
		);
		expect(client.request.mock.calls[1]?.[1]?.encrypted_value).toEqual(expect.any(String));
		expect(client.request.mock.calls[1]?.[1]?.encrypted_value).not.toBe('railway-token');
	});

	it('creates or updates environment variables', async () => {
		const client = createMockClient();
		const alreadyExists = Object.assign(new Error('already exists'), { status: 409 });
		client.request
			.mockRejectedValueOnce(alreadyExists)
			.mockResolvedValueOnce({ data: {} });

		await upsertGitHubEnvironmentVariable('owner/repo', 'production', 'CLOUDFLARE_ACCOUNT_ID', 'account-1', { client });

		expect(client.request).toHaveBeenNthCalledWith(
			1,
			'POST /repos/{owner}/{repo}/environments/{environment_name}/variables',
			{
				owner: 'owner',
				repo: 'repo',
				environment_name: 'production',
				name: 'CLOUDFLARE_ACCOUNT_ID',
				value: 'account-1',
			},
		);
		expect(client.request).toHaveBeenNthCalledWith(
			2,
			'PATCH /repos/{owner}/{repo}/environments/{environment_name}/variables/{name}',
			{
				owner: 'owner',
				repo: 'repo',
				environment_name: 'production',
				name: 'CLOUDFLARE_ACCOUNT_ID',
				value: 'account-1',
			},
		);
	});
});
