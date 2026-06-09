import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
	getTreeseedEnvironmentSuggestedValues,
	isTreeseedEnvironmentEntryRequired,
	isTreeseedEnvironmentEntryRelevant,
	resolveTreeseedEnvironmentRegistry,
} from '../../src/platform/environment.ts';

const tempRoots = new Set<string>();

const agentProcessingRegistryFixtureYaml = `entries:
  TREESEED_PROJECT_RUNNER_TOKEN:
    label: Project runner registration token
    group: hosting
    description: Project runner token.
    howToGet: Set the project runner token.
    sensitivity: secret
    targets:
      - github-secret
    scopes:
      - staging
      - prod
    storage: scoped
    requirement: conditional
    purposes:
      - deploy
      - config
    validation:
      kind: nonempty
    sourcePriority:
      - machine-config
      - process-env
    relevanceRef: projectRegistrationEnabled
`;

const codexRegistryFixtureYaml = `entries:
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
  TREESEED_CODEX_SUBSCRIPTION_PLAN:
    label: Codex subscription plan
    group: auth
    description: Codex subscription plan.
    howToGet: Set the subscription plan.
    sensitivity: plain
    targets:
      - github-variable
      - railway-var
    scopes:
      - local
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
        - plus
        - pro
        - business
        - edu
        - enterprise
        - unknown
    relevanceRef: codexExecutionSelected
  TREESEED_CODEX_DEFAULT_MODEL:
    label: Codex default model
    group: auth
    description: Codex default model.
    howToGet: Set the default model.
    sensitivity: plain
    targets:
      - github-variable
      - railway-var
    scopes:
      - local
      - staging
      - prod
    storage: scoped
    requirement: optional
    purposes:
      - agent-execution
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
      - github-variable
      - railway-var
    scopes:
      - local
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
  TREESEED_CODEX_SANDBOX_MODE:
    label: Codex sandbox mode
    group: auth
    description: Codex sandbox mode.
    howToGet: Set the sandbox mode.
    sensitivity: plain
    targets:
      - github-variable
      - railway-var
    scopes:
      - local
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
        - read_only
        - workspace_write
    relevanceRef: codexExecutionSelected
  TREESEED_CODEX_TIMEOUT_MS:
    label: Codex execution timeout
    group: auth
    description: Codex execution timeout.
    howToGet: Set the timeout in milliseconds.
    sensitivity: plain
    targets:
      - github-variable
      - railway-var
    scopes:
      - local
      - staging
      - prod
    storage: scoped
    requirement: optional
    purposes:
      - agent-execution
      - config
    validation:
      kind: number
    relevanceRef: codexExecutionSelected
  TREESEED_CODEX_REQUIRE_RELEASE_DECISION:
    label: Require Codex release decision
    group: auth
    description: Require release decision.
    howToGet: Set true or false.
    sensitivity: plain
    targets:
      - github-variable
      - railway-var
    scopes:
      - local
      - staging
      - prod
    storage: scoped
    requirement: optional
    purposes:
      - agent-execution
      - config
    validation:
      kind: boolean
    relevanceRef: codexExecutionSelected
  TREESEED_CODEX_ALLOW_FEATURE_BRANCH_MUTATION:
    label: Allow feature branch mutation
    group: auth
    description: Allow feature branch mutation.
    howToGet: Set true or false.
    sensitivity: plain
    targets:
      - github-variable
      - railway-var
    scopes:
      - local
      - staging
      - prod
    storage: scoped
    requirement: optional
    purposes:
      - agent-execution
      - config
    validation:
      kind: boolean
    relevanceRef: codexExecutionSelected
  TREESEED_CODEX_ALLOW_AUTOMATIC_STAGING_MERGE:
    label: Allow automatic staging merge
    group: auth
    description: Allow automatic staging merge.
    howToGet: Set true or false.
    sensitivity: plain
    targets:
      - github-variable
      - railway-var
    scopes:
      - local
      - staging
      - prod
    storage: scoped
    requirement: optional
    purposes:
      - agent-execution
      - config
    validation:
      kind: boolean
    relevanceRef: codexExecutionSelected
  TREESEED_CODEX_REQUIRE_ALLOWED_PATHS:
    label: Require allowed paths
    group: auth
    description: Require allowed paths.
    howToGet: Set true or false.
    sensitivity: plain
    targets:
      - github-variable
      - railway-var
    scopes:
      - local
      - staging
      - prod
    storage: scoped
    requirement: optional
    purposes:
      - agent-execution
      - config
    validation:
      kind: boolean
    relevanceRef: codexExecutionSelected
  TREESEED_CODEX_RECORD_THREAD_IDS:
    label: Record Codex thread IDs
    group: auth
    description: Record Codex thread IDs.
    howToGet: Set true or false.
    sensitivity: plain
    targets:
      - github-variable
      - railway-var
    scopes:
      - local
      - staging
      - prod
    storage: scoped
    requirement: optional
    purposes:
      - agent-execution
      - config
    validation:
      kind: boolean
    relevanceRef: codexExecutionSelected
`;

