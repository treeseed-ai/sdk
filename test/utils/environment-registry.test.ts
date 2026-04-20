import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
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
		expect(registry.entries.find((entry) => entry.id === 'TREESEED_FORM_TOKEN_SECRET')).toBeTruthy();
	});

	it('does not surface market auth entries for tenants without the overlay', async () => {
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

		expect(registry.entries.find((entry) => entry.id === 'TREESEED_API_BASE_URL')).toBeUndefined();
		expect(registry.entries.find((entry) => entry.id === 'TREESEED_FORM_TOKEN_SECRET')).toBeTruthy();
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

		expect(getTreeseedEnvironmentSuggestedValues({
			scope: 'local',
			purpose: 'config',
			deployConfig,
			plugins: [],
			values: {},
		}).TREESEED_API_BASE_URL).toBe('http://127.0.0.1:3000');

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
		const tenantRoot = await createTenantFixture('entries: {}\n');
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
		const tenantRoot = await createTenantFixture('entries: {}\n');
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
		expect(isTreeseedEnvironmentEntryRelevant(enabledTurnstileSecret!, enabledRegistry.context, 'prod', 'config')).toBe(true);
		expect(enabledSmtpHost?.storage).toBe('shared');
		expect(enabledTurnstileSecret?.storage).toBe('shared');
		expect(formTokenSecret?.storage).toBe('shared');
		expect(isTreeseedEnvironmentEntryRequired(enabledTurnstileSecret!, enabledRegistry.context, 'local', 'config')).toBe(false);
		expect(isTreeseedEnvironmentEntryRequired(enabledTurnstileSecret!, enabledRegistry.context, 'staging', 'config')).toBe(true);
	});
});
