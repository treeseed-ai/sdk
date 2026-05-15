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
});
