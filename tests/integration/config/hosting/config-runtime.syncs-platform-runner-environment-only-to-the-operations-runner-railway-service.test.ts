import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';

import { tmpdir } from 'node:os';

import { dirname, join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	collectConfigContext,
	createDefaultMachineConfig,
	ensureRailwayIgnoreEntries,
	ensureSecretSessionForConfig,
	getMachineConfigPaths,
	inspectKeyAgentStatus,
	loadMachineConfig,
	applyEnvironmentToProcess,
	collectEnvironmentContext,
	collectPrintEnvReport,
	resolveLaunchEnvironment,
	resolveMachineEnvironmentValues,
	applyConfigValues,
	setMachineEnvironmentValue,
	syncRailwayEnvironment,
	MACHINE_KEY_PASSPHRASE_ENV,
	unlockSecretSessionFromEnv,
	validateCommandEnvironment,
	warnDeprecatedLocalEnvFiles,
	writeMachineConfig,
} from '../../../../src/operations/services/configuration/config-runtime.ts';

const railwayRegistryFixtureEntries = `
  TREESEED_GITHUB_TOKEN:
    label: GitHub token
    group: github
    description: GitHub token.
    howToGet: Set a GitHub token.
    sensitivity: secret
    targets:
      - github-secret
    scopes:
      - staging
      - prod
    storage: shared
    requirement: conditional
    purposes:
      - deploy
      - config
    validation:
      kind: nonempty
      minLength: 8
    sourcePriority:
      - machine-config
      - process-env
  TREESEED_RAILWAY_API_TOKEN:
    label: Railway API token
    group: auth
    description: Railway API token.
    howToGet: Set a Railway token.
    sensitivity: secret
    targets:
      - github-secret
    scopes:
      - staging
      - prod
    storage: shared
    requirement: conditional
    purposes:
      - deploy
      - config
    validation:
      kind: nonempty
      minLength: 8
    sourcePriority:
      - machine-config
      - process-env
    relevanceRef: railwayManagedEnabled
    requiredWhenRef: railwayManagedEnabled
  TREESEED_RAILWAY_PROJECT_ID:
    label: Railway project ID
    group: hosting
    visibility: system
    description: Railway project identifier.
    howToGet: Set the Railway project ID.
    sensitivity: plain
    targets:
      - github-variable
    scopes:
      - staging
      - prod
    storage: scoped
    requirement: optional
    purposes:
      - deploy
      - config
    validation:
      kind: nonempty
    sourcePriority:
      - machine-config
      - process-env
  TREESEED_RAILWAY_ENVIRONMENT_ID:
    label: Railway environment ID
    group: hosting
    visibility: system
    description: Railway environment identifier.
    howToGet: Set the Railway environment ID.
    sensitivity: plain
    targets:
      - github-variable
    scopes:
      - staging
      - prod
    storage: scoped
    requirement: optional
    purposes:
      - deploy
      - config
    validation:
      kind: nonempty
    sourcePriority:
      - machine-config
      - process-env
`;

const codexRegistryFixtureEntries = `
  TREESEED_CODEX_AUTH_JSON_B64:
    label: Codex auth JSON bootstrap secret
    group: auth
    description: Base64-encoded Codex login auth.json.
    howToGet: Store a base64-encoded Codex auth.json.
    sensitivity: secret
    targets:
      - railway-secret
      - github-secret
    scopes:
      - staging
      - prod
    storage: scoped
    requirement: optional
    purposes:
      - agent-execution
      - bootstrap
      - config
    validation:
      kind: nonempty
    relevanceRef: codexExecutionSelected
  TREESEED_CODEX_APPROVAL_POLICY:
    label: Codex approval policy
    group: auth
    description: Codex approval policy.
    howToGet: Set the approval policy.
    sensitivity: plain
    targets:
      - railway-var
      - github-variable
    scopes:
      - staging
      - prod
    storage: scoped
    requirement: optional
    purposes:
      - agent-execution
      - config
    validation:
      kind: enum
      values:
        - never
        - on_request
        - always
    relevanceRef: codexExecutionSelected
  TREESEED_CODEX_AUTH_OVERWRITE:
    label: Overwrite Codex auth file
    group: auth
    description: Codex auth overwrite flag.
    howToGet: Set only during auth rotation.
    sensitivity: plain
    targets:
      - railway-var
      - local-runtime
    scopes:
      - staging
      - prod
    storage: scoped
    requirement: optional
    purposes:
      - agent-execution
      - bootstrap
      - config
    validation:
      kind: boolean
    relevanceRef: codexExecutionSelected
`;

function createTenantFixture(extraEnvEntries = '') {
	const tenantRoot = mkdtempSync(join(tmpdir(), 'treeseed-config-runtime-'));
	mkdirSync(resolve(tenantRoot, 'src'), { recursive: true });
	writeFileSync(resolve(tenantRoot, 'src', 'manifest.yaml'), 'id: test-site\nsiteConfigPath: ./src/config.yaml\ncontent:\n  pages: ./src/content/pages\n');
	writeFileSync(resolve(tenantRoot, 'treeseed.site.yaml'), `name: Test Site
slug: test-site
siteUrl: https://market.example.com
contactEmail: hello@example.com
cloudflare:
  accountId: account-123
services:
  api:
    provider: railway
    enabled: true
`);
	writeFileSync(resolve(tenantRoot, 'src', 'env.yaml'), `entries:
  SHARED_VALUE:
    label: Shared value
    group: auth
    description: Shared test value.
    howToGet: Set any value.
    sensitivity: plain
    targets:
      - local-runtime
    scopes:
      - local
      - staging
      - prod
    storage: shared
    requirement: optional
    purposes:
      - config
    validation:
      kind: nonempty
${extraEnvEntries}
`);
	return tenantRoot;
}

