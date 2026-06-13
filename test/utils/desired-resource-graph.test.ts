import { describe, expect, it } from 'vitest';
import { compileTreeseedDesiredResourceGraph } from '../../src/platform/desired-state.ts';
import { validateTreeseedPackageManifests } from '../../src/operations/services/package-adapters.ts';
import { inspectTreeseedGitLocks } from '../../src/operations/services/git-runner.ts';

describe('canonical desired resource graph', () => {
	it('compiles package, image, and reconcile resources from one manifest-driven graph', () => {
		const graph = compileTreeseedDesiredResourceGraph({
			tenantRoot: new URL('../../../..', import.meta.url).pathname,
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
			'package-image:treeseed/agent-api',
			'package-image:treeseed/agent-manager',
			'package-image:treeseed/agent-runner',
			'package-image:treeseed/treedx',
		]));
		expect(Object.keys(graph.fingerprints).length).toBe(graph.resources.length);
	});

	it('validates every checked-out Treeseed package manifest', () => {
		const results = validateTreeseedPackageManifests(new URL('../../../..', import.meta.url).pathname);
		expect(results.length).toBeGreaterThanOrEqual(8);
		expect(results.every((entry) => entry.ok)).toBe(true);
	});

	it('reports Git index lock diagnostics without mutating by default', () => {
		const diagnostic = inspectTreeseedGitLocks(new URL('../../../..', import.meta.url).pathname);
		expect(diagnostic.repoRoot).toContain('/market');
		expect(diagnostic.removed).toBe(false);
	});
});
