import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';
import { resolveTreeseedEnvironmentRegistry } from '../../src/platform/environment.ts';
import { applyProjectLaunchHostBindingConfig } from '../../src/operations/services/template-host-bindings.ts';
import type {
	ProjectLaunchConfigWritePlanItem,
	ProjectLaunchResolvedHostBinding,
	ProjectLaunchSecretDeploymentPlanItem,
} from '../../src/template-launch-requirements.ts';

function createProjectRoot() {
	const root = mkdtempSync(join(tmpdir(), 'treeseed-sdk-host-bindings-'));
	mkdirSync(resolve(root, 'src'), { recursive: true });
	writeFileSync(resolve(root, 'treeseed.site.yaml'), `name: Test Project
slug: test-project
siteUrl: https://test.example.com
hosting:
  kind: self_hosted_project
surfaces:
  web:
    provider: cloudflare
`, 'utf8');
	writeFileSync(resolve(root, 'src/manifest.yaml'), 'id: test-project\n', 'utf8');
	return root;
}

function resolvedHost(overrides: Partial<ProjectLaunchResolvedHostBinding> = {}): ProjectLaunchResolvedHostBinding {
	return {
		requirementKey: 'sourceRepository',
		requirementKind: 'host',
		type: 'repository',
		provider: 'github',
		hostId: 'repo-host-1',
		managedHostKey: null,
		displayName: 'GitHub',
		environmentScopes: ['staging', 'prod'],
		configValues: {},
		environmentValues: {},
		secretRefs: {},
		provenance: {
			selectedBy: 'user',
			selectedAt: '2026-06-02T00:00:00.000Z',
		},
		host: {
			id: 'repo-host-1',
			name: 'GitHub',
			ownership: 'team_owned',
			status: 'active',
			organizationOrOwner: 'acme-labs',
		},
		...overrides,
	};
}

