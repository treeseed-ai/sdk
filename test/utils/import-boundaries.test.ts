import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

function filesUnder(dir: string): string[] {
	const entries: string[] = [];
	for (const entry of readdirSync(dir)) {
		const absolute = resolve(dir, entry);
		const stat = statSync(absolute);
		if (stat.isDirectory()) {
			entries.push(...filesUnder(absolute));
		} else if (/\.(?:ts|tsx|js|mjs)$/u.test(entry)) {
			entries.push(absolute);
		}
	}
	return entries;
}

function relativePath(path: string) {
	return path.slice(root.length + 1).replaceAll('\\', '/');
}

describe('reconciliation import boundaries', () => {
	it('keeps CLI out of direct provider mutation modules', () => {
		const blocked = [
			'operations/services/deploy',
			'operations/services/railway-deploy',
			'operations/services/railway-api',
			'operations/services/github-api',
			'hosting/graph',
		];
		const offenders = filesUnder(resolve(root, 'packages', 'cli', 'src'))
			.flatMap((file) => {
				const source = readFileSync(file, 'utf8');
				return blocked
					.filter((pattern) => source.includes(pattern))
					.map((pattern) => `${relativePath(file)} imports ${pattern}`);
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
		const offenders = filesUnder(resolve(root, 'packages', 'sdk', 'src'))
			.filter((file) => !relativePath(file).startsWith('packages/sdk/src/reconcile/providers/'))
			.filter((file) => !allowed.has(relativePath(file)))
			.flatMap((file) => {
				const source = readFileSync(file, 'utf8');
				return blocked
					.filter((pattern) => source.includes(pattern))
					.map((pattern) => `${relativePath(file)} references ${pattern}`);
			});
		expect(offenders).toEqual([]);
	});
});