function unlockSecrets(tenantRoot: string) {
	vi.stubEnv(MACHINE_KEY_PASSPHRASE_ENV, 'test-passphrase');
	unlockSecretSessionFromEnv(tenantRoot);
}
describe('config runtime shared environment values', () => {
beforeEach(() => {
		vi.stubEnv('HOME', mkdtempSync(join(tmpdir(), 'treeseed-config-home-')));
	});

afterEach(() => {
		vi.unstubAllEnvs();
	});

it('syncs platform runner environment only to the Treeseed operations runner Railway service', async () => {
			const tenantRoot = createTenantFixture(railwayRegistryFixtureEntries);
		writeFileSync(resolve(tenantRoot, 'treeseed.site.yaml'), `name: Test Site
slug: test-site
siteUrl: https://market.example.com
contactEmail: hello@example.com
cloudflare:
  accountId: account-123
services:
  api:
    provider: railway
    enabled: true
    rootDir: packages/api
    railway:
      projectName: treeseed-api
      serviceName: treeseed-api
      rootDir: packages/api
  operationsRunner:
    provider: railway
    enabled: true
    rootDir: packages/api
    railway:
      projectName: treeseed-api
      serviceName: treeseed-ops-01
      rootDir: packages/api
      buildCommand: npm run build
      startCommand: npm run start:runner
      volumeMountPath: /data
      runnerPool:
        bootstrapCount: 1
        maxRunners: 4
        volumeMountPath: /data
`);
		writeMachineConfig(tenantRoot, createDefaultMachineConfig({
			tenantRoot,
			deployConfig: {
				name: 'Test Site',
				slug: 'test-site',
				siteUrl: 'https://market.example.com',
				contactEmail: 'hello@example.com',
				cloudflare: { accountId: 'account-123' },
				services: {
					api: { provider: 'railway', enabled: true },
					operationsRunner: { provider: 'railway', enabled: true },
				},
			} as any,
			tenantConfig: { id: 'test-site' } as any,
		}));
		unlockSecrets(tenantRoot);
		const registry = collectEnvironmentContext(tenantRoot);
		const entry = (id: string) => {
			const found = registry.entries.find((candidate) => candidate.id === id);
			if (!found) throw new Error(`Missing config entry ${id}`);
			return found as any;
		};
		setMachineEnvironmentValue(tenantRoot, 'staging', entry('TREESEED_PLATFORM_RUNNER_SECRET'), 'platform-secret-value');
		setMachineEnvironmentValue(tenantRoot, 'staging', entry('TREESEED_PLATFORM_RUNNER_ID'), 'treeseed-ops-staging-1');
		setMachineEnvironmentValue(tenantRoot, 'staging', entry('TREESEED_PLATFORM_RUNNER_DATA_DIR'), '/data');
		setMachineEnvironmentValue(tenantRoot, 'staging', entry('TREESEED_PLATFORM_RUNNER_ENVIRONMENT'), 'staging');
		setMachineEnvironmentValue(tenantRoot, 'staging', entry('TREESEED_API_BASE_URL'), 'https://api-staging.example.com');
		setMachineEnvironmentValue(tenantRoot, 'staging', entry('TREESEED_DATABASE_URL'), 'postgres://market-db-secret');

		const plan = await syncRailwayEnvironment({ tenantRoot, scope: 'staging', planOnly: true });
		const apiService = plan.services.find((service) => service.service === 'api');
		const runnerServices = plan.services.filter((service) => service.service === 'operationsRunner');

		expect(plan.services.map((service) => service.service)).toEqual(['api', 'operationsRunner']);
		expect(apiService?.secrets).toEqual(expect.arrayContaining(['TREESEED_PLATFORM_RUNNER_SECRET', 'TREESEED_DATABASE_URL']));
		expect(apiService?.variables).not.toEqual(expect.arrayContaining([
			'TREESEED_PLATFORM_RUNNER_ID',
			'TREESEED_PLATFORM_RUNNER_DATA_DIR',
			'TREESEED_PLATFORM_RUNNER_ENVIRONMENT',
		]));
		expect(runnerServices.map((service) => service.serviceName)).toEqual([
			'treeseed-ops-staging-01',
		]);
		expect(runnerServices[0]).toMatchObject({
			secrets: expect.arrayContaining(['TREESEED_PLATFORM_RUNNER_SECRET', 'TREESEED_DATABASE_URL']),
			variables: expect.arrayContaining([
				'TREESEED_API_BASE_URL',
				'TREESEED_PLATFORM_RUNNER_ID',
				'TREESEED_PLATFORM_RUNNER_DATA_DIR',
				'TREESEED_PLATFORM_RUNNER_ENVIRONMENT',
			]),
		});
		expect(JSON.stringify(apiService)).not.toContain('platform-secret-value');
		expect(JSON.stringify(runnerServices)).not.toContain('platform-secret-value');
		expect(JSON.stringify(plan)).not.toContain('postgres://market-db-secret');
		expect(JSON.stringify(runnerServices)).not.toContain('TREESEED_CAPACITY_PROVIDER_API_KEY');
	});
});