describe('template host binding config writer', () => {
	it('applies resolved host config writes into treeseed.site.yaml', () => {
		const root = createProjectRoot();
		const result = applyProjectLaunchHostBindingConfig({
			projectRoot: root,
			hostBindings: {
				sourceRepository: resolvedHost(),
				publicWeb: resolvedHost({
					requirementKey: 'publicWeb',
					type: 'web',
					provider: 'cloudflare',
					hostId: null,
					managedHostKey: 'treeseed-managed-web',
					displayName: 'TreeSeed Web Host',
					host: {
						id: 'treeseed-managed-web',
						name: 'TreeSeed Web Host',
						ownership: 'treeseed_managed',
						status: 'active',
					},
				}),
			},
			hostBindingPlans: {
				configWrites: [
					{
						target: 'treeseed.site.yaml',
						path: 'hosting.hostBindings.sourceRepository.provider',
						valueFrom: 'selectedHost.provider',
						requirementKey: 'sourceRepository',
						requirementKind: 'host',
						requirementType: 'repository',
						provider: 'github',
					},
					{
						target: 'treeseed.site.yaml',
						path: 'hosting.hostBindings.sourceRepository.owner',
						valueFrom: 'selectedHost.github.owner',
						requirementKey: 'sourceRepository',
						requirementKind: 'host',
						requirementType: 'repository',
						provider: 'github',
					},
					{
						target: 'treeseed.site.yaml',
						path: 'hosting.hostBindings.sourceRepository.repository',
						valueFrom: 'derived.repositoryName',
						requirementKey: 'sourceRepository',
						requirementKind: 'host',
						requirementType: 'repository',
						provider: 'github',
					},
					{
						target: 'treeseed.site.yaml',
						path: 'surfaces.web.environments.prod.domain',
						valueFrom: 'launchInput.domains.productionDomain',
						writeWhen: 'host-selected',
						requirementKey: 'publicWeb',
						requirementKind: 'host',
						requirementType: 'web',
						provider: 'cloudflare',
					},
				],
			},
			launchInput: {
				projectSlug: 'test-project',
				projectName: 'Test Project',
				domains: { productionDomain: 'test.example.com' },
			},
			derived: { repositoryName: 'test-project-site' },
		});

		const config = parseYaml(readFileSync(resolve(root, 'treeseed.site.yaml'), 'utf8')) as any;
		expect(config.hosting.hostBindings.sourceRepository).toMatchObject({
			provider: 'github',
			owner: 'acme-labs',
			repository: 'test-project-site',
		});
		expect(config.surfaces.web.environments.prod.domain).toBe('test.example.com');
		expect(result.configWrites.map((write) => write.path)).toContain('hosting.hostBindings.sourceRepository.owner');
		expect(JSON.stringify(result)).not.toContain('secret-token');
	});

	it('creates src/env.yaml with metadata-only environment entries', () => {
		const root = createProjectRoot();
		const secretDeployment: ProjectLaunchSecretDeploymentPlanItem = {
			requirementKey: 'transactionalEmail',
			requirementKind: 'host',
			env: 'TREESEED_SMTP_PASSWORD',
			sensitivity: 'secret',
			source: 'selected-host',
			targets: ['github-secret', 'local-runtime'],
			scopes: ['staging', 'prod'],
			sourceHostId: 'smtp-host-1',
		};
		const result = applyProjectLaunchHostBindingConfig({
			projectRoot: root,
			hostBindings: {
				transactionalEmail: resolvedHost({
					requirementKey: 'transactionalEmail',
					type: 'email',
					provider: 'smtp',
					hostId: 'smtp-host-1',
					displayName: 'Team SMTP',
				}),
			},
			hostBindingPlans: {
				secretDeployment: { items: [secretDeployment] },
			},
		});

		const overlay = parseYaml(readFileSync(resolve(root, 'src/env.yaml'), 'utf8')) as any;
		expect(overlay.entries.TREESEED_SMTP_PASSWORD).toMatchObject({
			sensitivity: 'secret',
			sourceRequirement: 'transactionalEmail',
			sourceHostType: 'email',
			sourceProvider: 'smtp',
		});
		expect(JSON.stringify(overlay)).not.toContain('secret-token');
		expect(result.environmentWrites[0]?.env).toBe('TREESEED_SMTP_PASSWORD');

		const registry = resolveTreeseedEnvironmentRegistry({
			deployConfig: {
				name: 'Test Project',
				slug: 'test-project',
				siteUrl: 'https://test.example.com',
				contactEmail: 'hello@example.com',
				cloudflare: { accountId: 'account-123' },
				__tenantRoot: root,
			} as any,
			plugins: [],
		});
		const entry = registry.entries.find((candidate) => candidate.id === 'TREESEED_SMTP_PASSWORD');
		expect(entry?.sourceRequirement).toBe('transactionalEmail');
		expect(entry?.sourceProvider).toBe('smtp');
	});

	it('applies Market control-plane resource config and metadata-only secret entries', () => {
		const root = createProjectRoot();
		const result = applyProjectLaunchHostBindingConfig({
			projectRoot: root,
			hostBindings: {
				apiDatabase: resolvedHost({
					requirementKey: 'apiDatabase',
					requirementKind: 'resource',
					type: 'database',
					provider: 'railway-postgres',
					hostId: 'railway-postgres-main',
					displayName: 'Market Postgres',
					configValues: { serviceName: 'treeseed-api-postgres' },
					secretRefs: { databaseUrl: 'railway.database-url-ref' },
				}),
				api: resolvedHost({
					requirementKey: 'api',
					requirementKind: 'resource',
					type: 'service',
					provider: 'railway',
					hostId: 'railway-api-service',
					displayName: 'API',
					configValues: { serviceName: 'treeseed-api' },
				}),
				operationsRunner: resolvedHost({
					requirementKey: 'operationsRunner',
					requirementKind: 'resource',
					type: 'service',
					provider: 'railway',
					hostId: 'railway-runner-service',
					displayName: 'Treeseed Operations Runner',
					configValues: { serviceName: 'treeseed-api-operations-runner-01' },
					environmentValues: { runnerId: 'runner-staging' },
					secretRefs: { runnerToken: 'runner-token-ref' },
				}),
			},
			hostBindingPlans: {
				configWrites: [
					{
						target: 'treeseed.site.yaml',
						path: 'services.apiDatabase.enabled',
						valueFrom: 'literal.true',
						requirementKey: 'apiDatabase',
						requirementKind: 'resource',
						requirementType: 'database',
						provider: 'railway-postgres',
					},
					{
						target: 'treeseed.site.yaml',
						path: 'services.apiDatabase.provider',
						valueFrom: 'literal.railway',
						requirementKey: 'apiDatabase',
						requirementKind: 'resource',
						requirementType: 'database',
						provider: 'railway-postgres',
					},
					{
						target: 'treeseed.site.yaml',
						path: 'services.apiDatabase.railway.serviceName',
						valueFrom: 'selectedResource.configValues.serviceName',
						requirementKey: 'apiDatabase',
						requirementKind: 'resource',
						requirementType: 'database',
						provider: 'railway-postgres',
					},
					{
						target: 'treeseed.site.yaml',
						path: 'services.api.railway.serviceName',
						valueFrom: 'selectedResource.configValues.serviceName',
						requirementKey: 'api',
						requirementKind: 'resource',
						requirementType: 'service',
						provider: 'railway',
					},
					{
						target: 'treeseed.site.yaml',
						path: 'services.operationsRunner.railway.serviceName',
						valueFrom: 'selectedResource.configValues.serviceName',
						requirementKey: 'operationsRunner',
						requirementKind: 'resource',
						requirementType: 'service',
						provider: 'railway',
					},
				],
				secretDeployment: {
					items: [
						{
							requirementKey: 'apiDatabase',
							requirementKind: 'resource',
							env: 'TREESEED_DATABASE_URL',
							sensitivity: 'secret',
							source: 'selectedResource.secretRefs.databaseUrl',
							targets: ['github-secret', 'railway-secret'],
							scopes: ['staging', 'prod'],
							sourceHostId: 'railway-postgres-main',
						},
						{
							requirementKey: 'operationsRunner',
							requirementKind: 'resource',
							env: 'TREESEED_PLATFORM_RUNNER_TOKEN',
							sensitivity: 'secret',
							source: 'selectedResource.secretRefs.runnerToken',
							targets: ['railway-secret'],
							scopes: ['staging', 'prod'],
							sourceHostId: 'railway-runner-service',
						},
					],
				},
			},
		});

		const config = parseYaml(readFileSync(resolve(root, 'treeseed.site.yaml'), 'utf8')) as any;
		const overlay = parseYaml(readFileSync(resolve(root, 'src/env.yaml'), 'utf8')) as any;
		expect(config.services.apiDatabase).toMatchObject({
			enabled: true,
			provider: 'railway',
			railway: { serviceName: 'treeseed-api-postgres' },
		});
		expect(config.services.api.railway.serviceName).toBe('treeseed-api');
		expect(config.services.operationsRunner.railway.serviceName).toBe('treeseed-api-operations-runner-01');
		expect(overlay.entries.TREESEED_DATABASE_URL).toMatchObject({
			sensitivity: 'secret',
			sourceRequirement: 'apiDatabase',
			sourceHostType: 'database',
			sourceProvider: 'railway-postgres',
		});
		expect(overlay.entries.TREESEED_PLATFORM_RUNNER_TOKEN).toMatchObject({
			sourceRequirement: 'operationsRunner',
			sourceHostType: 'service',
			sourceProvider: 'railway',
		});
		expect(result.configWrites.map((write) => write.path)).toContain('services.apiDatabase.railway.serviceName');
		expect(JSON.stringify({ config, overlay, result })).not.toContain('postgres://');
		expect(JSON.stringify({ config, overlay, result })).not.toContain('runner-secret');
	});

	it('rejects unsafe writes and unsupported value sources', () => {
		const root = createProjectRoot();
		const baseWrite: ProjectLaunchConfigWritePlanItem = {
			target: 'treeseed.site.yaml',
			path: 'hosting.hostBindings.sourceRepository.provider',
			valueFrom: 'selectedHost.provider',
			requirementKey: 'sourceRepository',
			requirementKind: 'host',
			requirementType: 'repository',
			provider: 'github',
		};
		expect(() => applyProjectLaunchHostBindingConfig({
			projectRoot: root,
			hostBindings: { sourceRepository: resolvedHost() },
			hostBindingPlans: {
				configWrites: [{ ...baseWrite, path: 'hosting.__proto__.polluted' }],
			},
		})).toThrow(/forbidden segment "__proto__"/u);

		expect(() => applyProjectLaunchHostBindingConfig({
			projectRoot: root,
			hostBindings: { sourceRepository: resolvedHost() },
			hostBindingPlans: {
				configWrites: [{ ...baseWrite, valueFrom: 'machineConfig.GITHUB_TOKEN' }],
			},
		})).toThrow(/Unsupported host binding config value source/u);
	});
});
