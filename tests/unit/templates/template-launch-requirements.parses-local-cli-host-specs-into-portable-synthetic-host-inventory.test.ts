import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';

import { resolve } from 'node:path';

import {
	normalizeProjectLaunchHostBindings,
	normalizeTemplateLaunchRequirements,
	parseProjectLaunchHostBindingSpecs,
	resolveProjectLaunchHostBindings,
} from '../../../src/entrypoints/templates/template-launch-requirements.ts';

import { validateTemplateProduct } from '../../../src/operations/services/support/template-registry.ts';
describe('template launch requirements', () => {
const fixtureCatalogPath = resolve(process.cwd(), 'src/treeseed/template-catalog/catalog.fixture.json');

const fixtureCatalogEnv = {
		TREESEED_TEMPLATE_CATALOG_URL: `file:${fixtureCatalogPath}`,
	};

it('parses local CLI host specs into portable synthetic host inventory', () => {
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
					configWrites: [],
				},
				{
					kind: 'host',
					key: 'publicWeb',
					type: 'web',
					required: true,
					compatibleProviders: ['cloudflare'],
					displayName: 'Public web',
					purpose: 'Deploy web.',
					defaultSelection: 'managed',
					configWrites: [],
				},
				{
					kind: 'host',
					key: 'transactionalEmail',
					type: 'email',
					required: false,
					compatibleProviders: ['smtp'],
					displayName: 'Email',
					purpose: 'Send mail.',
					defaultSelection: 'none',
					configWrites: [],
				},
			],
		});

		const parsed = parseProjectLaunchHostBindingSpecs({
			launchRequirements,
			specs: [
				'sourceRepository=github:acme',
				'publicWeb=cloudflare:managed',
				'transactionalEmail=none',
			],
		});

		expect(parsed.hostBindings.sourceRepository).toMatchObject({
			provider: 'github',
			hostId: 'local:sourcerepository-github-acme',
			configValues: { owner: 'acme', github: { owner: 'acme' } },
		});
		expect(parsed.hostBindings.publicWeb).toMatchObject({
			provider: 'cloudflare',
			managedHostKey: 'local-managed:publicweb-cloudflare-managed',
			mode: 'treeseed_managed',
		});
		expect(parsed.repositoryHosts[0]).toMatchObject({
			id: 'local:sourcerepository-github-acme',
			ownership: 'team_owned',
			organizationOrOwner: 'acme',
		});
		expect(parsed.managedHosts[0]).toMatchObject({
			id: 'local-managed:publicweb-cloudflare-managed',
			ownership: 'treeseed_managed',
			metadata: { local: true },
		});
		expect(parsed.omitted[0]).toMatchObject({ requirementKey: 'transactionalEmail', mode: 'none' });
	});

it('rejects invalid local CLI host specs early', () => {
		const launchRequirements = normalizeTemplateLaunchRequirements({
			hosts: [{
				kind: 'host',
				key: 'publicWeb',
				type: 'web',
				required: true,
				compatibleProviders: ['cloudflare'],
				displayName: 'Public web',
				purpose: 'Deploy web.',
				configWrites: [],
			}],
		});

		expect(() => parseProjectLaunchHostBindingSpecs({
			launchRequirements,
			specs: ['unknown=github:acme'],
		})).toThrow(/Unknown host binding requirement "unknown"/u);
		expect(() => parseProjectLaunchHostBindingSpecs({
			launchRequirements,
			specs: ['publicWeb=smtp:postmark'],
		})).toThrow(/requires provider cloudflare/u);
		expect(() => parseProjectLaunchHostBindingSpecs({
			launchRequirements,
			specs: ['publicWeb=none'],
		})).toThrow(/cannot be set to none/u);
	});

it('rejects unavailable hosts, configuration-required required hosts, and standard resource requirements', () => {
		const webRequirements = normalizeTemplateLaunchRequirements({
			hosts: [{
				kind: 'host',
				key: 'publicWeb',
				type: 'web',
				required: true,
				compatibleProviders: ['cloudflare'],
				displayName: 'Public web',
				purpose: 'Deploy the site.',
				defaultSelection: 'managed',
				configWrites: [],
			}],
		});
		expect(() => resolveProjectLaunchHostBindings({
			launchRequirements: webRequirements,
			hostBindings: {
				publicWeb: {
					requirementKey: 'publicWeb',
					requirementKind: 'host',
					type: 'web',
					provider: 'cloudflare',
					hostId: 'missing-web-host',
				},
			},
		})).toThrow(/not available or compatible/u);
		expect(() => resolveProjectLaunchHostBindings({
			launchRequirements: webRequirements,
			managedHosts: [{
				id: 'treeseed-managed-web',
				provider: 'cloudflare',
				ownership: 'treeseed_managed',
				name: 'TreeSeed Web Host',
				status: 'configuration_required',
				allowedEnvironments: ['staging', 'prod'],
				metadata: { hostType: 'web' },
			}],
		})).toThrow(/not active \(configuration_required\)/u);

		const resourceRequirements = normalizeTemplateLaunchRequirements({
			resources: [{
				kind: 'resource',
				key: 'runtimeService',
				type: 'service',
				required: true,
				compatibleProviders: ['railway'],
				displayName: 'Runtime service',
				purpose: 'Deploy runtime service.',
				configWrites: [],
			}],
		});
		expect(() => resolveProjectLaunchHostBindings({ launchRequirements: resourceRequirements })).toThrow(/resource requirements are not accepted/u);
	});

