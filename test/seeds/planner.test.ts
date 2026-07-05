import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify } from 'yaml';
import { loadSeedManifest } from '../../src/seeds/loader.js';
import { createSeedPlan } from '../../src/seeds/planner.js';
import { parseSeedManifest } from '../../src/seeds/schema.js';
import type { SeedManifest } from '../../src/seeds/types.js';

const TREESEED_PROJECT_KEYS = [
	'project:treeseed/admin',
	'project:treeseed/agent',
	'project:treeseed/api',
	'project:treeseed/cli',
	'project:treeseed/core',
	'project:treeseed/market',
	'project:treeseed/sdk',
	'project:treeseed/treedx',
	'project:treeseed/ui',
];

const singleRepositorySiteArchitecture = {
	topology: 'single_repository_site',
	rootPath: '.',
	sitePath: 'docs',
	contentPath: 'docs/src/content',
	contentRuntimeSource: 'r2_published_manifest',
	localContentMaterialization: 'none',
	contentPublishTarget: {
		kind: 'cloudflare_r2',
		prefix: 'demo/site',
	},
} as const;

const TRESEED_PACKAGES = [
	['api', '@treeseed/api', 'site_not_prepared', 'none'],
	['treedx', 'treedx', 'ready', 'existing_path'],
	['sdk', '@treeseed/sdk', 'ready', 'existing_path'],
	['ui', '@treeseed/ui', 'site_not_prepared', 'none'],
	['cli', '@treeseed/cli', 'site_not_prepared', 'none'],
	['core', '@treeseed/core', 'site_not_prepared', 'none'],
	['admin', '@treeseed/admin', 'site_not_prepared', 'none'],
	['agent', '@treeseed/agent', 'ready', 'existing_path'],
] as const;

function firstPartyProject(slug: typeof TRESEED_PACKAGES[number][0], packageId: string, docsSiteReadiness: string, localContentMaterialization: string) {
	return {
		key: `project:treeseed/${slug}`,
		team: 'team:treeseed',
		slug,
		name: slug === 'treedx' ? 'TreeDX' : `TreeSeed ${slug[0]!.toUpperCase()}${slug.slice(1)}`,
		description: `${slug} first-party package project.`,
		kind: 'package',
		repository: {
			role: 'primary',
			provider: 'github',
			owner: 'treeseed-ai',
			name: slug,
			gitUrl: `https://github.com/treeseed-ai/${slug}.git`,
			defaultBranch: 'main',
			checkoutPath: `packages/${slug}`,
			submodulePath: `packages/${slug}`,
		},
		architecture: {
			topology: 'single_repository_site',
			rootPath: '.',
			sitePath: 'docs',
			contentPath: 'docs',
			contentRuntimeSource: 'r2_published_manifest',
			localContentMaterialization,
			contentPublishTarget: {
				kind: 'cloudflare_r2',
				prefix: `packages/${slug}`,
			},
		},
		metadata: {
			packageId,
			packagePath: `packages/${slug}`,
			visibility: 'public',
			docsSiteReadiness,
			releaseOwnership: 'treeseed.package.yaml',
		},
	};
}

