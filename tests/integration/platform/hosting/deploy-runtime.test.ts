import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PROVIDER_SELECTIONS } from '../../../../src/platform/plugins/constants.ts';
import { loadCliDeployConfig } from '../../../../src/operations/services/agents/runtime-tools.ts';
import {
	getAgentProviderSelections,
	getContentPublishProvider,
	getContentRuntimeProvider,
	getDeployConfig,
	getDeployProvider,
	getDocsProvider,
	getFormsProvider,
	getOperationsProvider,
	getSiteProvider,
	isSmtpEnabled,
	isTurnstileEnabled,
	resetDeployConfigForTests,
} from '../../../../src/platform/hosting/deploy-runtime.ts';

const originalCwd = process.cwd();

afterEach(() => {
	process.chdir(originalCwd);
	resetDeployConfigForTests();
	vi.unstubAllGlobals();
});

async function createTenantFixture(configBody: string) {
	const tenantRoot = await mkdtemp(join(tmpdir(), 'treeseed-sdk-deploy-runtime-'));
	await mkdir(join(tenantRoot, 'src'), { recursive: true });
	await writeFile(
		join(tenantRoot, 'src/manifest.yaml'),
		'id: test-site\nsiteConfigPath: ./src/config.yaml\ncontent:\n  pages: ./src/content/pages\n  notes: ./src/content/notes\n  questions: ./src/content/questions\n  objectives: ./src/content/objectives\n  proposals: ./src/content/proposals\n  decisions: ./src/content/decisions\n  people: ./src/content/people\n  agents: ./src/content/agents\n  books: ./src/content/books\n  docs: ./src/content/knowledge\nfeatures:\n  docs: true\n  books: true\n  notes: true\n  questions: true\n  objectives: true\n  proposals: true\n  decisions: true\n  agents: true\n  forms: true\n',
	);
	await writeFile(join(tenantRoot, 'treeseed.site.yaml'), configBody);
	return tenantRoot;
}

async function createEmptyWorkspace() {
	const tenantRoot = await mkdtemp(join(tmpdir(), 'treeseed-sdk-no-config-'));
	await mkdir(join(tenantRoot, 'src'), { recursive: true });
	await writeFile(
		join(tenantRoot, 'src/manifest.yaml'),
		'id: test-site\nsiteConfigPath: ./src/config.yaml\ncontent:\n  pages: ./src/content/pages\n  notes: ./src/content/notes\n  questions: ./src/content/questions\n  objectives: ./src/content/objectives\n  proposals: ./src/content/proposals\n  decisions: ./src/content/decisions\n  people: ./src/content/people\n  agents: ./src/content/agents\n  books: ./src/content/books\n  docs: ./src/content/knowledge\nfeatures:\n  docs: true\n  books: true\n  notes: true\n  questions: true\n  objectives: true\n  proposals: true\n  decisions: true\n  agents: true\n  forms: true\n',
	);
	return tenantRoot;
}

function stubEmbeddedDeployConfig(tenantRoot: string) {
	vi.stubGlobal('__TREESEED_DEPLOY_CONFIG__', loadCliDeployConfig(tenantRoot));
}

