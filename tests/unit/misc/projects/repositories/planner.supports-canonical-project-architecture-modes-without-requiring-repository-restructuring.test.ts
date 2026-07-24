import { describe, expect, it } from 'vitest';

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

import { join } from 'node:path';

import { tmpdir } from 'node:os';

import { stringify } from 'yaml';

import { loadSeedManifest } from '../../../../../src/seeds/loader.js';

import { createSeedPlan } from '../../../../../src/seeds/planner.js';

import { parseSeedManifest } from '../../../../../src/seeds/schema.js';

import type { SeedManifest } from '../../../../../src/seeds/types.js';

const PROJECT_KEYS = [
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

function canonicalSeed(): SeedManifest {
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
	},
	operationRecipes: [],
};
describe('seed planner current-state diffing', () => {
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
});