function canonicalTreeseedSeed(): SeedManifest {
	const projects = [
		{
			key: 'project:treeseed/market',
			team: 'team:treeseed',
			slug: 'market',
			name: 'TreeSeed Market',
			description: 'Top-level market application and control plane.',
			kind: 'market_app',
			repository: {
				role: 'primary',
				provider: 'github',
				owner: 'knowledge-coop',
				name: 'market',
				gitUrl: 'https://github.com/knowledge-coop/market.git',
				defaultBranch: 'main',
				checkoutPath: '.',
			},
			architecture: {
				topology: 'single_repository_site',
				rootPath: '.',
				sitePath: '.',
				contentPath: 'src/content',
				contentRuntimeSource: 'r2_published_manifest',
				localContentMaterialization: 'existing_path',
				contentPublishTarget: {
					kind: 'cloudflare_r2',
					prefix: 'market',
				},
			},
			metadata: {
				demoRole: 'market-control-plane',
				visibility: 'private',
			},
		},
		...TRESEED_PACKAGES.map(([slug, packageId, docsSiteReadiness, localContentMaterialization]) =>
			firstPartyProject(slug, packageId, docsSiteReadiness, localContentMaterialization)),
	];
	const grantAllocations: Record<string, number> = {
		market: 50,
		api: 6,
		treedx: 10,
		sdk: 6,
		ui: 6,
		cli: 6,
		core: 6,
		admin: 6,
		agent: 4,
	};
	const projectSlugs = ['market', ...TRESEED_PACKAGES.map(([slug]) => slug)];
	return {
		name: 'treeseed',
		version: 1,
		description: 'TreeSeed platform development and operations portfolio',
		defaultEnvironments: ['local'],
		environments: ['local', 'staging', 'prod'],
		resources: {
			teams: [{
				key: 'team:treeseed',
				slug: 'treeseed',
				name: 'treeseed',
				displayName: 'TreeSeed',
				profileSummary: 'TreeSeed platform market, integrated package, and agent operations.',
				metadata: { visibility: 'private' },
			}],
			projects,
			capacityProviders: [{
				key: 'capacity-provider:treeseed/local-dev',
				environments: ['local'],
				team: 'team:treeseed',
				name: 'treeseed-local-dev',
				kind: 'local',
				provider: 'local',
				billingScope: 'team',
				creditBudgetMode: 'derived',
				maxConcurrentWorkdays: 2,
				maxConcurrentWorkers: 4,
				executionProviders: [{
					id: 'treeseed-local-codex',
					name: 'Local Codex capacity',
					kind: 'codex_subscription',
					nativeUnit: 'wall_minute',
					quotaVisibility: 'opaque',
					maxConcurrentWorkers: 4,
					resetCadence: 'daily',
					nativeLimits: [{
						scope: 'daily',
						nativeUnit: 'wall_minute',
						limitAmount: 10,
						reserveBufferPercent: 20,
						resetCadence: 'daily',
						confidence: 'estimated',
						source: 'configured',
					}],
				}],
				registration: {
					apiKey: {
						createIfMissing: true,
						name: 'TreeSeed local provider security code',
						scopes: ['provider:register', 'provider:heartbeat', 'provider:portfolio:read', 'provider:assignments:read', 'provider:assignments:write', 'provider:usage:report', 'provider:reports:write', 'provider:capabilities:write'],
					},
				},
			}],
			capacityGrants: projectSlugs.map((slug) => ({
				key: `capacity-grant:treeseed/local/${slug}`,
				environments: ['local'],
				provider: 'capacity-provider:treeseed/local-dev',
				team: 'team:treeseed',
				project: `project:treeseed/${slug}`,
				environment: 'local',
				grantScope: 'project',
				portfolioAllocationPercent: grantAllocations[slug] ?? 1,
				reservePoolPercent: 10,
				priorityWeight: 1,
				overflowPolicy: 'soft_grant',
			})),
			workPolicies: [
				...projectSlugs.map((slug) => ({
					key: `work-policy:treeseed/local/${slug}`,
					environments: ['local'],
					project: `project:treeseed/${slug}`,
					environment: 'local',
					enabled: true,
					startCron: '0 9 * * 1-5',
					durationMinutes: 480,
					maxRunners: 1,
					maxWorkersPerRunner: 4,
					dailyCreditBudget: 5000,
					maxQueuedTasks: 100,
					maxQueuedCredits: 10000,
				})),
				...['staging', 'prod'].map((environment) => ({
					key: `work-policy:treeseed/${environment}/market`,
					environments: [environment],
					project: 'project:treeseed/market',
					environment,
					enabled: true,
					startCron: '0 9 * * 1-5',
					durationMinutes: 480,
					maxRunners: 1,
					maxWorkersPerRunner: 4,
					dailyCreditBudget: 2500,
					maxQueuedTasks: 50,
					maxQueuedCredits: 5000,
				})),
			],
			repositoryHosts: [
				{
					key: 'repository-host:treeseed/knowledge-coop-github',
					team: 'team:treeseed',
					provider: 'github',
					name: 'knowledge-coop',
					ownership: 'treeseed_managed',
					accountLabel: 'Knowledge Coop GitHub organization',
					organizationOrOwner: 'knowledge-coop',
					defaultVisibility: 'private',
					softwareRepositoryNameTemplate: '{project}',
					contentRepositoryNameTemplate: '{project}-content',
					allowedProjectKinds: ['market_app', 'package', 'knowledge_hub'],
					status: 'active',
					credentialRef: 'env:TREESEED_GITHUB_TOKEN',
				},
				{
					key: 'repository-host:treeseed/treeseed-ai-github',
					team: 'team:treeseed',
					provider: 'github',
					name: 'treeseed-ai',
					ownership: 'treeseed_managed',
					accountLabel: 'TreeSeed AI GitHub organization',
					organizationOrOwner: 'treeseed-ai',
					defaultVisibility: 'public',
					softwareRepositoryNameTemplate: '{project}',
					contentRepositoryNameTemplate: '{project}-content',
					allowedProjectKinds: ['market_app', 'package', 'knowledge_hub'],
					status: 'active',
					credentialRef: 'env:TREESEED_GITHUB_TOKEN',
				},
			],
			hubRepositories: [],
			products: ['market-template', 'engineering-template', 'research-template'].map((slug) => ({
				key: `product:treeseed/${slug}`,
				team: 'team:treeseed',
				kind: 'template',
				slug,
				title: slug,
				summary: `${slug} template`,
				visibility: 'public',
				listingEnabled: true,
				offerMode: 'free',
				manifestKey: slug === 'market-template' ? 'seeds/treeseed.yaml' : `src/content/templates/${slug}.mdx`,
				artifactKey: `catalog/${slug}/1.0.0/template`,
				searchText: slug,
			})),
			catalogArtifacts: ['market-template', 'engineering-template', 'research-template'].map((slug) => ({
				key: `catalog-artifact:treeseed/${slug}/1.0.0`,
				product: `product:treeseed/${slug}`,
				version: '1.0.0',
				kind: 'template',
				contentKey: `catalog/${slug}/1.0.0/template`,
				manifestKey: slug === 'market-template' ? 'seeds/treeseed.yaml' : `src/content/templates/${slug}.mdx`,
			})),
			agentPools: [],
		},
		operationRecipes: [],
	} as SeedManifest;
}

