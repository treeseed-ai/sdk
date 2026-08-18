import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/operations/services/github-api/paginate-git-hub-environment-names.ts', () => ({
	encryptGitHubSecret: vi.fn(async () => 'encrypted-value'),
}));

const { runGitHubAcceptance } = await import('../../../src/reconcile/repositories/live-acceptance-github.ts');

type RequestRecord = { method: string; path: string };

function createGitHubFixture(prefix: string) {
	const requests: RequestRecord[] = [];
	let branchExists = false;
	let protectionExists = false;
	let environmentExists = false;
	let variableExists = false;
	let secretExists = false;
	let variableValue = '';
	const response = (payload: unknown, status = 200) => Response.json(payload, { status });
	const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(String(input));
		const method = init?.method ?? 'GET';
		const path = `${url.pathname}${url.search}`;
		requests.push({ method, path });
		const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
		const repositoryPath = '/repos/treeseed-ai/market';
		const variableName = `TREESEED_LIVE_TEST_${prefix.toUpperCase().replace(/[^A-Z0-9]/gu, '_')}_VARIABLE`;
		const secretName = `TREESEED_LIVE_TEST_${prefix.toUpperCase().replace(/[^A-Z0-9]/gu, '_')}_SECRET`;

		if (method === 'GET' && url.pathname === repositoryPath) return response({ full_name: 'treeseed-ai/market', default_branch: 'main', archived: false });
		if (method === 'GET' && url.pathname === `${repositoryPath}/branches/main`) return response({ name: 'main', commit: { sha: 'a'.repeat(40) } });
		if (method === 'GET' && url.pathname.includes('/git/matching-refs/heads/')) {
			return response(branchExists ? [{ ref: `refs/heads/${prefix}` }, { ref: 'refs/heads/main' }] : []);
		}
		if (method === 'POST' && url.pathname === `${repositoryPath}/git/refs`) {
			branchExists = body.ref === `refs/heads/${prefix}` && body.sha === 'a'.repeat(40);
			return response({ ref: body.ref }, 201);
		}
		if (method === 'GET' && url.pathname === `${repositoryPath}/branches/${prefix}`) return response(branchExists ? { name: prefix } : {}, branchExists ? 200 : 404);
		if (method === 'PUT' && url.pathname === `${repositoryPath}/branches/${prefix}/protection`) {
			protectionExists = true;
			return response({});
		}
		if (method === 'GET' && url.pathname === `${repositoryPath}/branches/${prefix}/protection`) {
			return response(protectionExists ? { enforce_admins: { enabled: true }, allow_force_pushes: { enabled: false }, allow_deletions: { enabled: false } } : {}, protectionExists ? 200 : 404);
		}
		if (method === 'DELETE' && url.pathname === `${repositoryPath}/branches/${prefix}/protection`) {
			protectionExists = false;
			return response({});
		}
		if (method === 'DELETE' && url.pathname === `${repositoryPath}/git/refs/heads/${prefix}`) {
			if (protectionExists) return response({ message: 'Protected branch update failed' }, 422);
			branchExists = false;
			return response({});
		}
		if (method === 'GET' && url.pathname === `${repositoryPath}/actions/permissions`) return response({ enabled: true });
		if (method === 'PUT' && url.pathname === `${repositoryPath}/environments/${prefix}`) {
			environmentExists = true;
			return response({ name: prefix });
		}
		if (method === 'POST' && url.pathname === `${repositoryPath}/environments/${prefix}/deployment-branch-policies`) return response({ name: prefix, type: 'branch' }, 201);
		if (method === 'GET' && url.pathname === `${repositoryPath}/environments/${prefix}`) return response({ name: prefix });
		if (method === 'GET' && url.pathname === `${repositoryPath}/environments/${prefix}/deployment-branch-policies`) return response({ branch_policies: [{ name: prefix, type: 'branch' }] });
		if (method === 'GET' && url.pathname === `${repositoryPath}/environments`) {
			return response({ environments: [...(environmentExists ? [{ name: prefix }] : []), { name: 'production' }] });
		}
		if (method === 'DELETE' && url.pathname === `${repositoryPath}/environments/${prefix}`) {
			environmentExists = false;
			secretExists = false;
			return response({});
		}
		if (method === 'POST' && url.pathname === `${repositoryPath}/actions/variables`) {
			variableExists = true;
			variableValue = String(body.value ?? '');
			return response({}, 201);
		}
		if (method === 'PATCH' && url.pathname === `${repositoryPath}/actions/variables/${variableName}`) {
			variableValue = String(body.value ?? '');
			return response({});
		}
		if (method === 'GET' && url.pathname === `${repositoryPath}/actions/variables/${variableName}`) return response({ name: variableName, value: variableValue });
		if (method === 'GET' && url.pathname === `${repositoryPath}/actions/variables`) {
			return response({ variables: [...(variableExists ? [{ name: variableName }] : []), { name: 'KEEP_ME' }] });
		}
		if (method === 'DELETE' && url.pathname === `${repositoryPath}/actions/variables/${variableName}`) {
			variableExists = false;
			return response({});
		}
		if (method === 'GET' && url.pathname === `${repositoryPath}/environments/${prefix}/secrets/public-key`) return response({ key: 'public-key', key_id: 'key-id' });
		if (method === 'PUT' && url.pathname === `${repositoryPath}/environments/${prefix}/secrets/${secretName}`) {
			secretExists = body.encrypted_value === 'encrypted-value' && body.key_id === 'key-id';
			return response({}, 201);
		}
		if (method === 'GET' && url.pathname === `${repositoryPath}/environments/${prefix}/secrets`) return response({ secrets: secretExists ? [{ name: secretName }] : [] });
		if (method === 'GET' && url.pathname === `${repositoryPath}/actions/workflows`) return response({ workflows: [{ id: 1, path: '.github/workflows/verify.yml', state: 'active' }] });
		if (method === 'GET' && url.pathname === `${repositoryPath}/actions/runs`) return response({ workflow_runs: [{ id: 1 }] });
		return response({ message: `Unexpected request: ${method} ${path}` }, 404);
	}) as unknown as typeof fetch;

	return {
		fetchImpl,
		requests,
		state: () => ({ branchExists, protectionExists, environmentExists, variableExists, secretExists }),
	};
}

