import { describe, expect, it } from 'vitest';
import { compileTreeseedDesiredResourceGraph } from '../../src/platform/desired-state.ts';
import { validateTreeseedPackageManifests } from '../../src/operations/services/package-adapters.ts';
import { inspectTreeseedGitLocks } from '../../src/operations/services/git-runner.ts';
import { resolveTreeseedTestPath, resolveTreeseedTestRoot } from './workspace-test-root.ts';

const testRoot = resolveTreeseedTestRoot(import.meta.url);
const workspaceRoot = testRoot.layout === 'workspace' ? testRoot.root : null;

describe('canonical desired resource graph', () => {
	it('compiles package, image, and reconcile resources from one manifest-driven graph', () => {
		if (!workspaceRoot) return;
		const graph = compileTreeseedDesiredResourceGraph({
			tenantRoot: workspaceRoot,
			target: { kind: 'persistent', scope: 'staging' },
		});

		expect(graph.environment).toBe('staging');
		expect(graph.packages.map((entry) => entry.id)).toEqual(expect.arrayContaining([
			'@treeseed/sdk',
			'@treeseed/cli',
			'@treeseed/core',
			'@treeseed/agent',
			'@treeseed/api',
			'treedx',
		]));
		expect(graph.resources.some((entry) => entry.kind === 'railway-service')).toBe(true);
		expect(graph.resources.some((entry) => entry.kind === 'cloudflare-resource')).toBe(true);
		expect(graph.resources.map((entry) => entry.id)).toEqual(expect.arrayContaining([
			'github-environment:root:staging',
			'github-secret-binding:root:staging:TREESEED_CREDENTIAL_SESSION_SECRET',
			'package-image:treeseed/agent-api',
			'package-image:treeseed/agent-manager',
			'package-image:treeseed/agent-runner',
			'package-image:treeseed/treedx',
		]));
		const credentialSecret = graph.resources.find((entry) =>
			entry.id === 'github-secret-binding:root:staging:TREESEED_CREDENTIAL_SESSION_SECRET');
		expect(credentialSecret?.kind).toBe('github-secret-binding');
		expect(credentialSecret?.provider).toBe('github');
		expect(credentialSecret?.packageId).toBeNull();
		expect(credentialSecret?.spec).toMatchObject({
			repository: 'knowledge-coop/market',
			environment: 'staging',
			secretName: 'TREESEED_CREDENTIAL_SESSION_SECRET',
			envName: 'TREESEED_CREDENTIAL_SESSION_SECRET',
		});
		expect(Object.keys(graph.fingerprints).length).toBe(graph.resources.length);
	});

	it('validates every checked-out Treeseed package manifest', () => {
		if (!workspaceRoot) return;
		const results = validateTreeseedPackageManifests(workspaceRoot);
		expect(results.length).toBeGreaterThanOrEqual(8);
		expect(results.every((entry) => entry.ok)).toBe(true);
	});

	it('reports Git index lock diagnostics without mutating by default', () => {
		const diagnostic = inspectTreeseedGitLocks(workspaceRoot ?? resolveTreeseedTestPath(testRoot, 'packages/sdk') ?? testRoot.root);
		expect(diagnostic.repoRoot).toBeTruthy();
		expect(diagnostic.removed).toBe(false);
	});
});
