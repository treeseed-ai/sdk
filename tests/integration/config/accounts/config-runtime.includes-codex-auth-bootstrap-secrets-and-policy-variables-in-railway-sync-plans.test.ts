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

it('includes Codex auth bootstrap secrets and policy variables in Railway sync plans', async () => {
		const tenantRoot = createTenantFixture(codexRegistryFixtureEntries);
		writeMachineConfig(tenantRoot, createDefaultMachineConfig({
			tenantRoot,
			deployConfig: {
				name: 'Test Site',
				slug: 'test-site',
				siteUrl: 'https://market.example.com',
				contactEmail: 'hello@example.com',
				cloudflare: { accountId: 'account-123' },
				providers: { agents: { execution: 'codex' } },
				services: { api: { provider: 'railway', enabled: true } },
			} as any,
			tenantConfig: { id: 'test-site' } as any,
		}));
		unlockSecrets(tenantRoot);
		setMachineEnvironmentValue(tenantRoot, 'staging', {
			id: 'TREESEED_CODEX_AUTH_JSON_B64',
			sensitivity: 'secret',
			storage: 'scoped',
		} as any, 'eyJPUEVOQUlfQ09ERVhfTE9HSU4iOiJ0ZXN0In0=');
		setMachineEnvironmentValue(tenantRoot, 'staging', {
			id: 'TREESEED_CODEX_APPROVAL_POLICY',
			sensitivity: 'plain',
			storage: 'scoped',
		} as any, 'never');
		setMachineEnvironmentValue(tenantRoot, 'staging', {
			id: 'TREESEED_CODEX_AUTH_OVERWRITE',
			sensitivity: 'plain',
			storage: 'scoped',
		} as any, '0');

		const plan = await syncRailwayEnvironment({ tenantRoot, scope: 'staging', planOnly: true });
		const apiService = plan.services.find((service) => service.service === 'api');
		const context = collectConfigContext({ tenantRoot, scopes: ['staging'], env: {} });
		const configEntryIds = context.entriesByScope.staging.map((entry) => entry.id);

		expect(configEntryIds).toEqual(expect.arrayContaining([
			'TREESEED_CODEX_AUTH_JSON_B64',
			'TREESEED_CODEX_APPROVAL_POLICY',
			'TREESEED_CODEX_AUTH_OVERWRITE',
		]));
		expect(apiService?.secrets).toContain('TREESEED_CODEX_AUTH_JSON_B64');
		expect(apiService?.variables).toEqual(expect.arrayContaining([
			'TREESEED_CODEX_APPROVAL_POLICY',
			'TREESEED_CODEX_AUTH_OVERWRITE',
		]));
	});
});
