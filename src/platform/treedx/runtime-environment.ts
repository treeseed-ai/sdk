import type { PublicTreeDxFederationConfig } from '../support/contracts.ts';

type RailwayConfig = NonNullable<PublicTreeDxFederationConfig['railway']>;

export function publicTreeDxRuntimeEnvironment(
	railway: RailwayConfig = {},
	dataDir = '/data',
) {
	const runtime = railway.runtime ?? {};
	const repositoryQueries = railway.repositoryQueries ?? {};
	const graphQueries = railway.graphQueries ?? {};
	const configured = Object.fromEntries([
		['TREEDX_RUNTIME_CPU_BUDGET', runtime.cpuBudget],
		['TREEDX_RUNTIME_MEMORY_BUDGET_MB', runtime.memoryBudgetMb],
		['TREEDX_CACHE_MEMORY_FRACTION', runtime.cacheMemoryFraction],
		['TREEDX_REPOSITORY_QUERY_POOL_SIZE', repositoryQueries.poolSize],
		['TREEDX_REPOSITORY_QUERY_MAX_QUEUE', repositoryQueries.maxQueue],
		['TREEDX_REPOSITORY_QUERY_QUEUE_TIMEOUT_MS', repositoryQueries.queueTimeoutMs],
		['TREEDX_GRAPH_WORKER_POOL_SIZE', graphQueries.poolSize],
		['TREEDX_GRAPH_MAX_QUEUE', graphQueries.maxQueue],
		['TREEDX_GRAPH_QUEUE_TIMEOUT_MS', graphQueries.queueTimeoutMs],
	].filter((entry): entry is [string, number] => entry[1] !== undefined).map(([key, value]) => [key, String(value)]));

	return {
		PORT: '4000',
		TREEDX_DATA_DIR: dataDir,
		TREEDX_AUTH_MODE: 'connected',
		TREEDX_AUTH_VERIFIER: 'hs256_dev',
		TREEDX_ALLOW_DEV_VERIFIER_IN_PROD: 'true',
		TREEDX_EXEC_BACKEND: 'container_sandbox',
		TREEDX_FEDERATION_MODE: 'connected_library',
		TREEDX_JWT_AUDIENCE: 'treedx-public-federation',
		TREEDX_JWT_ISSUER: 'https://api.treeseed.local/treedx',
		TREEDX_BOOTSTRAP_TRUST_ACTOR_ID: 'treeseed-api',
		TREEDX_BOOTSTRAP_TRUST_TENANT_ID: 'treeseed-control-plane',
		TREEDX_BOOTSTRAP_TRUST_REPO_IDS: '*',
		TREEDX_BOOTSTRAP_TRUST_REFS: '*',
		TREEDX_BOOTSTRAP_TRUST_PATHS: '**',
		TREEDX_SCOPE: 'public_federation',
		...configured,
	};
}