const coreFormsRegistryFixtureYaml = `entries:
  TREESEED_FORM_TOKEN_SECRET:
    label: Forms token secret
    group: forms
    description: Forms token secret.
    howToGet: Generate a shared forms token secret.
    sensitivity: secret
    targets:
      - github-secret
    scopes:
      - local
      - staging
      - prod
    storage: shared
    requirement: required
    purposes:
      - dev
      - save
      - deploy
      - config
    validation:
      kind: nonempty
    sourcePriority:
      - machine-config
      - process-env
    defaultValueRef: generatedSecret
    localDefaultValueRef: generatedSecret
    relevanceRef: formsEnabled
  TREESEED_TURNSTILE_SECRET_KEY:
    label: Turnstile secret key
    group: forms
    description: Turnstile secret key.
    howToGet: Treeseed creates and syncs this from the managed Cloudflare Turnstile widget during deploy.
    sensitivity: secret
    visibility: system
    targets:
      - github-secret
    scopes:
      - staging
      - prod
    storage: shared
    requirement: generated
    purposes:
      - deploy
    validation:
      kind: nonempty
    sourcePriority:
      - generated
    relevanceRef: turnstileEnabled
  TREESEED_SMTP_HOST:
    label: SMTP host
    group: smtp
    description: SMTP host.
    howToGet: Set the SMTP host.
    sensitivity: plain
    targets:
      - github-variable
    scopes:
      - local
      - staging
      - prod
    storage: shared
    requirement: conditional
    purposes:
      - dev
      - save
      - deploy
      - config
    validation:
      kind: nonempty
    sourcePriority:
      - machine-config
      - process-env
    localDefaultValueRef: localSmtpHostDefault
    relevanceRef: smtpEnabled
    requiredWhenRef: smtpNonLocal
  TREESEED_SMTP_PORT:
    label: SMTP port
    group: smtp
    description: SMTP port.
    howToGet: Set the SMTP port.
    sensitivity: plain
    targets:
      - github-variable
    scopes:
      - local
      - staging
      - prod
    storage: shared
    requirement: conditional
    purposes:
      - dev
      - save
      - deploy
      - config
    validation:
      kind: number
    sourcePriority:
      - machine-config
      - process-env
    localDefaultValueRef: localSmtpPortDefault
    relevanceRef: smtpEnabled
    requiredWhenRef: smtpNonLocal
  TREESEED_SMTP_FROM:
    label: SMTP from address
    group: smtp
    description: SMTP from address.
    howToGet: Set a verified sender address.
    sensitivity: plain
    targets:
      - github-variable
    scopes:
      - local
      - staging
      - prod
    storage: shared
    requirement: conditional
    purposes:
      - dev
      - save
      - deploy
      - config
    validation:
      kind: email
    sourcePriority:
      - machine-config
      - process-env
    localDefaultValueRef: contactEmailDefault
    relevanceRef: smtpEnabled
    requiredWhenRef: smtpNonLocal
  TREESEED_SMTP_REPLY_TO:
    label: SMTP reply-to address
    group: smtp
    description: SMTP reply-to address.
    howToGet: Set a reply-to address.
    sensitivity: plain
    targets:
      - github-variable
    scopes:
      - local
      - staging
      - prod
    storage: shared
    requirement: conditional
    purposes:
      - dev
      - save
      - deploy
      - config
    validation:
      kind: email
    sourcePriority:
      - machine-config
      - process-env
    localDefaultValueRef: contactEmailDefault
    relevanceRef: smtpEnabled
    requiredWhenRef: smtpNonLocal
`;

async function createTenantFixture(envYaml: string) {
	const tenantRoot = await mkdtemp(join(tmpdir(), 'treeseed-sdk-env-registry-'));
	await mkdir(join(tenantRoot, 'src'), { recursive: true });
	await writeFile(
		join(tenantRoot, 'src/manifest.yaml'),
		'id: test-site\nsiteConfigPath: ./src/config.yaml\ncontent:\n  pages: ./src/content/pages\n',
	);
	await writeFile(
		join(tenantRoot, 'treeseed.site.yaml'),
		'name: Test Site\nslug: test-site\nsiteUrl: https://example.com\ncontactEmail: hello@example.com\ncloudflare:\n  accountId: account-123\nservices:\n  api:\n    provider: railway\n    enabled: true\n',
	);
	await writeFile(join(tenantRoot, 'src/env.yaml'), envYaml);
	return tenantRoot;
}

function findRegistryEntry(registry: ReturnType<typeof resolveTreeseedEnvironmentRegistry>, id: string) {
	return registry.entries.find((entry) => entry.id === id);
}

afterEach(async () => {
	for (const tenantRoot of tempRoots) {
		await rm(tenantRoot, { recursive: true, force: true });
	}
	tempRoots.clear();
});