describe('deploy runtime accessors', () => {
	it('returns default values when no deploy config is available', async () => {
		const workspaceRoot = await createEmptyWorkspace();
		try {
			process.chdir(workspaceRoot);
			expect(getFormsProvider()).toBe('store_only');
			expect(getOperationsProvider()).toBe('default');
			expect(getAgentProviderSelections()).toMatchObject(DEFAULT_PROVIDER_SELECTIONS.agents);
			expect(getAgentProviderSelections().execution).toBe('codex');
			expect(getDeployProvider()).toBe(DEFAULT_PROVIDER_SELECTIONS.deploy);
			expect(getContentRuntimeProvider()).toBe(DEFAULT_PROVIDER_SELECTIONS.content.runtime);
			expect(getContentPublishProvider()).toBe(DEFAULT_PROVIDER_SELECTIONS.content.publish);
			expect(getDocsProvider()).toBe(DEFAULT_PROVIDER_SELECTIONS.content.docs);
			expect(getSiteProvider()).toBe(DEFAULT_PROVIDER_SELECTIONS.site);
			expect(isSmtpEnabled()).toBe(false);
			expect(isTurnstileEnabled()).toBe(false);
		} finally {
			await rm(workspaceRoot, { recursive: true, force: true });
		}
	});

	it('loads provider selections and feature toggles from deploy config', async () => {
		const tenantRoot = await createTenantFixture(`name: Example Site
slug: example-site
siteUrl: https://example.com
contactEmail: hello@example.com
cloudflare:
  accountId: account-123
plugins:
  - package: '@treeseed/sdk/plugin-default'
providers:
  forms: mailer
  operations: default
  agents:
    execution: github_issues
    mutation: local_branch
    repository: git
    verification: local
    notification: sdk_message
    research: project_graph
  deploy: railway
  content:
    runtime: team_scoped_r2_overlay
    publish: team_scoped_r2_overlay
    docs: custom-docs
  site: alternate-site
smtp:
  enabled: true
turnstile:
  enabled: false
`);

		try {
			process.chdir(tenantRoot);
			stubEmbeddedDeployConfig(tenantRoot);
			expect(getFormsProvider()).toBe('mailer');
			expect(getOperationsProvider()).toBe('default');
			expect(getAgentProviderSelections()).toMatchObject({
				execution: 'github_issues',
				repository: 'git',
				verification: 'local',
			});
			expect(getDeployProvider()).toBe('railway');
			expect(getContentRuntimeProvider()).toBe('team_scoped_r2_overlay');
			expect(getContentPublishProvider()).toBe('team_scoped_r2_overlay');
			expect(getDocsProvider()).toBe('custom-docs');
			expect(getSiteProvider()).toBe('alternate-site');
			expect(isSmtpEnabled()).toBe(true);
			expect(isTurnstileEnabled()).toBe(false);
		} finally {
			await rm(tenantRoot, { recursive: true, force: true });
		}
	});

	it('caches results until reset is called', async () => {
		const tenantRoot = await createTenantFixture(`name: Example Site
slug: example-site
siteUrl: https://example.com
contactEmail: hello@example.com
cloudflare:
  accountId: account-123
plugins:
  - package: '@treeseed/sdk/plugin-default'
providers:
  forms: store_only
  agents:
    execution: codex
    mutation: local_branch
    repository: git
    verification: local
    notification: sdk_message
    research: project_graph
  deploy: cloudflare
  content:
    runtime: team_scoped_r2_overlay
    publish: team_scoped_r2_overlay
    docs: default
  site: default
`);

		try {
			process.chdir(tenantRoot);
			stubEmbeddedDeployConfig(tenantRoot);
			const first = getDeployConfig();
			await writeFile(
				join(tenantRoot, 'treeseed.site.yaml'),
				`name: Changed Site
slug: changed-site
siteUrl: https://changed.example.com
contactEmail: changed@example.com
cloudflare:
  accountId: account-456
plugins:
  - package: '@treeseed/sdk/plugin-default'
providers:
  forms: mailer
  agents:
    execution: workflow
    mutation: local_branch
    repository: git
    verification: local
    notification: sdk_message
    research: project_graph
  deploy: railway
  content:
    runtime: team_scoped_r2_overlay
    publish: team_scoped_r2_overlay
    docs: default
  site: default
`,
			);
			const cached = getDeployConfig();
			expect(cached).toBe(first);
			expect(cached.slug).toBe('example-site');

			resetDeployConfigForTests();
			stubEmbeddedDeployConfig(tenantRoot);

			const reloaded = getDeployConfig();
			expect(reloaded.slug).toBe('changed-site');
		} finally {
			await rm(tenantRoot, { recursive: true, force: true });
		}
	});
});
