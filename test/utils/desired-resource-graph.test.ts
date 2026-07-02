import { describe, expect, it } from 'vitest';
import { compileTreeseedDesiredResourceGraph } from '../../src/platform/desired-state.ts';
import {
	deriveTreeseedPackageProjectResources,
	discoverTreeseedPackageAdapters,
	validateTreeseedPackageManifests,
} from '../../src/operations/services/package-adapters.ts';
import { assertDevelopmentInternalCommitReferences } from '../../src/operations/services/package-reference-policy.ts';
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
			'package-image:treeseed/agent-manager',
			'package-image:treeseed/agent-runner',
			'package-image:treeseed/treedx',
		]));
		expect(graph.resources.map((entry) => entry.id)).not.toContain('package-image:treeseed/agent-api');
		expect(Object.keys(graph.fingerprints).length).toBe(graph.resources.length);
	});

	it('validates every checked-out Treeseed package manifest', () => {
		if (!workspaceRoot) return;
		const results = validateTreeseedPackageManifests(workspaceRoot);
		expect(results.length).toBeGreaterThanOrEqual(8);
		expect(results.every((entry) => entry.ok)).toBe(true);
		const adapters = discoverTreeseedPackageAdapters(workspaceRoot);
		const dockerPackages = adapters.filter((adapter) => adapter.artifacts.some((artifact) => artifact.provider === 'docker'));
		expect(dockerPackages.map((adapter) => adapter.id).sort()).toEqual(['@treeseed/agent', '@treeseed/api', 'treedx']);
		for (const adapter of dockerPackages) {
			expect(adapter.metadata.deploymentSource).toMatchObject({
				staging: 'git',
				prod: 'image',
			});
		}
	});

	it('blocks production image publish gates on reconciled DockerHub GitHub bindings', () => {
		if (!workspaceRoot) return;
		const graph = compileTreeseedDesiredResourceGraph({
			tenantRoot: workspaceRoot,
			target: { kind: 'persistent', scope: 'prod' },
		});
		const resourceIds = graph.resources.map((entry) => entry.id);
		expect(resourceIds).toEqual(expect.arrayContaining([
			'github-secret-binding:@treeseed/agent:production:TREESEED_DOCKERHUB_TOKEN',
			'github-variable-binding:@treeseed/agent:production:TREESEED_DOCKERHUB_USERNAME',
			'github-secret-binding:@treeseed/api:production:TREESEED_DOCKERHUB_TOKEN',
			'github-variable-binding:@treeseed/api:production:TREESEED_DOCKERHUB_USERNAME',
			'github-secret-binding:treedx:production:TREESEED_DOCKERHUB_TOKEN',
			'github-variable-binding:treedx:production:TREESEED_DOCKERHUB_USERNAME',
		]));

		const dependenciesFor = (id: string) =>
			graph.resources.find((entry) => entry.id === id)?.dependencies ?? [];
		for (const packageId of ['@treeseed/agent', '@treeseed/api', 'treedx']) {
			expect(dependenciesFor(`release-gate:image-publish:${packageId}`)).toEqual(expect.arrayContaining([
				`release-gate:verify:${packageId}`,
				`github-secret-binding:${packageId}:production:TREESEED_DOCKERHUB_TOKEN`,
				`github-variable-binding:${packageId}:production:TREESEED_DOCKERHUB_USERNAME`,
			]));
		}
	});

	it('keeps development package manifests pinned to internal Git commit refs', () => {
		if (!workspaceRoot) return;
		expect(() => assertDevelopmentInternalCommitReferences(workspaceRoot)).not.toThrow();
	});

	it('exposes first-party package project architecture and docs readiness from package manifests', () => {
		if (!workspaceRoot) return;
		const adapters = discoverTreeseedPackageAdapters(workspaceRoot);
		const packageIds = adapters.map((entry) => entry.id);
		expect(packageIds).toEqual(expect.arrayContaining([
			'@treeseed/admin',
			'@treeseed/agent',
			'@treeseed/api',
			'@treeseed/cli',
			'@treeseed/core',
			'@treeseed/sdk',
			'@treeseed/ui',
			'treedx',
		]));
		for (const adapter of adapters.filter((entry) =>
			entry.id === 'treedx' || entry.id.startsWith('@treeseed/'))) {
			expect(adapter.metadata.projectArchitecture).toMatchObject({
				topology: 'single_repository_site',
				rootPath: '.',
				sitePath: 'docs',
				contentPath: 'docs',
				contentRuntimeSource: 'r2_published_manifest',
			});
			expect(adapter.metadata.projectArchitecture).toHaveProperty('contentPublishTarget');
			expect(JSON.stringify(adapter.metadata)).not.toContain('TREESEED_GITHUB_TOKEN');
			expect(JSON.stringify(adapter.metadata)).not.toContain('ghp_');
		}
		const readiness = Object.fromEntries(adapters.map((entry) => [entry.id, entry.metadata.docsSiteReadiness]));
		expect(readiness).toMatchObject({
			'@treeseed/agent': 'ready',
			'@treeseed/sdk': 'ready',
			treedx: 'ready',
			'@treeseed/admin': 'site_not_prepared',
			'@treeseed/api': 'site_not_prepared',
			'@treeseed/cli': 'site_not_prepared',
			'@treeseed/core': 'site_not_prepared',
			'@treeseed/ui': 'site_not_prepared',
		});
	});

	it('derives safe package project resources for later seed expansion', () => {
		if (!workspaceRoot) return;
		const projects = deriveTreeseedPackageProjectResources(workspaceRoot);
		expect(projects.map((entry) => entry.slug)).toEqual(expect.arrayContaining([
			'admin',
			'agent',
			'api',
			'cli',
			'core',
			'sdk',
			'ui',
			'treedx',
		]));
		for (const project of projects) {
			expect(project).toMatchObject({
				team: 'team:treeseed',
				kind: 'package',
				architecture: {
					topology: 'single_repository_site',
					rootPath: '.',
					sitePath: 'docs',
					contentPath: 'docs',
				},
				metadata: {
					visibility: 'public',
					releaseOwnership: 'treeseed.package.yaml',
				},
			});
			expect(project.repository.gitUrl).toMatch(/^https:\/\/github\.com\/treeseed-ai\/.+\.git$/u);
			expect(JSON.stringify(project)).not.toContain('TREESEED_GITHUB_TOKEN');
			expect(JSON.stringify(project)).not.toContain('ghp_');
			expect(JSON.stringify(project)).not.toContain('secret-token');
		}
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
			'local-docker-compose:mailpit',
			'local-docker-compose:treedx',
			'capacity-provider:local',
		]));
		const mailpit = graph.resources.find((entry) => entry.id === 'local-docker-compose:mailpit');
		expect(mailpit).toMatchObject({
			kind: 'local-docker-compose',
			provider: 'local',
			packageId: '@treeseed/sdk',
			serviceId: 'mailpit',
			spec: expect.objectContaining({
				projectName: 'treeseed-local-mailpit',
				composeFile: 'packages/sdk/src/treeseed/services/compose.yml',
			}),
		});
	});

	it('adds project architecture diagnostics to local dev without cloning content by default', () => {
		if (!workspaceRoot) return;
		const graph = compileTreeseedDesiredResourceGraph({
			tenantRoot: workspaceRoot,
			target: { kind: 'persistent', scope: 'local' },
		});
		const materialization = graph.resources.filter((entry) => entry.kind === 'local-content-materialization');

		expect(materialization.length).toBeGreaterThanOrEqual(2);
		expect(materialization.map((entry) => entry.spec.projectSlug)).toEqual(expect.arrayContaining(['market', 'karyon']));
		expect(materialization.find((entry) => entry.spec.projectSlug === 'market')?.spec).toMatchObject({
			topology: 'single_repository_site',
			rootPath: '.',
			sitePath: '.',
			contentPath: 'src/content',
			localContentMaterialization: 'existing_path',
			requestedLocalContentMode: 'auto',
			executeRequested: false,
		});
		expect(materialization.find((entry) => entry.spec.projectSlug === 'karyon')?.spec).toMatchObject({
			topology: 'single_repository_site',
			sitePath: 'docs',
			contentRuntimeSource: 'treedx_snapshot',
			localContentMaterialization: 'none',
			contentSourceMode: 'treedx',
			requestedLocalContentMode: 'auto',
			executeRequested: false,
		});
	});

	it('plans managed local content materialization only when preview or edit is requested', () => {
		if (!workspaceRoot) return;
		const graph = compileTreeseedDesiredResourceGraph({
			tenantRoot: workspaceRoot,
			target: { kind: 'persistent', scope: 'local' },
			localContent: 'preview',
		});
		const karyon = graph.resources.find((entry) =>
			entry.kind === 'local-content-materialization' && entry.spec.projectSlug === 'karyon');

		expect(karyon?.spec).toMatchObject({
			localContentMaterialization: 'managed_clone',
			requestedLocalContentMode: 'preview',
			executeRequested: true,
			sourceRepoSlug: 'karyon-life/karyon',
		});
		expect(JSON.stringify(karyon)).not.toContain('TREESEED_GITHUB_TOKEN');
		expect(JSON.stringify(karyon)).not.toContain('secret-token');
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

	it('orders package release verify gates by declared internal package dependencies', () => {
		if (!workspaceRoot) return;
		const graph = compileTreeseedDesiredResourceGraph({
			tenantRoot: workspaceRoot,
			target: { kind: 'persistent', scope: 'staging' },
		});
		const dependenciesFor = (id: string) =>
			graph.resources.find((entry) => entry.id === id)?.dependencies ?? [];

		expect(dependenciesFor('release-gate:verify:@treeseed/core')).toEqual(expect.arrayContaining([
			'release-gate:verify:@treeseed/sdk',
			'release-gate:verify:@treeseed/ui',
		]));
		expect(dependenciesFor('release-gate:verify:@treeseed/admin')).toEqual(expect.arrayContaining([
			'release-gate:verify:@treeseed/core',
			'release-gate:verify:@treeseed/sdk',
			'release-gate:verify:@treeseed/ui',
		]));
		expect(dependenciesFor('release-gate:verify:@treeseed/api')).toEqual(expect.arrayContaining([
			'release-gate:verify:@treeseed/cli',
			'release-gate:verify:@treeseed/sdk',
		]));
		expect(graph.resources.find((entry) => entry.id === 'release-gate:npm-publish:@treeseed/sdk')?.spec)
			.toMatchObject({
				repository: 'treeseed-ai/sdk',
			});
	});

	it('reports Git index lock diagnostics without mutating by default', () => {
		const diagnostic = inspectTreeseedGitLocks(workspaceRoot ?? resolveTreeseedTestPath(testRoot, 'packages/sdk') ?? testRoot.root);
		expect(diagnostic.repoRoot).toBeTruthy();
		expect(diagnostic.removed).toBe(false);
	});
});