function writeSeedWorkspace(seed: SeedManifest) {
	const root = mkdtempSync(join(tmpdir(), 'treeseed-sdk-seed-test-'));
	mkdirSync(join(root, 'seeds'), { recursive: true });
	writeFileSync(join(root, 'seeds', 'treeseed.yaml'), stringify(seed), 'utf8');
	return root;
}

const manifest: SeedManifest = {
	name: 'demo',
	version: 1,
	defaultEnvironments: ['local'],
	environments: ['local', 'prod'],
	resources: {
		teams: [
			{
				key: 'team:demo',
				slug: 'demo',
				name: 'demo',
			},
		],
		repositoryHosts: [],
		projects: [],
		hubRepositories: [],
		products: [],
		catalogArtifacts: [],
		capacityProviders: [
			{
				key: 'capacity-provider:demo/local',
				environments: ['local'],
				team: 'team:demo',
				name: 'demo-local',
				kind: 'local',
				provider: 'local',
				creditBudgetMode: 'derived',
				executionProviders: [{
					id: 'demo-local-codex',
					name: 'Demo local Codex',
					kind: 'codex_subscription',
					nativeUnit: 'wall_minute',
					quotaVisibility: 'opaque',
					maxConcurrentWorkers: 4,
					resetCadence: 'daily',
					nativeLimits: [{
						scope: 'daily',
						nativeUnit: 'wall_minute',
						limitAmount: 480,
						reserveBufferPercent: 20,
						resetCadence: 'daily',
						confidence: 'estimated',
						source: 'configured',
					}],
				}],
				registration: {
					apiKey: {
						createIfMissing: true,
						name: 'Demo local provider security code',
						scopes: ['provider:register', 'provider:heartbeat', 'provider:portfolio:read', 'provider:assignments:read', 'provider:assignments:write', 'provider:usage:report', 'provider:reports:write', 'provider:capabilities:write'],
					},
				},
				lanes: [
					{
						key: 'lane:demo/local/codex',
						name: 'local-codex',
						unit: 'treeseed_credit',
					},
				],
			},
			{
				key: 'capacity-provider:demo/prod',
				environments: ['prod'],
				team: 'team:demo',
				name: 'demo-prod',
				kind: 'managed',
				provider: 'railway',
				lanes: [],
			},
		],
		capacityGrants: [],
		workPolicies: [],
		agentPools: [],
	},
	operationRecipes: [],
};

