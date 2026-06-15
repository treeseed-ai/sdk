import { describe, expect, it } from 'vitest';
import { createSeedPlan } from '../../src/seeds/planner.js';
import { parseSeedManifest } from '../../src/seeds/schema.js';
import type { SeedManifest } from '../../src/seeds/types.js';

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
						scopes: ['provider:register', 'provider:heartbeat', 'provider:portfolio:read', 'provider:tasks:claim', 'provider:tasks:update', 'provider:usage:report', 'provider:reports:write', 'provider:capabilities:write'],
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
				scopes: ['provider:register', 'provider:heartbeat', 'provider:portfolio:read', 'provider:tasks:claim', 'provider:tasks:update', 'provider:usage:report', 'provider:reports:write', 'provider:capabilities:write'],
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
