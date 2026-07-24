import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';

import { resolve } from 'node:path';

import {
	normalizeProjectLaunchHostBindings,
	normalizeTemplateLaunchRequirements,
	parseProjectLaunchHostBindingSpecs,
	resolveProjectLaunchHostBindings,
} from '../../../src/template-launch-requirements.ts';

import { validateTemplateProduct } from '../../../src/operations/services/template-registry.ts';
describe('template launch requirements', () => {
const fixtureCatalogPath = resolve(process.cwd(), 'src/treeseed/template-catalog/catalog.fixture.json');

const fixtureCatalogEnv = {
		TREESEED_TEMPLATE_CATALOG_URL: `file:${fixtureCatalogPath}`,
	};

it('validates launch requirements on the active first-party starter manifests', async () => {
		for (const id of ['research', 'engineering']) {
			const definition = await validateTemplateProduct({ id }, {
				cwd: process.cwd(),
				env: fixtureCatalogEnv,
			});
			expect(definition.manifest.launchRequirements?.hosts?.map((host) => host.key)).toEqual([
				'sourceRepository',
				'publicWeb',
				'transactionalEmail',
			]);
		}
	});

it('validates the draft Market control-plane catalog requirements without making it a standard starter', () => {
		const catalog = JSON.parse(readFileSync(fixtureCatalogPath, 'utf8')) as any;
		const marketTemplate = catalog.items.find((item: any) => item.id === 'market-control-plane');
		const launchRequirements = normalizeTemplateLaunchRequirements(marketTemplate.launchRequirements);
		expect(marketTemplate.status).toBe('draft');
		expect(launchRequirements?.hosts?.map((host) => host.key)).toEqual(['sourceRepository', 'publicWeb']);
		expect(launchRequirements?.resources?.map((resource) => resource.key)).toEqual([
			'treeseedDatabase',
			'api',
			'operationsRunner',
		]);
		expect(JSON.stringify(launchRequirements)).not.toContain('postgres://');
		expect(JSON.stringify(launchRequirements)).not.toContain('runner-secret');
	});

it('rejects unknown requirement types and unsafe config writes', () => {
		expect(() => normalizeTemplateLaunchRequirements({
			hosts: [{
				kind: 'host',
				key: 'runtimeHost',
				type: 'capacity-provider',
				required: true,
				displayName: 'Runtime host',
				purpose: 'Deploy runtime capacity.',
				configWrites: [],
			}],
		})).toThrow(/unsupported value "capacity-provider"/u);

		expect(() => normalizeTemplateLaunchRequirements({
			hosts: [{
				kind: 'host',
				key: 'publicWeb',
				type: 'web',
				required: true,
				displayName: 'Public web',
				purpose: 'Deploy web.',
				configWrites: [{
					target: 'treeseed.site.yaml',
					path: 'hosting.__proto__.polluted',
					valueFrom: 'selectedHost.provider',
				}],
			}],
		})).toThrow(/forbidden segment "__proto__"/u);

		expect(() => normalizeTemplateLaunchRequirements({
			resources: [{
				kind: 'resource',
				key: 'treeseedDatabase',
				type: 'database',
				required: true,
				compatibleProviders: ['railway-postgres'],
				displayName: 'Treeseed database',
				purpose: 'Store Market state.',
				configWrites: [{
					target: 'treeseed.site.yaml',
					path: 'services.constructor.polluted',
					valueFrom: 'selectedResource.provider',
				}],
			}],
		})).toThrow(/forbidden segment "constructor"/u);
	});

it('normalizes legacy launch fields into host bindings', () => {
		const bindings = normalizeProjectLaunchHostBindings({
			repositoryHostId: 'repo-host-1',
			cloudflareHostMode: 'team_owned',
			cloudflareHostId: 'web-host-1',
			emailHostMode: 'treeseed_managed',
		});
		expect(bindings.sourceRepository).toMatchObject({
			requirementKind: 'host',
			type: 'repository',
			provider: 'github',
			hostId: 'repo-host-1',
		});
		expect(bindings.publicWeb).toMatchObject({
			type: 'web',
			provider: 'cloudflare',
			hostId: 'web-host-1',
			mode: 'team_owned',
		});
		expect(bindings.transactionalEmail).toMatchObject({
			type: 'email',
			provider: 'smtp',
			managedHostKey: 'treeseed-managed-email',
		});
	});

it('preserves explicit host bindings over compatibility-derived bindings', () => {
		const bindings = normalizeProjectLaunchHostBindings({
			repositoryHostId: 'legacy-repo-host',
			hostBindings: {
				sourceRepository: {
					requirementKind: 'host',
					type: 'repository',
					provider: 'github',
					hostId: 'explicit-repo-host',
				},
			},
		});
		expect(bindings.sourceRepository.hostId).toBe('explicit-repo-host');
	});

it('resolves starter host defaults to repository, managed web, and managed email bindings', () => {
		const launchRequirements = normalizeTemplateLaunchRequirements({
			hosts: [
				{
					kind: 'host',
					key: 'sourceRepository',
					type: 'repository',
					required: true,
					compatibleProviders: ['github'],
					displayName: 'Source repository',
					purpose: 'Create the source repository.',
					defaultSelection: 'team-default',
					configWrites: [{ target: 'treeseed.site.yaml', path: 'hosting.hostBindings.sourceRepository.provider', valueFrom: 'selectedHost.provider' }],
				},
				{
					kind: 'host',
					key: 'publicWeb',
					type: 'web',
					required: true,
					compatibleProviders: ['cloudflare'],
					displayName: 'Public web',
					purpose: 'Deploy the site.',
					defaultSelection: 'managed',
					configWrites: [{ target: 'treeseed.site.yaml', path: 'surfaces.web.provider', valueFrom: 'selectedHost.provider' }],
				},
				{
					kind: 'host',
					key: 'transactionalEmail',
					type: 'email',
					required: false,
					compatibleProviders: ['smtp'],
					displayName: 'Transactional email',
					purpose: 'Send notifications.',
					defaultSelection: 'managed',
					configWrites: [{ target: 'treeseed.site.yaml', path: 'hosting.hostBindings.transactionalEmail.provider', valueFrom: 'selectedHost.provider' }],
				},
			],
		});
		const result = resolveProjectLaunchHostBindings({
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
			managedHosts: [
				{
					id: 'treeseed-managed-web',
					provider: 'cloudflare',
					ownership: 'treeseed_managed',
					name: 'TreeSeed Web Host',
					status: 'active',
					allowedEnvironments: ['staging', 'prod'],
					metadata: { hostType: 'web', managed: true },
				},
				{
					id: 'treeseed-managed-email',
					provider: 'smtp',
					ownership: 'treeseed_managed',
					name: 'TreeSeed Email Host',
					status: 'active',
					allowedEnvironments: ['staging', 'prod'],
					metadata: { hostType: 'email', managed: true },
				},
			],
			selectedAt: '2026-06-02T00:00:00.000Z',
		});

		expect(result.compatibility).toMatchObject({
			repositoryHostId: 'platform:github:hosted-hubs',
			cloudflareHostMode: 'treeseed_managed',
			emailHostMode: 'treeseed_managed',
		});
		expect(result.hostBindings.publicWeb.provenance.selectedBy).toBe('managed-default');
		expect(result.configWritePlan.map((item) => item.requirementKey)).toEqual([
			'sourceRepository',
			'publicWeb',
			'transactionalEmail',
		]);
		expect(JSON.stringify(result)).not.toContain('secret-token');
	});

it('rejects missing required hosts and incompatible explicit bindings', () => {
		const launchRequirements = normalizeTemplateLaunchRequirements({
			hosts: [{
				kind: 'host',
				key: 'publicWeb',
				type: 'web',
				required: true,
				compatibleProviders: ['cloudflare'],
				displayName: 'Public web',
				purpose: 'Deploy the site.',
				defaultSelection: 'none',
				configWrites: [],
			}],
		});

		expect(() => resolveProjectLaunchHostBindings({ launchRequirements })).toThrow(/publicWeb is required/u);
		expect(() => resolveProjectLaunchHostBindings({
			launchRequirements,
			hostBindings: {
				publicWeb: {
					requirementKey: 'publicWeb',
					requirementKind: 'host',
					type: 'email',
					provider: 'smtp',
				},
			},
		})).toThrow(/requires host type "web"/u);
	});

it('preserves explicit host binding selections over defaults', () => {
		const launchRequirements = normalizeTemplateLaunchRequirements({
			hosts: [{
				kind: 'host',
				key: 'sourceRepository',
				type: 'repository',
				required: true,
				compatibleProviders: ['github'],
				displayName: 'Source repository',
				purpose: 'Create the source repository.',
				defaultSelection: 'team-default',
				configWrites: [],
			}],
		});
		const result = resolveProjectLaunchHostBindings({
			launchRequirements,
			hostBindings: {
				sourceRepository: {
					requirementKey: 'sourceRepository',
					requirementKind: 'host',
					type: 'repository',
					provider: 'github',
					hostId: 'repo-explicit',
					selectedBy: 'user',
				},
			},
			defaultHosts: { repository: 'repo-default' },
			repositoryHosts: [
				{ id: 'repo-default', type: 'repository', provider: 'github', ownership: 'team_owned', name: 'Default GitHub', status: 'active' },
				{ id: 'repo-explicit', type: 'repository', provider: 'github', ownership: 'team_owned', name: 'Explicit GitHub', status: 'active' },
			],
		});

		expect(result.hostBindings.sourceRepository.hostId).toBe('repo-explicit');
		expect(result.hostBindings.sourceRepository.provenance.selectedBy).toBe('user');
	});
});