describe('seed planner current-state diffing', () => {
	it('plans the canonical Treeseed seed as an exact nine-project first-party portfolio', () => {
		const workspaceRoot = writeSeedWorkspace(canonicalTreeseedSeed());
		try {
			const loaded = loadSeedManifest(workspaceRoot, 'treeseed');
			expect(loaded.diagnostics).toEqual([]);
			const diagnostics = [];
			const parsed = parseSeedManifest(loaded.value, diagnostics);
			expect(diagnostics).toEqual([]);
			expect(parsed).toBeTruthy();
			const projects = parsed!.resources.projects;
			expect(projects.map((project) => project.key).sort()).toEqual(TREESEED_PROJECT_KEYS);
			expect(JSON.stringify(projects)).not.toContain('karyon');
			expect(projects.find((project) => project.key === 'project:treeseed/market')?.metadata).toMatchObject({ visibility: 'private' });
			for (const project of projects.filter((entry) => entry.key !== 'project:treeseed/market')) {
				expect(project.kind).toBe('package');
				expect(project.repository.owner).toBe('treeseed-ai');
				expect(project.architecture).toMatchObject({
					topology: 'single_repository_site',
					rootPath: '.',
					sitePath: 'docs',
					contentPath: 'docs',
					contentRuntimeSource: 'r2_published_manifest',
					contentPublishTarget: {
						kind: 'cloudflare_r2',
						prefix: `packages/${project.slug}`,
					},
				});
				expect(project.metadata).toMatchObject({
					visibility: 'public',
					releaseOwnership: 'treeseed.package.yaml',
				});
			}
			const plan = createSeedPlan({
				manifest: parsed!,
				manifestPath: loaded.path,
				environments: ['local'],
				mode: 'plan',
			});
			expect(plan.summary).toMatchObject({ create: 37, update: 0, unchanged: 0, skip: 2 });
			expect(plan.actions.filter((action) => action.kind === 'project').map((action) => action.key).sort()).toEqual(TREESEED_PROJECT_KEYS);
			expect(JSON.stringify(plan)).not.toMatch(/project:karyon|repositoryTopology|contentRoot|ghp_/u);
		} finally {
			rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	it('plans creates, skips, unchanged resources, and updates deterministically', () => {
		const empty = createSeedPlan({
			manifest,
			manifestPath: 'seeds/demo.yaml',
			environments: ['local'],
			mode: 'plan',
		});

		expect(empty.summary).toMatchObject({
			create: 3,
			update: 0,
			unchanged: 0,
			skip: 1,
		});
		expect(empty.actions.find((action) => action.key === 'capacity-provider:demo/local')?.payload.registration).toEqual({
			apiKey: {
				createIfMissing: true,
				name: 'Demo local provider security code',
				scopes: ['provider:register', 'provider:heartbeat', 'provider:portfolio:read', 'provider:assignments:read', 'provider:assignments:write', 'provider:usage:report', 'provider:reports:write', 'provider:capabilities:write'],
				expiresAt: undefined,
			},
		});
		expect(empty.actions.find((action) => action.key === 'capacity-provider:demo/local')?.payload).toMatchObject({
			creditBudgetMode: 'derived',
			monthlyCreditBudget: null,
			dailyCreditBudget: null,
			executionProviders: [{
				id: 'demo-local-codex',
				kind: 'codex_subscription',
				nativeUnit: 'wall_minute',
				nativeLimits: [{
					scope: 'daily',
					nativeUnit: 'wall_minute',
					limitAmount: 480,
					reserveBufferPercent: 20,
				}],
			}],
		});

		const matching = createSeedPlan({
			manifest,
			manifestPath: 'seeds/demo.yaml',
			environments: ['local'],
			mode: 'plan',
			currentResources: empty.actions
				.filter((action) => action.action === 'create')
				.map((action) => ({
					key: action.key,
					kind: action.kind,
					payload: action.payload,
					existing: { id: `${action.key}:id` },
				})),
		});

		expect(matching.summary).toMatchObject({
			create: 0,
			update: 0,
			unchanged: 3,
			skip: 1,
		});
		expect(matching.actions.find((action) => action.key === 'capacity-provider:demo/prod')?.action).toBe('skip');

		const changed = createSeedPlan({
			manifest,
			manifestPath: 'seeds/demo.yaml',
			environments: ['local'],
			mode: 'plan',
			currentResources: matching.actions
				.filter((action) => action.action === 'unchanged')
				.map((action) => ({
					key: action.key,
					kind: action.kind,
					payload: action.key === 'team:demo'
						? { ...action.payload, displayName: 'Old Demo' }
						: action.payload,
					existing: action.existing,
				})),
		});

		expect(changed.summary).toMatchObject({
			create: 0,
			update: 1,
			unchanged: 2,
			skip: 1,
		});
		expect(changed.actions.find((action) => action.key === 'team:demo')?.action).toBe('update');
	});

	it('validates productized resource buckets and plans them deterministically', () => {
		const diagnostics = [];
		const parsed = parseSeedManifest({
			name: 'demo',
			version: 1,
			defaultEnvironments: ['local'],
			environments: ['local'],
			resources: {
				teams: [{ key: 'team:demo', slug: 'demo' }],
				repositoryHosts: [{
					key: 'repository-host:demo/github',
					team: 'team:demo',
					provider: 'github',
					name: 'demo',
					ownership: 'treeseed_managed',
					organizationOrOwner: 'demo',
					credentialRef: 'provider-session:github-demo',
				}],
				projects: [{
					key: 'project:demo/site',
					team: 'team:demo',
					slug: 'site',
					name: 'Demo Site',
					repository: {
						role: 'primary',
						provider: 'github',
						owner: 'demo',
						name: 'site',
						gitUrl: 'https://github.com/demo/site.git',
					},
					architecture: singleRepositorySiteArchitecture,
				}],
				hubRepositories: [{
					key: 'hub-repository:demo/site/content',
					project: 'project:demo/site',
					repositoryHost: 'repository-host:demo/github',
					role: 'content',
					provider: 'github',
					owner: 'demo',
					name: 'site-content',
					gitUrl: 'https://github.com/demo/site-content.git',
				}],
				products: [{
					key: 'product:demo/site-template',
					team: 'team:demo',
					kind: 'template',
					slug: 'site-template',
					title: 'Demo Site Template',
					visibility: 'public',
					listingEnabled: true,
				}],
				catalogArtifacts: [{
					key: 'catalog-artifact:demo/site-template/1.0.0',
					product: 'product:demo/site-template',
					version: '1.0.0',
					kind: 'template',
					contentKey: 'catalog/demo/site-template/1.0.0',
					manifestKey: 'seeds/demo.yaml',
				}],
				capacityProviders: [],
				capacityGrants: [],
				workPolicies: [],
				agentPools: [],
			},
		}, diagnostics);

		expect(diagnostics).toHaveLength(0);
		expect(parsed).not.toBeNull();
		const plan = createSeedPlan({
			manifest: parsed!,
			manifestPath: 'seeds/demo.yaml',
			environments: ['local'],
			mode: 'plan',
		});
		expect(plan.actions.map((action) => action.kind)).toEqual([
			'team',
			'repositoryHost',
			'project',
			'hubRepository',
			'product',
			'catalogArtifact',
		]);
		expect(plan.summary.create).toBe(6);
		expect(plan.actions.find((action) => action.key === 'project:demo/site')?.payload.architecture).toEqual(singleRepositorySiteArchitecture);
	});

	it('supports canonical project architecture modes without requiring repository restructuring', () => {
		const diagnostics = [];
		const parsed = parseSeedManifest({
			name: 'demo',
			version: 1,
			defaultEnvironments: ['local'],
			environments: ['local'],
			resources: {
				teams: [{ key: 'team:demo', slug: 'demo' }],
				repositoryHosts: [],
				projects: [
					{
						key: 'project:demo/package',
						team: 'team:demo',
						slug: 'package',
						name: 'Demo Package',
						kind: 'package',
						repository: {
							role: 'primary',
							provider: 'github',
							owner: 'demo',
							name: 'package',
							gitUrl: 'https://github.com/demo/package.git',
						},
						architecture: {
							topology: 'single_repository_site',
							rootPath: '.',
							sitePath: 'docs',
							contentRuntimeSource: 'r2_published_manifest',
							localContentMaterialization: 'none',
						},
					},
					{
						key: 'project:demo/split',
						team: 'team:demo',
						slug: 'split',
						name: 'Demo Split',
						repository: {
							role: 'site',
							provider: 'github',
							owner: 'demo',
							name: 'split-site',
							gitUrl: 'https://github.com/demo/split-site.git',
						},
						architecture: {
							topology: 'split_site_content',
							rootPath: '.',
							sitePath: 'docs',
							contentPath: 'docs/src/content',
							contentRuntimeSource: 'treedx_snapshot',
							localContentMaterialization: 'none',
							contentPublishTarget: {
								kind: 'cloudflare_r2',
								prefix: 'demo/split',
							},
						},
					},
					{
						key: 'project:demo/workspace',
						team: 'team:demo',
						slug: 'workspace',
						name: 'Demo Workspace',
						repository: {
							role: 'primary',
							provider: 'github',
							owner: 'demo',
							name: 'workspace',
							gitUrl: 'https://github.com/demo/workspace.git',
							submodulePath: 'packages/site',
						},
						architecture: {
							topology: 'parent_workspace',
							rootPath: 'packages/site',
							sitePath: 'docs',
							contentRuntimeSource: 'r2_preview_overlay',
							localContentMaterialization: 'submodule',
							requiresLocalContentForCi: true,
						},
					},
				],
				hubRepositories: [],
				products: [],
				catalogArtifacts: [],
				capacityProviders: [],
				capacityGrants: [],
				workPolicies: [],
				agentPools: [],
			},
		}, diagnostics);

		expect(diagnostics).toHaveLength(0);
		const plan = createSeedPlan({
			manifest: parsed!,
			manifestPath: 'seeds/demo.yaml',
			environments: ['local'],
			mode: 'plan',
		});
		expect(plan.actions.filter((action) => action.kind === 'project').map((action) => action.payload.architecture)).toEqual([
			expect.objectContaining({ topology: 'single_repository_site', sitePath: 'docs' }),
			expect.objectContaining({ topology: 'split_site_content', contentRuntimeSource: 'treedx_snapshot' }),
			expect.objectContaining({ topology: 'parent_workspace', localContentMaterialization: 'submodule' }),
		]);
	});

	it('rejects missing architecture, missing sitePath, legacy topology metadata, and implicit local content checkout requirements', () => {
		const diagnostics = [];
		parseSeedManifest({
			name: 'demo',
			version: 1,
			environments: ['local'],
			resources: {
				teams: [{ key: 'team:demo', slug: 'demo' }],
				repositoryHosts: [],
				projects: [
					{
						key: 'project:demo/missing-architecture',
						team: 'team:demo',
						slug: 'missing-architecture',
						name: 'Missing Architecture',
						repository: {
							role: 'primary',
							provider: 'github',
							owner: 'demo',
							name: 'missing-architecture',
							gitUrl: 'https://github.com/demo/missing-architecture.git',
						},
					},
					{
						key: 'project:demo/missing-site-path',
						team: 'team:demo',
						slug: 'missing-site-path',
						name: 'Missing Site Path',
						repository: {
							role: 'primary',
							provider: 'github',
							owner: 'demo',
							name: 'missing-site-path',
							gitUrl: 'https://github.com/demo/missing-site-path.git',
						},
						architecture: {
							topology: 'single_repository_site',
							rootPath: '.',
							contentRuntimeSource: 'r2_published_manifest',
							localContentMaterialization: 'none',
						},
					},
					{
						key: 'project:demo/legacy-metadata',
						team: 'team:demo',
						slug: 'legacy-metadata',
						name: 'Legacy Metadata',
						repository: {
							role: 'primary',
							provider: 'github',
							owner: 'demo',
							name: 'legacy-metadata',
							gitUrl: 'https://github.com/demo/legacy-metadata.git',
						},
						architecture: singleRepositorySiteArchitecture,
						metadata: {
							repositoryTopology: {
								contentRepository: { accessMode: 'treedx' },
							},
						},
					},
					{
						key: 'project:demo/implicit-local-checkout',
						team: 'team:demo',
						slug: 'implicit-local-checkout',
						name: 'Implicit Local Checkout',
						repository: {
							role: 'primary',
							provider: 'github',
							owner: 'demo',
							name: 'implicit-local-checkout',
							gitUrl: 'https://github.com/demo/implicit-local-checkout.git',
						},
						architecture: {
							topology: 'split_site_content',
							rootPath: '.',
							sitePath: 'docs',
							contentPath: 'docs/src/content',
							contentRuntimeSource: 'treedx_snapshot',
							localContentMaterialization: 'managed_clone',
						},
					},
				],
				hubRepositories: [],
				products: [],
				catalogArtifacts: [],
				capacityProviders: [],
				capacityGrants: [],
				workPolicies: [],
				agentPools: [],
			},
		}, diagnostics);

		expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining([
			'seed.missing_project_architecture',
			'seed.missing_field',
			'seed.legacy_project_topology_metadata',
			'seed.local_content_required_by_default',
		]));
	});

	it('accepts operation recipes and includes ordered DAG steps in the seed plan', () => {
		const diagnostics = [];
		const parsed = parseSeedManifest({
			name: 'demo',
			version: 1,
			defaultEnvironments: ['local'],
			environments: ['local'],
			resources: {
				teams: [{ key: 'team:demo', slug: 'demo' }],
				repositoryHosts: [],
				projects: [{
					key: 'project:demo/site',
					team: 'team:demo',
					slug: 'site',
					name: 'Demo Site',
					repository: {
						role: 'primary',
						provider: 'github',
						owner: 'demo',
						name: 'site',
						gitUrl: 'https://github.com/demo/site.git',
					},
					architecture: singleRepositorySiteArchitecture,
				}],
				hubRepositories: [],
				products: [],
				catalogArtifacts: [],
				capacityProviders: [],
				capacityGrants: [],
				workPolicies: [],
				agentPools: [],
			},
			operationRecipes: [{
				id: 'full-private-team-demo',
				title: 'Full private team demo',
				environments: ['local'],
				entrypoints: ['homepage-story'],
				steps: [
					{
						id: 'verify-project',
						title: 'Verify project',
						channel: 'ui',
						operation: 'navigate',
						dependsOn: ['homepage-story'],
						uses: ['project:demo/site'],
						target: '/app/projects',
						artifacts: [{ screenshot: 'projects.png' }],
					},
					{
						id: 'homepage-story',
						title: 'Show homepage',
						channel: 'ui',
						operation: 'navigate',
						target: '/',
						assertions: [{ text: 'Direction' }],
					},
				],
			}],
		}, diagnostics);

		expect(diagnostics).toHaveLength(0);
		const plan = createSeedPlan({
			manifest: parsed!,
			manifestPath: 'seeds/demo.yaml',
			environments: ['local'],
			mode: 'plan',
		});
		expect(plan.recipes).toHaveLength(1);
		expect(plan.recipes[0]?.selected).toBe(true);
		expect(plan.recipes[0]?.orderedSteps.map((step) => step.id)).toEqual(['homepage-story', 'verify-project']);
	});

	it('rejects invalid operation recipe DAGs and references', () => {
		const diagnostics = [];
		parseSeedManifest({
			name: 'demo',
			version: 1,
			environments: ['local'],
			resources: {
				teams: [{ key: 'team:demo', slug: 'demo' }],
				repositoryHosts: [],
				projects: [],
				hubRepositories: [],
				products: [],
				catalogArtifacts: [],
				capacityProviders: [],
				capacityGrants: [],
				workPolicies: [],
				agentPools: [],
			},
			operationRecipes: [{
				id: 'broken-demo',
				title: 'Broken demo',
				environments: ['local'],
				entrypoints: ['missing-entrypoint'],
				steps: [
					{
						id: 'cycle-a',
						title: 'Cycle A',
						channel: 'browser',
						operation: 'unknown.operation',
						dependsOn: ['cycle-b', 'missing-dependency'],
						uses: ['project:missing'],
					},
					{
						id: 'cycle-b',
						title: 'Cycle B',
						channel: 'ui',
						operation: 'navigate',
						dependsOn: ['cycle-a'],
					},
					{
						id: 'duplicate-step',
						title: 'Duplicate Step',
						channel: 'ui',
						operation: 'navigate',
					},
					{
						id: 'duplicate-step',
						title: 'Duplicate Step Again',
						channel: 'ui',
						operation: 'navigate',
					},
				],
			}],
		}, diagnostics);

		expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining([
			'seed.recipe_unknown_channel',
			'seed.recipe_unknown_operation',
			'seed.recipe_invalid_resource_reference',
			'seed.recipe_invalid_entrypoint',
			'seed.recipe_invalid_dependency',
			'seed.recipe_duplicate_step_id',
			'seed.recipe_cycle',
		]));
	});

	it('rejects invalid productized references and inline artifact content', () => {
		const diagnostics = [];
		parseSeedManifest({
			name: 'demo',
			version: 1,
			environments: ['local'],
			resources: {
				teams: [{ key: 'team:demo', slug: 'demo' }],
				repositoryHosts: [{
					key: 'repository-host:demo/github',
					team: 'team:missing',
					provider: 'github',
					name: 'demo',
					organizationOrOwner: 'demo',
					credentialRef: 'ghp_inline',
				}],
				projects: [],
				hubRepositories: [{
					key: 'hub-repository:demo/missing/content',
					project: 'project:missing/site',
					role: 'content',
					provider: 'github',
					owner: 'demo',
					name: 'site-content',
					gitUrl: 'https://github.com/demo/site-content.git',
				}],
				products: [],
				catalogArtifacts: [{
					key: 'catalog-artifact:demo/missing/1.0.0',
					product: 'product:missing',
					version: '1.0.0',
					kind: 'template',
					contentKey: 'catalog/demo/missing',
					content: 'inline bytes are not allowed',
				}],
				capacityProviders: [],
				capacityGrants: [],
				workPolicies: [],
				agentPools: [],
			},
		}, diagnostics);

		expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining([
			'seed.secret_field',
			'seed.invalid_reference',
			'seed.inline_artifact_content',
		]));
	});

	it('rejects secret-looking capacity provider registration values', () => {
		const diagnostics = [];
		parseSeedManifest({
			name: 'demo',
			version: 1,
			environments: ['local'],
			resources: {
				teams: [{ key: 'team:demo', slug: 'demo' }],
				repositoryHosts: [],
				projects: [],
				hubRepositories: [],
				products: [],
				catalogArtifacts: [],
				capacityProviders: [{
					key: 'capacity-provider:demo/local',
					team: 'team:demo',
					name: 'demo-local',
					provider: 'local',
					registration: {
						apiKey: {
							createIfMissing: true,
							token: 'tsp_inline-secret',
						},
					},
				}],
				capacityGrants: [],
				workPolicies: [],
				agentPools: [],
			},
		}, diagnostics);

		expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain('seed.secret_field');
	});

	it('rejects legacy provider task scopes in seed registrations', () => {
		const diagnostics = [];
		parseSeedManifest({
			name: 'demo',
			version: 1,
			environments: ['local'],
			resources: {
				teams: [{ key: 'team:demo', slug: 'demo' }],
				repositoryHosts: [],
				projects: [],
				hubRepositories: [],
				products: [],
				catalogArtifacts: [],
				capacityProviders: [{
					key: 'capacity-provider:demo/local',
					team: 'team:demo',
					name: 'demo-local',
					provider: 'local',
					registration: {
						apiKey: {
							createIfMissing: true,
							scopes: [['provider', 'tasks', 'claim'].join(':')],
						},
					},
				}],
				capacityGrants: [],
				workPolicies: [],
				agentPools: [],
			},
		}, diagnostics);

		expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain('seed.legacy_provider_task_scope');
	});

	it('rejects invalid native execution-provider limits', () => {
		const diagnostics = [];
		parseSeedManifest({
			name: 'demo',
			version: 1,
			environments: ['local'],
			resources: {
				teams: [{ key: 'team:demo', slug: 'demo' }],
				repositoryHosts: [],
				projects: [],
				hubRepositories: [],
				products: [],
				catalogArtifacts: [],
				capacityProviders: [{
					key: 'capacity-provider:demo/local',
					team: 'team:demo',
					name: 'demo-local',
					provider: 'local',
					executionProviders: [{
						name: 'Demo local Codex',
						kind: 'codex_subscription',
						nativeUnit: 'wall_minute',
						nativeLimits: [{
							scope: 'daily',
							nativeUnit: 'wall_minute',
							limitAmount: -1,
						}],
					}],
				}],
				capacityGrants: [],
				workPolicies: [],
				agentPools: [],
			},
		}, diagnostics);

		expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain('seed.invalid_number');
	});
});