describe('GitHub live reconciliation acceptance', () => {
	it('exercises the isolated lifecycle and cleans every prefixed mutation', async () => {
		const runId = '20260812170000';
		const prefix = `trsd-live-staging-github-${runId}`;
		const fixture = createGitHubFixture(prefix);
		const result = await runGitHubAcceptance('/workspace', 'staging', runId, prefix, {
			TREESEED_REPOSITORY: 'treeseed-ai/market',
			TREESEED_GITHUB_TOKEN: 'central-token',
		}, fixture.fetchImpl);

		expect(result.cleanupDrift).toEqual([]);
		expect(result.results).toHaveLength(11);
		expect(result.results.every((entry) => entry.ok)).toBe(true);
		expect(result.results.map((entry) => entry.capability)).toEqual([
			'repository-adoption', 'bootstrap', 'branch', 'branch-rules', 'actions-settings',
			'environment', 'variable', 'secret', 'workflow-presence', 'workflow-observation', 'central-token',
		]);
		expect(fixture.state()).toEqual({ branchExists: false, protectionExists: false, environmentExists: false, variableExists: false, secretExists: false });
		const mutations = fixture.requests.filter((entry) => entry.method !== 'GET');
		expect(mutations.some((entry) => entry.method === 'DELETE' && entry.path === '/repos/treeseed-ai/market')).toBe(false);
		expect(mutations.filter((entry) => entry.method === 'DELETE').map((entry) => entry.path)).toEqual(expect.arrayContaining([
			`/repos/treeseed-ai/market/actions/variables/TREESEED_LIVE_TEST_${prefix.toUpperCase().replace(/[^A-Z0-9]/gu, '_')}_VARIABLE`,
			`/repos/treeseed-ai/market/environments/${prefix}`,
			`/repos/treeseed-ai/market/branches/${prefix}/protection`,
			`/repos/treeseed-ai/market/git/refs/heads/${prefix}`,
		]));
	});
});