it('plans explicit Market control-plane resource bindings for non-standard launches', () => {
		const catalog = JSON.parse(readFileSync(fixtureCatalogPath, 'utf8')) as any;
		const marketTemplate = catalog.items.find((item: any) => item.id === 'market-control-plane');
		const launchRequirements = normalizeTemplateLaunchRequirements(marketTemplate.launchRequirements);
		const result = resolveProjectLaunchHostBindings({
			launchRequirements,
			standardProjectLaunch: false,
			hostBindings: {
				sourceRepository: {
					requirementKey: 'sourceRepository',
					requirementKind: 'host',
					type: 'repository',
					provider: 'github',
					hostId: 'repo-host-1',
				},
				publicWeb: {
					requirementKey: 'publicWeb',
					requirementKind: 'host',
					type: 'web',
					provider: 'cloudflare',
					managedHostKey: 'treeseed-managed-web',
					mode: 'treeseed_managed',
				},
				treeseedDatabase: {
					requirementKey: 'treeseedDatabase',
					requirementKind: 'resource',
					type: 'database',
					provider: 'railway-postgres',
					hostId: 'railway-postgres-main',
					displayName: 'Treeseed Postgres',
					configValues: { serviceName: 'treeseed-api-postgres' },
					secretRefs: { databaseUrl: 'railway.database-url' },
				},
				api: {
					requirementKey: 'api',
					requirementKind: 'resource',
					type: 'service',
					provider: 'railway',
					hostId: 'railway-api-service',
					displayName: 'API',
					configValues: { serviceName: 'treeseed-api' },
					secretRefs: { databaseUrl: 'railway.database-url' },
				},
				operationsRunner: {
					requirementKey: 'operationsRunner',
					requirementKind: 'resource',
					type: 'service',
					provider: 'railway',
					hostId: 'railway-runner-service',
					displayName: 'Treeseed Operations Runner',
					configValues: { serviceName: 'treeseed-api-operations-runner-01' },
					environmentValues: { runnerId: 'runner-staging' },
					secretRefs: { databaseUrl: 'railway.database-url', runnerToken: 'treeseed.runner-token' },
				},
			},
			repositoryHosts: [{
				id: 'repo-host-1',
				type: 'repository',
				provider: 'github',
				ownership: 'team_owned',
				name: 'GitHub',
				organizationOrOwner: 'treeseed-ai',
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

		expect(result.hostBindings.treeseedDatabase).toMatchObject({
			requirementKind: 'resource',
			type: 'database',
			provider: 'railway-postgres',
		});
		expect(result.configWritePlan.map((write) => write.path)).toEqual(expect.arrayContaining([
			'services.treeseedDatabase.provider',
			'services.api.railway.serviceName',
			'services.operationsRunner.railway.serviceName',
		]));
		expect(result.secretDeploymentPlan.items.map((item) => item.env)).toEqual(expect.arrayContaining([
			'TREESEED_DATABASE_URL',
			'TREESEED_PLATFORM_RUNNER_TOKEN',
			'TREESEED_PLATFORM_RUNNER_ID',
		]));
		expect(JSON.stringify(result)).not.toContain('postgres://');
		expect(JSON.stringify(result)).not.toContain('runner-secret');

		expect(() => resolveProjectLaunchHostBindings({
			launchRequirements: normalizeTemplateLaunchRequirements({
				resources: [{
					kind: 'resource',
					key: 'treeseedDatabase',
					type: 'database',
					required: true,
					compatibleProviders: ['railway-postgres'],
					displayName: 'Treeseed database',
					purpose: 'Store Market state.',
					configWrites: [],
				}],
			}),
			standardProjectLaunch: false,
			hostBindings: {
				treeseedDatabase: {
					requirementKey: 'treeseedDatabase',
					requirementKind: 'resource',
					type: 'service',
					provider: 'railway',
				},
			},
		})).toThrow(/requires resource type "database"/u);
	});
});