describe('environment registry overlays', () => {
	it('loads market auth entries from the tenant overlay', async () => {
		const tenantRoot = await createTenantFixture(`entries:
  TREESEED_API_BASE_URL:
    label: Treeseed API base URL
    group: auth
    description: Tenant auth overlay entry.
    howToGet: Set the API origin.
    sensitivity: plain
    targets:
      - local-runtime
      - railway-var
    scopes:
      - local
      - staging
      - prod
    requirement: required
    purposes:
      - dev
      - deploy
      - config
    validation:
      kind: nonempty
`);
		tempRoots.add(tenantRoot);

		const registry = resolveTreeseedEnvironmentRegistry({
			deployConfig: {
				name: 'Test Site',
				slug: 'test-site',
				siteUrl: 'https://example.com',
				contactEmail: 'hello@example.com',
				cloudflare: { accountId: 'account-123' },
				services: { api: { provider: 'railway', enabled: true } },
				__tenantRoot: tenantRoot,
			} as any,
			plugins: [],
		});

		expect(registry.entries.find((entry) => entry.id === 'TREESEED_API_BASE_URL')).toMatchObject({
			group: 'auth',
			description: 'Tenant auth overlay entry.',
		});
		const formTokenSecret = findRegistryEntry(registry, 'TREESEED_FORM_TOKEN_SECRET');
		if (formTokenSecret) {
			expect(formTokenSecret.group).toBe('forms');
		}
	});

	it('surfaces agent API entries when the API processing plane is enabled', async () => {
		const tenantRoot = await createTenantFixture(agentProcessingRegistryFixtureYaml);
		tempRoots.add(tenantRoot);

		const registry = resolveTreeseedEnvironmentRegistry({
			deployConfig: {
				name: 'Test Site',
				slug: 'test-site',
				siteUrl: 'https://example.com',
				contactEmail: 'hello@example.com',
				cloudflare: { accountId: 'account-123' },
				services: { api: { provider: 'railway', enabled: true } },
				__tenantRoot: tenantRoot,
			} as any,
			plugins: [],
		});

		const apiBaseUrl = findRegistryEntry(registry, 'TREESEED_API_BASE_URL');
		if (apiBaseUrl) {
			expect(apiBaseUrl.targets).toContain('railway-var');
		} else {
			expect(findRegistryEntry(registry, 'TREESEED_FORM_TOKEN_SECRET')).toBeUndefined();
		}
	});

	it('surfaces hosted Codex auth bootstrap and policy entries from the agent registry', async () => {
		const tenantRoot = await createTenantFixture(codexRegistryFixtureYaml);
		tempRoots.add(tenantRoot);

		const registry = resolveTreeseedEnvironmentRegistry({
			deployConfig: {
				name: 'Test Site',
				slug: 'test-site',
				siteUrl: 'https://example.com',
				contactEmail: 'hello@example.com',
				cloudflare: { accountId: 'account-123' },
				providers: { agents: { execution: 'codex' } },
				services: { api: { provider: 'railway', enabled: true } },
				__tenantRoot: tenantRoot,
			} as any,
			plugins: [],
		});

		const authBootstrap = findRegistryEntry(registry, 'TREESEED_CODEX_AUTH_JSON_B64');
		expect(authBootstrap).toMatchObject({
			sensitivity: 'secret',
			storage: 'scoped',
		});
		expect(authBootstrap?.targets).toEqual(expect.arrayContaining(['railway-secret', 'github-secret']));
		expect(authBootstrap?.scopes).toEqual(expect.arrayContaining(['staging', 'prod']));

		const overwrite = findRegistryEntry(registry, 'TREESEED_CODEX_AUTH_OVERWRITE');
		expect(overwrite?.sensitivity).toBe('plain');
		expect(overwrite?.targets).toEqual(expect.arrayContaining(['railway-var', 'local-runtime']));
		expect(overwrite?.targets).not.toContain('railway-secret');

		for (const id of [
			'TREESEED_CODEX_SUBSCRIPTION_PLAN',
			'TREESEED_CODEX_DEFAULT_MODEL',
			'TREESEED_CODEX_APPROVAL_POLICY',
			'TREESEED_CODEX_SANDBOX_MODE',
			'TREESEED_CODEX_TIMEOUT_MS',
			'TREESEED_CODEX_REQUIRE_RELEASE_DECISION',
			'TREESEED_CODEX_ALLOW_FEATURE_BRANCH_MUTATION',
			'TREESEED_CODEX_ALLOW_AUTOMATIC_STAGING_MERGE',
			'TREESEED_CODEX_REQUIRE_ALLOWED_PATHS',
			'TREESEED_CODEX_RECORD_THREAD_IDS',
		]) {
			const entry = findRegistryEntry(registry, id);
			expect(entry, id).toBeDefined();
			expect(entry?.targets).toEqual(expect.arrayContaining(['railway-var', 'github-variable']));
			expect(entry?.sensitivity).toBe('plain');
			expect(isTreeseedEnvironmentEntryRelevant(entry!, registry.context, 'staging', 'config')).toBe(true);
		}
	});

	it('uses the active workflow plane to keep web deploy validation free of processing entries', async () => {
		const tenantRoot = await createTenantFixture(coreFormsRegistryFixtureYaml);
		tempRoots.add(tenantRoot);
		const previousPlane = process.env.TREESEED_WORKFLOW_PLANE;
		process.env.TREESEED_WORKFLOW_PLANE = 'web';
		try {
			const registry = resolveTreeseedEnvironmentRegistry({
				deployConfig: {
					name: 'Test Site',
					slug: 'test-site',
					siteUrl: 'https://example.com',
					contactEmail: 'hello@example.com',
					cloudflare: { accountId: 'account-123' },
					surfaces: { web: { enabled: true }, api: { enabled: true } },
					services: { api: { provider: 'railway', enabled: true } },
					__tenantRoot: tenantRoot,
				} as any,
				plugins: [],
			});

			const railwayApiToken = findRegistryEntry(registry, 'RAILWAY_API_TOKEN');
			if (railwayApiToken) {
				expect(isTreeseedEnvironmentEntryRelevant(railwayApiToken, registry.context, 'staging', 'config')).toBe(false);
			}
			expect(findRegistryEntry(registry, 'TREESEED_API_WEB_SERVICE_SECRET')).toBeUndefined();
			expect(findRegistryEntry(registry, 'TREESEED_CAPACITY_PROVIDER_ID')).toBeUndefined();
		} finally {
			if (previousPlane === undefined) {
				delete process.env.TREESEED_WORKFLOW_PLANE;
			} else {
				process.env.TREESEED_WORKFLOW_PLANE = previousPlane;
			}
		}
	});

	it('keeps market-assigned processing free of processing-host secrets by default', async () => {
		const tenantRoot = await createTenantFixture(agentProcessingRegistryFixtureYaml);
		tempRoots.add(tenantRoot);

		const registry = resolveTreeseedEnvironmentRegistry({
			deployConfig: {
				name: 'Test Site',
				slug: 'test-site',
				siteUrl: 'https://example.com',
				contactEmail: 'hello@example.com',
				cloudflare: { accountId: 'account-123' },
				processing: { mode: 'market-assigned' },
				__tenantRoot: tenantRoot,
			} as any,
			plugins: [],
		});

		for (const id of ['RAILWAY_API_TOKEN', 'TREESEED_API_WEB_SERVICE_SECRET', 'TREESEED_CAPACITY_PROVIDER_ID']) {
			const entry = findRegistryEntry(registry, id);
			if (entry) {
				expect(isTreeseedEnvironmentEntryRelevant(entry, registry.context, 'staging', 'config')).toBe(false);
			}
		}
	});

	it('keeps Cloudflare account ID as required shared environment config in every environment', async () => {
		const tenantRoot = await createTenantFixture(coreFormsRegistryFixtureYaml);
		tempRoots.add(tenantRoot);

		const deployConfig = {
			name: 'Test Site',
			slug: 'test-site',
			siteUrl: 'https://example.com',
			contactEmail: 'hello@example.com',
			cloudflare: { accountId: 'account-123' },
			services: { api: { provider: 'railway', enabled: true } },
			__tenantRoot: tenantRoot,
		} as any;
		const registry = resolveTreeseedEnvironmentRegistry({
			deployConfig,
			plugins: [],
		});
		const entry = registry.entries.find((candidate) => candidate.id === 'CLOUDFLARE_ACCOUNT_ID');

		expect(entry).toMatchObject({
			requirement: 'required',
			storage: 'shared',
			startupProfile: 'core',
		});
		expect(entry?.scopes).toEqual(['local', 'staging', 'prod']);
		expect(entry?.targets).toContain('local-runtime');
		expect(isTreeseedEnvironmentEntryRelevant(entry!, registry.context, 'local', 'config')).toBe(true);
		expect(isTreeseedEnvironmentEntryRequired(entry!, registry.context, 'local', 'config')).toBe(true);
		expect(isTreeseedEnvironmentEntryRequired(entry!, registry.context, 'prod', 'config')).toBe(true);
		expect(getTreeseedEnvironmentSuggestedValues({
			scope: 'local',
			purpose: 'config',
			deployConfig,
			plugins: [],
			values: {},
		}).CLOUDFLARE_ACCOUNT_ID).toBeUndefined();
		expect(getTreeseedEnvironmentSuggestedValues({
			scope: 'prod',
			purpose: 'config',
			deployConfig: {
				...deployConfig,
				cloudflare: { accountId: 'replace-with-cloudflare-account-id' },
			},
			plugins: [],
			values: {
				CLOUDFLARE_ACCOUNT_ID: 'account-from-machine-config',
			},
		}).CLOUDFLARE_ACCOUNT_ID).toBeUndefined();
	});

	it('scopes Cloudflare AI credentials to local, staging, and prod config', async () => {
		const tenantRoot = await createTenantFixture(agentProcessingRegistryFixtureYaml);
		tempRoots.add(tenantRoot);

		const registry = resolveTreeseedEnvironmentRegistry({
			deployConfig: {
				name: 'Test Site',
				slug: 'test-site',
				siteUrl: 'https://example.com',
				contactEmail: 'hello@example.com',
				cloudflare: { accountId: 'account-123' },
				services: { api: { provider: 'railway', enabled: true } },
				__tenantRoot: tenantRoot,
			} as any,
			plugins: [],
		});
		const cloudflareToken = registry.entries.find((entry) => entry.id === 'CLOUDFLARE_API_TOKEN');

		expect(cloudflareToken?.scopes).toEqual(['local', 'staging', 'prod']);
		expect(isTreeseedEnvironmentEntryRelevant(cloudflareToken!, registry.context, 'local', 'config')).toBe(true);
		expect(isTreeseedEnvironmentEntryRequired(cloudflareToken!, registry.context, 'local', 'config')).toBe(true);
		expect(findRegistryEntry(registry, 'RAILWAY_API_TOKEN')?.scopes).toEqual(
			findRegistryEntry(registry, 'RAILWAY_API_TOKEN') ? ['local', 'staging', 'prod'] : undefined,
		);
		expect(registry.entries.find((entry) => entry.id === 'CLOUDFLARE_ACCOUNT_ID')?.scopes).toEqual(['local', 'staging', 'prod']);
		expect(findRegistryEntry(registry, 'TREESEED_RAILWAY_WORKSPACE')?.scopes).toEqual(
			findRegistryEntry(registry, 'TREESEED_RAILWAY_WORKSPACE') ? ['staging', 'prod'] : undefined,
		);
		expect(registry.entries.find((entry) => entry.id === 'TREESEED_HOSTING_KIND')?.scopes).toEqual(['staging', 'prod']);
		expect(registry.entries.find((entry) => entry.id === 'TREESEED_PROJECT_RUNNER_TOKEN')?.scopes).toEqual(['staging', 'prod']);
		expect(findRegistryEntry(registry, 'TREESEED_RAILWAY_PROJECT_ID')?.scopes).toEqual(
			findRegistryEntry(registry, 'TREESEED_RAILWAY_PROJECT_ID') ? ['staging', 'prod'] : undefined,
		);
		expect(findRegistryEntry(registry, 'TREESEED_WORKER_POOL_SCALER')?.scopes).toEqual(
			findRegistryEntry(registry, 'TREESEED_WORKER_POOL_SCALER') ? ['staging', 'prod'] : undefined,
		);
		expect(registry.entries.find((entry) => entry.id === 'GH_TOKEN')?.scopes).toEqual(['local', 'staging', 'prod']);
	});

	it('registers staging and production market defaults for primary and integrated catalog markets', async () => {
		const tenantRoot = await createTenantFixture(coreFormsRegistryFixtureYaml);
		tempRoots.add(tenantRoot);
		const deployConfig = {
			name: 'Test Site',
			slug: 'test-site',
			siteUrl: 'https://example.com',
			contactEmail: 'hello@example.com',
			cloudflare: { accountId: 'account-123' },
			services: { api: { provider: 'railway', enabled: true } },
			__tenantRoot: tenantRoot,
		} as any;
		const registry = resolveTreeseedEnvironmentRegistry({
			deployConfig,
			plugins: [],
		});

		const centralApiBaseUrl = findRegistryEntry(registry, 'TREESEED_CENTRAL_MARKET_API_BASE_URL');
		if (!centralApiBaseUrl) {
			expect(findRegistryEntry(registry, 'TREESEED_API_BASE_URL')).toBeUndefined();
			return;
		}

		expect(centralApiBaseUrl).toMatchObject({
			scopes: ['staging', 'prod'],
			requirement: 'optional',
		});
		expect([
			['staging', 'prod'],
			['local', 'staging', 'prod'],
		]).toContainEqual(findRegistryEntry(registry, 'TREESEED_API_BASE_URL')?.scopes);
		expect(findRegistryEntry(registry, 'TREESEED_CATALOG_MARKET_API_BASE_URLS')).toMatchObject({
			scopes: ['staging', 'prod'],
			requirement: 'optional',
		});
		expect(getTreeseedEnvironmentSuggestedValues({
			scope: 'prod',
			purpose: 'config',
			deployConfig,
			plugins: [],
			values: {},
		}).TREESEED_CENTRAL_MARKET_API_BASE_URL).toBe('https://api.treeseed.ai');
		expect(getTreeseedEnvironmentSuggestedValues({
			scope: 'staging',
			purpose: 'config',
			deployConfig,
			plugins: [],
			values: {
				TREESEED_CENTRAL_MARKET_API_BASE_URL: 'https://staging-market.example.com',
			},
		}).TREESEED_CATALOG_MARKET_API_BASE_URLS).toBe('https://api.example.com');
	});

	it('suggests local GitHub repository metadata from origin when present', async () => {
		const tenantRoot = await createTenantFixture(coreFormsRegistryFixtureYaml);
		tempRoots.add(tenantRoot);
		spawnSync('git', ['init', '-b', 'main'], { cwd: tenantRoot, stdio: 'ignore' });
		spawnSync('git', ['remote', 'add', 'origin', 'git@github.com:knowledge-coop/market.git'], { cwd: tenantRoot, stdio: 'ignore' });
		const deployConfig = {
			name: 'Test Site',
			slug: 'test-site',
			siteUrl: 'https://example.com',
			contactEmail: 'hello@example.com',
			cloudflare: { accountId: 'account-123' },
			__tenantRoot: tenantRoot,
		} as any;

		const suggested = getTreeseedEnvironmentSuggestedValues({
			scope: 'local',
			purpose: 'config',
			deployConfig,
			plugins: [],
			values: {},
		});

		expect(suggested.TREESEED_GITHUB_OWNER).toBe('knowledge-coop');
		expect(suggested.TREESEED_GITHUB_REPOSITORY_NAME).toBe('market');
		expect(suggested.TREESEED_GITHUB_REPOSITORY_VISIBILITY).toBe('private');
	});

	it('requires clean local GitHub metadata and does not advertise legacy env names', async () => {
		const tenantRoot = await createTenantFixture(coreFormsRegistryFixtureYaml);
		tempRoots.add(tenantRoot);
		const deployConfig = {
			name: 'Test Site',
			slug: 'test-site',
			siteUrl: 'https://example.com',
			contactEmail: 'hello@example.com',
			cloudflare: { accountId: 'account-123' },
			__tenantRoot: tenantRoot,
		} as any;
		const registry = resolveTreeseedEnvironmentRegistry({ deployConfig, plugins: [] });
		const owner = registry.entries.find((entry) => entry.id === 'TREESEED_GITHUB_OWNER');
		const repositoryName = registry.entries.find((entry) => entry.id === 'TREESEED_GITHUB_REPOSITORY_NAME');

		expect(owner?.scopes).toEqual(['local']);
		expect(repositoryName?.scopes).toEqual(['local']);
		expect(isTreeseedEnvironmentEntryRequired(owner!, registry.context, 'local', 'config')).toBe(true);
		expect(isTreeseedEnvironmentEntryRequired(repositoryName!, registry.context, 'local', 'config')).toBe(true);
		expect(getTreeseedEnvironmentSuggestedValues({
			scope: 'local',
			purpose: 'config',
			deployConfig,
			plugins: [],
			values: {},
		})).toMatchObject({
			TREESEED_GITHUB_REPOSITORY_NAME: 'test-site',
			TREESEED_GITHUB_REPOSITORY_VISIBILITY: 'private',
		});
		expect(registry.entries.find((entry) => entry.id === `TREESEED_${'KNOWLEDGE'}_${'COOP'}_GITHUB_OWNER`)).toBeUndefined();
		expect(registry.entries.find((entry) => entry.id === 'RAILWAY_API_KEY')).toBeUndefined();
		const railwayApiToken = findRegistryEntry(registry, 'RAILWAY_API_TOKEN');
		if (railwayApiToken) {
			expect(railwayApiToken.howToGet).not.toMatch(/legacy alias|RAILWAY_API_KEY/u);
		}
	});

	it('supports shared project-domain defaults that seed scoped api urls', async () => {
		const tenantRoot = await createTenantFixture(`entries:
  TREESEED_PROJECT_DOMAINS:
    label: Project custom domains
    group: auth
    description: Shared project domains.
    howToGet: Set custom domains.
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
    defaultValueRef: projectDomainsDefault
  TREESEED_API_BASE_URL:
    label: Treeseed API base URL
    group: auth
    description: API base URL.
    howToGet: Set API URL.
    sensitivity: plain
    targets:
      - local-runtime
    scopes:
      - local
      - staging
      - prod
    storage: scoped
    requirement: required
    purposes:
      - dev
      - deploy
      - config
    validation:
      kind: nonempty
    defaultValueRef: apiBaseUrlDefault
`);
		tempRoots.add(tenantRoot);

		const deployConfig = {
			name: 'Test Site',
			slug: 'test-site',
			siteUrl: 'https://market.example.com',
			contactEmail: 'hello@example.com',
			cloudflare: { accountId: 'account-123' },
			services: {
				api: {
					provider: 'railway',
					enabled: true,
					environments: {
						local: { baseUrl: 'http://127.0.0.1:3000' },
					},
				},
			},
			__tenantRoot: tenantRoot,
		} as any;

		const registry = resolveTreeseedEnvironmentRegistry({
			deployConfig,
			plugins: [],
		});
		expect(registry.entries.find((entry) => entry.id === 'TREESEED_PROJECT_DOMAINS')?.storage).toBe('shared');
		expect(registry.entries.find((entry) => entry.id === 'TREESEED_API_BASE_URL')?.storage).toBe('scoped');

		const localSuggestedApiUrl = getTreeseedEnvironmentSuggestedValues({
			scope: 'local',
			purpose: 'config',
			deployConfig,
			plugins: [],
			values: {},
		}).TREESEED_API_BASE_URL;
		expect(localSuggestedApiUrl === undefined || localSuggestedApiUrl === 'http://127.0.0.1:3000').toBe(true);

		expect(getTreeseedEnvironmentSuggestedValues({
			scope: 'prod',
			purpose: 'config',
			deployConfig,
			plugins: [],
			values: {
				TREESEED_PROJECT_DOMAINS: 'market.example.com',
			},
		}).TREESEED_API_BASE_URL).toBe('https://api.example.com');
	});

	it('supports safe service-id defaults for the web and api trust boundary', async () => {
		const tenantRoot = await createTenantFixture(`entries:
  TREESEED_WEB_SERVICE_ID:
    label: Web service ID
    group: auth
    description: Shared web service ID.
    howToGet: Use web.
    sensitivity: plain
    targets:
      - local-runtime
    scopes:
      - local
      - staging
      - prod
    storage: shared
    requirement: required
    purposes:
      - config
    validation:
      kind: nonempty
    defaultValueRef: webServiceIdDefault
  TREESEED_API_WEB_SERVICE_ID:
    label: API trusted web service ID
    group: auth
    description: API-side trusted web service ID.
    howToGet: Match the web service ID.
    sensitivity: plain
    targets:
      - local-runtime
    scopes:
      - local
      - staging
      - prod
    requirement: required
    purposes:
      - config
    validation:
      kind: nonempty
    defaultValueRef: apiWebServiceIdDefault
`);
		tempRoots.add(tenantRoot);

		const deployConfig = {
			name: 'Test Site',
			slug: 'test-site',
			siteUrl: 'https://market.example.com',
			contactEmail: 'hello@example.com',
			cloudflare: { accountId: 'account-123' },
			services: { api: { provider: 'railway', enabled: true } },
			__tenantRoot: tenantRoot,
		} as any;

		const suggested = getTreeseedEnvironmentSuggestedValues({
			scope: 'prod',
			purpose: 'config',
			deployConfig,
			plugins: [],
			values: {},
		});
		expect(suggested.TREESEED_WEB_SERVICE_ID).toBe('web');
		expect(suggested.TREESEED_API_WEB_SERVICE_ID).toBe('web');

		const linkedSuggested = getTreeseedEnvironmentSuggestedValues({
			scope: 'prod',
			purpose: 'config',
			deployConfig,
			plugins: [],
			values: {
				TREESEED_WEB_SERVICE_ID: 'edge-web',
			},
		});
		expect(linkedSuggested.TREESEED_API_WEB_SERVICE_ID).toBe('edge-web');
	});

	it('uses local smtp defaults without making local smtp required', async () => {
		const tenantRoot = await createTenantFixture(coreFormsRegistryFixtureYaml);
		tempRoots.add(tenantRoot);

		const deployConfig = {
			name: 'Test Site',
			slug: 'test-site',
			siteUrl: 'https://example.com',
			contactEmail: 'hello@example.com',
			cloudflare: { accountId: 'account-123' },
			services: { api: { provider: 'railway', enabled: true } },
			smtp: { enabled: true },
			turnstile: { enabled: true },
			__tenantRoot: tenantRoot,
		} as any;

		const registry = resolveTreeseedEnvironmentRegistry({
			deployConfig,
			plugins: [],
		});
		const smtpHost = registry.entries.find((entry) => entry.id === 'TREESEED_SMTP_HOST');
		const smtpPort = registry.entries.find((entry) => entry.id === 'TREESEED_SMTP_PORT');
		const smtpFrom = registry.entries.find((entry) => entry.id === 'TREESEED_SMTP_FROM');
		const smtpReplyTo = registry.entries.find((entry) => entry.id === 'TREESEED_SMTP_REPLY_TO');

		expect(smtpHost).toBeTruthy();
		expect(smtpPort).toBeTruthy();
		expect(smtpFrom).toBeTruthy();
		expect(smtpReplyTo).toBeTruthy();
		expect(smtpHost?.storage).toBe('shared');
		expect(smtpPort?.storage).toBe('shared');
		expect(smtpFrom?.storage).toBe('shared');
		expect(smtpReplyTo?.storage).toBe('shared');
		expect(isTreeseedEnvironmentEntryRequired(smtpHost!, registry.context, 'local', 'config')).toBe(false);
		expect(isTreeseedEnvironmentEntryRequired(smtpHost!, registry.context, 'staging', 'config')).toBe(true);
		expect(isTreeseedEnvironmentEntryRequired(smtpPort!, registry.context, 'local', 'config')).toBe(false);
		expect(isTreeseedEnvironmentEntryRequired(smtpFrom!, registry.context, 'local', 'config')).toBe(false);
		expect(isTreeseedEnvironmentEntryRequired(smtpReplyTo!, registry.context, 'local', 'config')).toBe(false);

		const suggested = getTreeseedEnvironmentSuggestedValues({
			scope: 'local',
			purpose: 'config',
			deployConfig,
			plugins: [],
			values: {},
		});
		expect(suggested.TREESEED_SMTP_HOST).toBe('127.0.0.1');
		expect(suggested.TREESEED_SMTP_PORT).toBe('1025');
		expect(suggested.TREESEED_SMTP_FROM).toBe('hello@example.com');
		expect(suggested.TREESEED_SMTP_REPLY_TO).toBe('hello@example.com');
	});

	it('gates hosted smtp and turnstile entries on deploy config enablement', async () => {
		const tenantRoot = await createTenantFixture(coreFormsRegistryFixtureYaml);
		tempRoots.add(tenantRoot);

		const deployConfig = {
			name: 'Test Site',
			slug: 'test-site',
			siteUrl: 'https://example.com',
			contactEmail: 'hello@example.com',
			cloudflare: { accountId: 'account-123' },
			services: { api: { provider: 'railway', enabled: true } },
			smtp: { enabled: false },
			turnstile: { enabled: false },
			__tenantRoot: tenantRoot,
		} as any;

		const disabledRegistry = resolveTreeseedEnvironmentRegistry({
			deployConfig,
			plugins: [],
		});
		const smtpHost = disabledRegistry.entries.find((entry) => entry.id === 'TREESEED_SMTP_HOST');
		const turnstileSecret = disabledRegistry.entries.find((entry) => entry.id === 'TREESEED_TURNSTILE_SECRET_KEY');
		expect(isTreeseedEnvironmentEntryRelevant(smtpHost!, disabledRegistry.context, 'staging', 'config')).toBe(false);
		expect(isTreeseedEnvironmentEntryRelevant(turnstileSecret!, disabledRegistry.context, 'prod', 'config')).toBe(false);

		const enabledRegistry = resolveTreeseedEnvironmentRegistry({
			deployConfig: {
				...deployConfig,
				smtp: { enabled: true },
				turnstile: { enabled: true },
			},
			plugins: [],
		});
		const enabledSmtpHost = enabledRegistry.entries.find((entry) => entry.id === 'TREESEED_SMTP_HOST');
		const enabledTurnstileSecret = enabledRegistry.entries.find((entry) => entry.id === 'TREESEED_TURNSTILE_SECRET_KEY');
		const formTokenSecret = enabledRegistry.entries.find((entry) => entry.id === 'TREESEED_FORM_TOKEN_SECRET');
		expect(isTreeseedEnvironmentEntryRelevant(enabledSmtpHost!, enabledRegistry.context, 'staging', 'config')).toBe(true);
		expect(isTreeseedEnvironmentEntryRelevant(enabledTurnstileSecret!, enabledRegistry.context, 'prod', 'config')).toBe(false);
		expect(isTreeseedEnvironmentEntryRelevant(enabledTurnstileSecret!, enabledRegistry.context, 'prod', 'deploy')).toBe(true);
		expect(enabledSmtpHost?.storage).toBe('shared');
		expect(enabledTurnstileSecret?.storage).toBe('shared');
		expect(enabledTurnstileSecret?.visibility).toBe('system');
		expect(enabledTurnstileSecret?.requirement).toBe('generated');
		expect(formTokenSecret?.storage).toBe('shared');
		expect(enabledTurnstileSecret?.scopes).toEqual(['staging', 'prod']);
		expect(isTreeseedEnvironmentEntryRelevant(enabledTurnstileSecret!, enabledRegistry.context, 'local', 'config')).toBe(false);
		expect(isTreeseedEnvironmentEntryRequired(enabledTurnstileSecret!, enabledRegistry.context, 'staging', 'config')).toBe(false);
		expect(enabledRegistry.entries.find((entry) => entry.id === 'TREESEED_PUBLIC_FORMS_LOCAL_BYPASS_TURNSTILE')).toBeUndefined();
	});

	it('gates local web, api, and forms entries on enabled surfaces', async () => {
		const tenantRoot = await createTenantFixture(`entries:
  TREESEED_WEB_ONLY:
    label: Web only
    group: auth
    description: Web surface entry.
    howToGet: Enable the web surface.
    sensitivity: plain
    targets:
      - local-runtime
    scopes:
      - local
      - staging
      - prod
    requirement: optional
    purposes:
      - config
    validation:
      kind: nonempty
    relevanceRef: webSurfaceEnabled
  TREESEED_API_ONLY:
    label: API only
    group: auth
    description: API surface entry.
    howToGet: Enable the API surface and service.
    sensitivity: plain
    targets:
      - local-runtime
    scopes:
      - local
      - staging
      - prod
    requirement: optional
    purposes:
      - config
    validation:
      kind: nonempty
    relevanceRef: apiSurfaceEnabled
`);
		tempRoots.add(tenantRoot);

		const deployConfig = {
			name: 'Test Site',
			slug: 'test-site',
			siteUrl: 'https://example.com',
			contactEmail: 'hello@example.com',
			cloudflare: { accountId: 'account-123' },
			providers: { forms: 'store_only' },
			surfaces: { web: { enabled: false }, api: { enabled: false } },
			services: { api: { provider: 'railway', enabled: false } },
			__tenantRoot: tenantRoot,
		} as any;

		const disabledRegistry = resolveTreeseedEnvironmentRegistry({ deployConfig, plugins: [] });
		const webEntry = disabledRegistry.entries.find((entry) => entry.id === 'TREESEED_WEB_ONLY');
		const apiEntry = disabledRegistry.entries.find((entry) => entry.id === 'TREESEED_API_ONLY');
		const formTokenSecret = disabledRegistry.entries.find((entry) => entry.id === 'TREESEED_FORM_TOKEN_SECRET');
		expect(isTreeseedEnvironmentEntryRelevant(webEntry!, disabledRegistry.context, 'local', 'config')).toBe(false);
		expect(isTreeseedEnvironmentEntryRelevant(apiEntry!, disabledRegistry.context, 'local', 'config')).toBe(false);
		if (formTokenSecret) {
			expect(isTreeseedEnvironmentEntryRelevant(formTokenSecret, disabledRegistry.context, 'local', 'config')).toBe(false);
		}

		const enabledRegistry = resolveTreeseedEnvironmentRegistry({
			deployConfig: {
				...deployConfig,
				surfaces: { web: { enabled: true }, api: { enabled: true } },
				services: { api: { provider: 'railway', enabled: true } },
			},
			plugins: [],
		});
		const enabledWebEntry = enabledRegistry.entries.find((entry) => entry.id === 'TREESEED_WEB_ONLY');
		const enabledApiEntry = enabledRegistry.entries.find((entry) => entry.id === 'TREESEED_API_ONLY');
		const enabledFormTokenSecret = enabledRegistry.entries.find((entry) => entry.id === 'TREESEED_FORM_TOKEN_SECRET');
		expect(isTreeseedEnvironmentEntryRelevant(enabledWebEntry!, enabledRegistry.context, 'local', 'config')).toBe(true);
		expect(isTreeseedEnvironmentEntryRelevant(enabledApiEntry!, enabledRegistry.context, 'local', 'config')).toBe(true);
		if (enabledFormTokenSecret) {
			expect(isTreeseedEnvironmentEntryRelevant(enabledFormTokenSecret, enabledRegistry.context, 'local', 'config')).toBe(true);
		}
	});

	it('targets Railway API token to GitHub deploy workflows and the operations runner service', async () => {
		const tenantRoot = await createTenantFixture('entries: {}\n');
		tempRoots.add(tenantRoot);

		const registry = resolveTreeseedEnvironmentRegistry({
			deployConfig: {
				name: 'Test Site',
				slug: 'test-site',
				siteUrl: 'https://example.com',
				contactEmail: 'hello@example.com',
				cloudflare: { accountId: 'account-123' },
				services: { api: { provider: 'railway', enabled: true } },
				__tenantRoot: tenantRoot,
			} as any,
			plugins: [],
		});

		const railwayApiToken = findRegistryEntry(registry, 'RAILWAY_API_TOKEN');
		if (railwayApiToken) {
			expect(railwayApiToken.targets).toEqual(expect.arrayContaining(['github-secret']));
			expect(railwayApiToken.targets).toEqual(expect.arrayContaining(['railway-secret']));
			expect(railwayApiToken.serviceTargets).toEqual(expect.arrayContaining(['operationsRunner']));
		}
		const railwayProjectToken = findRegistryEntry(registry, 'RAILWAY_TOKEN');
		if (railwayProjectToken) {
			expect(railwayProjectToken.targets).toEqual(expect.arrayContaining(['github-secret']));
			expect(railwayProjectToken.requirement).toBe('optional');
		}
	});
});
