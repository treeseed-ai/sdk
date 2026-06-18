import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
	recordTemplateHostBindingState,
	scaffoldTemplateProject,
	syncTemplateProject,
	validateTemplateProduct,
} from '../../src/operations/services/template-registry.ts';
import {
	normalizeProjectLaunchHostBindings,
	resolveProjectLaunchHostBindings,
} from '../../src/template-launch-requirements.ts';
import { applyProjectLaunchHostBindingConfig } from '../../src/operations/services/template-host-bindings.ts';

function git(cwd: string, args: string[]) {
	const result = spawnSync('git', args, {
		cwd,
		stdio: 'pipe',
		encoding: 'utf8',
	});
	if (result.status !== 0) {
		throw new Error(result.stderr?.trim() || result.stdout?.trim() || `git ${args.join(' ')} failed`);
	}
}

describe('template registry fulfillment', () => {
	const firstPartyStarterIds = [
		'research',
		'engineering',
		'information-hub',
	] as const;
	const firstPartyStarterRepoUrls: Record<(typeof firstPartyStarterIds)[number], string> = {
		'research': 'https://github.com/treeseed-templates/research.git',
		'engineering': 'https://github.com/treeseed-templates/engineering.git',
		'information-hub': 'https://github.com/treeseed-templates/information-hub.git',
	};
	const fixtureCatalogPath = resolve(process.cwd(), 'src/treeseed/template-catalog/catalog.fixture.json');
	const fixtureCatalogEnv = {
		TREESEED_TEMPLATE_CATALOG_URL: `file:${fixtureCatalogPath}`,
	};

	it('loads first-party starter definitions from the local submodule-ready starter source', async () => {
		for (const id of firstPartyStarterIds) {
			const definition = await validateTemplateProduct({ id }, {
				cwd: process.cwd(),
				env: fixtureCatalogEnv,
			});

			expect(definition.product.id).toBe(id);
			expect(definition.product.fulfillment.source.kind).toBe('git');
			expect(definition.product.fulfillment.source.directory).toBe('.');
			expect(definition.product.fulfillment.source.repoUrl).toBe(firstPartyStarterRepoUrls[id]);
			expect(definition.manifest.id).toBe(id);
			expect(existsSync(resolve(definition.templateRoot, 'src/manifest.yaml'))).toBe(true);
		}
	});

	it('rejects legacy starter-prefixed template ids', async () => {
		const legacyId = ['starter', 'research'].join('-');
		await expect(validateTemplateProduct({ id: legacyId }, {
			cwd: process.cwd(),
			env: fixtureCatalogEnv,
		})).rejects.toThrow(new RegExp(`Unable to resolve remote template product "${legacyId}"`, 'u'));
	});

	it('scaffolds each first-party starter with agent specs, tests, and expected content roots', async () => {
		for (const id of firstPartyStarterIds) {
			const root = mkdtempSync(join(tmpdir(), `treeseed-${id}-`));
			const targetRoot = resolve(root, 'generated');
			const product = await scaffoldTemplateProject(id, targetRoot, {
				target: 'generated',
				name: `Generated ${id}`,
				siteUrl: 'https://example.com',
				contactEmail: 'hello@example.com',
			}, {
				cwd: root,
				env: fixtureCatalogEnv,
			});

			expect(product.id).toBe(id);
			expect(existsSync(resolve(targetRoot, 'src/manifest.yaml'))).toBe(true);
			expect(existsSync(resolve(targetRoot, 'treeseed.site.yaml'))).toBe(true);
			expect(existsSync(resolve(targetRoot, 'src/content/agents'))).toBe(true);
			expect(existsSync(resolve(targetRoot, 'src/content/agent-tests'))).toBe(true);
			expect(existsSync(resolve(targetRoot, 'src/content/books'))).toBe(true);
			expect(existsSync(resolve(targetRoot, 'src/content/knowledge'))).toBe(true);
			expect(readFileSync(resolve(targetRoot, '.treeseed/template-state.json'), 'utf8')).toContain(id);
		}
	});

	it('applies launch host binding config to a scaffolded first-party starter', async () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-starter-host-bindings-'));
		const targetRoot = resolve(root, 'generated');
		const product = await scaffoldTemplateProject('research', targetRoot, {
			target: 'generated',
			name: 'Generated Research',
			siteUrl: 'https://research.example.com',
			contactEmail: 'hello@example.com',
		}, {
			cwd: root,
			env: fixtureCatalogEnv,
		});
		const launchRequirements = product.launchRequirements;
		const resolved = resolveProjectLaunchHostBindings({
			launchRequirements,
			hostBindings: normalizeProjectLaunchHostBindings({}),
			repositoryHosts: [{
				id: 'platform:github:hosted-hubs',
				type: 'repository',
				provider: 'github',
				ownership: 'treeseed_managed',
				name: 'TreeSeed Hosted Hubs',
				organizationOrOwner: 'treeseed-sites',
				status: 'active',
			}],
			managedHosts: [{
				id: 'treeseed-managed-web',
				provider: 'cloudflare',
				ownership: 'treeseed_managed',
				name: 'TreeSeed Web Host',
				status: 'active',
				allowedEnvironments: ['staging', 'prod'],
				metadata: { hostType: 'web', managed: true },
			}],
			selectedAt: '2026-06-02T00:00:00.000Z',
		});

		const result = applyProjectLaunchHostBindingConfig({
			projectRoot: targetRoot,
			hostBindings: resolved.hostBindings,
			hostBindingPlans: {
				configWrites: resolved.configWritePlan,
				secretDeployment: resolved.secretDeploymentPlan,
			},
			launchInput: {
				projectSlug: 'generated-research',
				projectName: 'Generated Research',
				domains: {
					productionDomain: 'research.example.com',
					stagingDomain: 'staging.research.example.com',
				},
			},
			derived: {
				projectSlug: 'generated-research',
				repositoryName: 'generated-research-site',
			},
		});

		const config = parseYaml(readFileSync(resolve(targetRoot, 'treeseed.site.yaml'), 'utf8')) as any;
		expect(config.hosting.hostBindings.sourceRepository).toMatchObject({
			provider: 'github',
			owner: 'treeseed-sites',
			repository: 'generated-research-site',
		});
		expect(config.hosting.hostBindings.publicWeb.provider).toBe('cloudflare');
		expect(config.surfaces.web.environments.prod.domain).toBe('research.example.com');
		expect(config.surfaces.web.environments.staging.domain).toBe('staging.research.example.com');
		expect(result.configWrites.length).toBeGreaterThan(0);
		expect(JSON.stringify(config)).not.toContain('secret-token');
	});

	it('preserves host-bound config overlays during template sync checks', async () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-starter-host-sync-'));
		const targetRoot = resolve(root, 'generated');
		const product = await scaffoldTemplateProject('research', targetRoot, {
			target: 'generated',
			name: 'Generated Research',
			siteUrl: 'https://research.example.com',
			contactEmail: 'hello@example.com',
		}, {
			cwd: root,
			env: fixtureCatalogEnv,
		});
		const resolved = resolveProjectLaunchHostBindings({
			launchRequirements: product.launchRequirements,
			hostBindings: normalizeProjectLaunchHostBindings({}),
			repositoryHosts: [{
				id: 'platform:github:hosted-hubs',
				type: 'repository',
				provider: 'github',
				ownership: 'treeseed_managed',
				name: 'TreeSeed Hosted Hubs',
				organizationOrOwner: 'treeseed-sites',
				status: 'active',
			}],
			managedHosts: [{
				id: 'treeseed-managed-web',
				provider: 'cloudflare',
				ownership: 'treeseed_managed',
				name: 'TreeSeed Web Host',
				status: 'active',
				allowedEnvironments: ['staging', 'prod'],
				metadata: { hostType: 'web', managed: true },
			}],
			selectedAt: '2026-06-02T00:00:00.000Z',
		});
		const hostBindingPlans = {
			configWrites: resolved.configWritePlan,
			secretDeployment: {
				items: [
					...resolved.secretDeploymentPlan.items,
					{
						requirementKey: 'sourceRepository',
						requirementKind: 'host' as const,
						env: 'TREESEED_GITHUB_TOKEN',
						sensitivity: 'secret',
						source: 'selected-host',
						targets: ['github-secret'],
						scopes: ['staging', 'prod'] as const,
						sourceHostId: 'platform:github:hosted-hubs',
					},
				],
			},
		};
		const hostBindingConfig = applyProjectLaunchHostBindingConfig({
			projectRoot: targetRoot,
			hostBindings: resolved.hostBindings,
			hostBindingPlans,
			launchInput: {
				projectSlug: 'generated-research',
				projectName: 'Generated Research',
				domains: {
					productionDomain: 'research.example.com',
					stagingDomain: 'staging.research.example.com',
				},
			},
			derived: {
				projectSlug: 'generated-research',
				repositoryName: 'generated-research-site',
			},
		});
		recordTemplateHostBindingState(targetRoot, {
			hostBindings: resolved.hostBindings,
			hostBindingPlans,
			hostBindingConfig,
		});

		await expect(syncTemplateProject(targetRoot, {
			check: true,
			cwd: root,
			env: fixtureCatalogEnv,
		})).resolves.toEqual([]);
		expect(parseYaml(readFileSync(resolve(targetRoot, 'src/env.yaml'), 'utf8'))).toMatchObject({
			entries: {
				TREESEED_GITHUB_TOKEN: {
					sourceRequirement: 'sourceRepository',
					sourceProvider: 'github',
				},
			},
		});
	});

	it('can scaffold a template from a remote git fulfillment source when no packaged artifact exists', async () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-template-registry-'));
		const repoRoot = resolve(root, 'template-repo');
		const targetRoot = resolve(root, 'generated-site');
		mkdirSync(resolve(repoRoot, 'templates', 'starter-remote', 'template', 'src'), { recursive: true });
		writeFileSync(resolve(repoRoot, 'templates', 'starter-remote', 'template.config.json'), JSON.stringify({
			id: 'starter-remote',
			displayName: 'Starter Remote',
			description: 'Remote starter',
			category: 'starter',
			tags: [],
			templateVersion: '1.0.0',
			templateApiVersion: 1,
			minCliVersion: '0.1.0',
			variables: [
				{ name: 'Name', token: '__SITE_NAME__', deriveFrom: 'name', required: true },
			],
			testing: {},
		}, null, 2), 'utf8');
		writeFileSync(resolve(repoRoot, 'templates', 'starter-remote', 'template', 'README.md'), '# __SITE_NAME__\n', 'utf8');
		git(repoRoot, ['init', '-b', 'main']);
		git(repoRoot, ['config', 'user.name', 'Treeseed Test']);
		git(repoRoot, ['config', 'user.email', 'treeseed@example.com']);
		git(repoRoot, ['add', '-A']);
		git(repoRoot, ['commit', '-m', 'init template']);

		const catalogPath = resolve(root, 'catalog.json');
		writeFileSync(catalogPath, JSON.stringify({
			items: [
				{
					id: 'starter-remote',
					displayName: 'Starter Remote',
					description: 'Remote starter',
					summary: 'Remote starter',
					status: 'live',
					category: 'starter',
					publisher: { id: 'treeseed', name: 'TreeSeed' },
					templateVersion: '1.0.0',
					templateApiVersion: 1,
					minCliVersion: '0.1.0',
					fulfillment: {
						mode: 'git',
						source: {
							repoUrl: repoRoot,
							directory: 'templates/starter-remote',
							ref: 'main',
						},
						hooksPolicy: 'builtin_only',
						supportsReconcile: true,
					},
				},
			],
		}), 'utf8');

		const definition = await scaffoldTemplateProject('starter-remote', targetRoot, {
			target: 'generated-site',
			name: 'Remote Site',
		}, {
			cwd: root,
			env: {
				TREESEED_TEMPLATE_CATALOG_URL: `file:${catalogPath}`,
			},
		});

		expect(definition.id).toBe('starter-remote');
		expect(readFileSync(resolve(targetRoot, 'README.md'), 'utf8')).toContain('Remote Site');
		expect(readFileSync(resolve(targetRoot, '.treeseed', 'template-state.json'), 'utf8')).toContain('starter-remote');
	});
});
