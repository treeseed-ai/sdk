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
			'package-image:treeseed/agent-api',
			'package-image:treeseed/agent-manager',
			'package-image:treeseed/agent-runner',
			'package-image:treeseed/treedx',
		]));
		expect(Object.keys(graph.fingerprints).length).toBe(graph.resources.length);
	});

	it('validates every checked-out Treeseed package manifest', () => {
		if (!workspaceRoot) return;
		const results = validateTreeseedPackageManifests(workspaceRoot);
		expect(results.length).toBeGreaterThanOrEqual(8);
		expect(results.every((entry) => entry.ok)).toBe(true);
	});

	it('includes local TreeDX as the default content repository plane for local dev', () => {
		if (!workspaceRoot) return;
		const graph = compileTreeseedDesiredResourceGraph({
			tenantRoot: workspaceRoot,
			target: { kind: 'persistent', scope: 'local' },
		});

		const localTreeDx = graph.resources.find((entry) => entry.id === 'local-treedx:team-primary');
		expect(localTreeDx).toMatchObject({
			kind: 'local-treedx',
			provider: 'local',
			packageId: 'treedx',
			spec: expect.objectContaining({
				contentRepositoryAccessMode: 'treedx',
				siteRepositoryAccessMode: 'filesystem',
				projectRepositoryAccessMode: 'filesystem',
				baseUrl: 'http://127.0.0.1:4000',
			}),
		});
		expect(graph.resources.map((entry) => entry.id)).toEqual(expect.arrayContaining([
			'local-docker-compose:treedx',
			'capacity-provider:local',
		]));
	});

	it('includes first-party starter templates in release gate planning', () => {
		if (!workspaceRoot) return;
		const graph = compileTreeseedDesiredResourceGraph({
			tenantRoot: workspaceRoot,
			target: { kind: 'persistent', scope: 'prod' },
		});

		expect(graph.templates.map((entry) => entry.id)).toEqual(expect.arrayContaining([
			'engineering',
			'information-hub',
			'research',
		]));
		expect(graph.resources.map((entry) => entry.id)).toEqual(expect.arrayContaining([
			'template-manifest:engineering',
			'template-manifest:information-hub',
			'template-manifest:research',
			'release-gate:template-verify:engineering',
			'release-gate:template-release-record:engineering',
		]));
		expect(graph.resources.find((entry) => entry.id === 'release-gate:hosted-reconcile:prod:all')?.dependencies)
			.toEqual(expect.arrayContaining([
				'release-gate:template-release-record:engineering',
				'release-gate:template-release-record:information-hub',
				'release-gate:template-release-record:research',
			]));
	});

	it('reports Git index lock diagnostics without mutating by default', () => {
		const diagnostic = inspectTreeseedGitLocks(workspaceRoot ?? resolveTreeseedTestPath(testRoot, 'packages/sdk') ?? testRoot.root);
		expect(diagnostic.repoRoot).toBeTruthy();
		expect(diagnostic.removed).toBe(false);
	});
});
