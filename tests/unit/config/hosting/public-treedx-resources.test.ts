import { describe, expect, it } from 'vitest';
import { parsePublicTreeDxFederationConfig } from '../../../../src/platform/deploy-config/parse-public-tree-dx-federation-config.ts';

describe('public TreeDX resource configuration', () => {
	it('parses bounded runtime and query-pool resources', () => {
		expect(parsePublicTreeDxFederationConfig({ railway: {
			runtime: { cpuBudget: 4, memoryBudgetMb: 4096, cacheMemoryFraction: 0.35 },
			repositoryQueries: { poolSize: 16, maxQueue: 256, queueTimeoutMs: 250 },
			graphQueries: { poolSize: 4, maxQueue: 128, queueTimeoutMs: 500 },
		} })).toMatchObject({ railway: {
			runtime: { cpuBudget: 4, memoryBudgetMb: 4096, cacheMemoryFraction: 0.35 },
			repositoryQueries: { poolSize: 16, maxQueue: 256, queueTimeoutMs: 250 },
			graphQueries: { poolSize: 4, maxQueue: 128, queueTimeoutMs: 500 },
		} });
	});

	it('rejects fractional worker counts and cache fractions above one', () => {
		expect(() => parsePublicTreeDxFederationConfig({ railway: {
			repositoryQueries: { poolSize: 1.5 },
		} })).toThrow(/positive integer/u);
		expect(() => parsePublicTreeDxFederationConfig({ railway: {
			runtime: { cacheMemoryFraction: 1.1 },
		} })).toThrow(/at most 1/u);
	});
});
