import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { filesUnderIfExists, resolveTreeseedTestPath, resolveTreeseedTestRoot, treeseedRelativePath } from './workspace-test-root.ts';

const testRoot = resolveTreeseedTestRoot(import.meta.url);

describe('reconciliation import boundaries', () => {
	it('keeps CLI out of direct provider mutation modules', () => {
		const cliSrc = resolveTreeseedTestPath(testRoot, 'packages/cli/src');
		if (!cliSrc) return;
		const blocked = [
			'operations/services/deploy',
			'operations/services/railway-deploy',
			'operations/services/railway-api',
			'operations/services/github-api',
			'hosting/graph',
		];
		const offenders = filesUnderIfExists(cliSrc)
			.flatMap((file) => {
				const source = readFileSync(file, 'utf8');
				return blocked
					.filter((pattern) => source.includes(pattern))
					.map((pattern) => `${treeseedRelativePath(testRoot, file)} imports ${pattern}`);
			});
		expect(offenders).toEqual([]);
	});

	it('keeps workflow operations out of direct provider mutation helpers', () => {
		const blocked = [
			'dispatchGitHubWorkflowRun',
			'upsertGitHubEnvironmentSecret',
			'upsertGitHubEnvironmentVariable',
			'deleteRailwayProject',
			'deployBranchPreview',
			'applyTreeseedHostingGraph',
			'runWorkflowHostedResourceVerification',
		];
		const allowed = new Set([
			'packages/sdk/src/operations/services/github-api.ts',
			'packages/sdk/src/operations/services/railway-api.ts',
			'packages/sdk/src/hosting/graph.ts',
			'packages/sdk/src/reconcile/builtin-adapters.ts',
			'packages/sdk/src/reconcile/live-acceptance.ts',
		]);
		const offenders = filesUnderIfExists(resolveTreeseedTestPath(testRoot, 'packages/sdk/src'))
			.filter((file) => !treeseedRelativePath(testRoot, file).startsWith('packages/sdk/src/reconcile/providers/'))
			.filter((file) => !allowed.has(treeseedRelativePath(testRoot, file)))
			.flatMap((file) => {
				const source = readFileSync(file, 'utf8');
				return blocked
					.filter((pattern) => source.includes(pattern))
					.map((pattern) => `${treeseedRelativePath(testRoot, file)} references ${pattern}`);
			});
		expect(offenders).toEqual([]);
	});
});
