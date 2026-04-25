import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TREESEED_DEFAULT_PROVIDER_SELECTIONS } from '../../src/platform/plugins/constants.ts';
import { loadCliDeployConfig } from '../../src/operations/services/runtime-tools.ts';
import {
	getTreeseedAgentProviderSelections,
	getTreeseedContentPublishProvider,
	getTreeseedContentRuntimeProvider,
	getTreeseedDeployConfig,
	getTreeseedDeployProvider,
	getTreeseedDocsProvider,
	getTreeseedFormsProvider,
	getTreeseedOperationsProvider,
	getTreeseedSiteProvider,
	isTreeseedSmtpEnabled,
	isTreeseedTurnstileEnabled,
	resetTreeseedDeployConfigForTests,
} from '../../src/platform/deploy-runtime.ts';

const originalCwd = process.cwd();

afterEach(() => {
	process.chdir(originalCwd);
	resetTreeseedDeployConfigForTests();
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
			expect(getTreeseedFormsProvider()).toBe('store_only');
			expect(getTreeseedOperationsProvider()).toBe('default');
			expect(getTreeseedAgentProviderSelections()).toMatchObject(TREESEED_DEFAULT_PROVIDER_SELECTIONS.agents);
			expect(getTreeseedDeployProvider()).toBe(TREESEED_DEFAULT_PROVIDER_SELECTIONS.deploy);
			expect(getTreeseedContentRuntimeProvider()).toBe(TREESEED_DEFAULT_PROVIDER_SELECTIONS.content.runtime);
			expect(getTreeseedContentPublishProvider()).toBe(TREESEED_DEFAULT_PROVIDER_SELECTIONS.content.publish);
			expect(getTreeseedDocsProvider()).toBe(TREESEED_DEFAULT_PROVIDER_SELECTIONS.content.docs);
			expect(getTreeseedSiteProvider()).toBe(TREESEED_DEFAULT_PROVIDER_SELECTIONS.site);
			expect(isTreeseedSmtpEnabled()).toBe(false);
			expect(isTreeseedTurnstileEnabled()).toBe(false);
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
    execution: manual
    mutation: local_branch
    repository: git
    verification: local
    notification: stub
    research: stub
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
			expect(getTreeseedFormsProvider()).toBe('mailer');
			expect(getTreeseedOperationsProvider()).toBe('default');
			expect(getTreeseedAgentProviderSelections()).toMatchObject({
				execution: 'manual',
				repository: 'git',
				verification: 'local',
			});
			expect(getTreeseedDeployProvider()).toBe('railway');
			expect(getTreeseedContentRuntimeProvider()).toBe('team_scoped_r2_overlay');
			expect(getTreeseedContentPublishProvider()).toBe('team_scoped_r2_overlay');
			expect(getTreeseedDocsProvider()).toBe('custom-docs');
			expect(getTreeseedSiteProvider()).toBe('alternate-site');
			expect(isTreeseedSmtpEnabled()).toBe(true);
			expect(isTreeseedTurnstileEnabled()).toBe(false);
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
    execution: stub
    mutation: local_branch
    repository: stub
    verification: stub
    notification: stub
    research: stub
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
			const first = getTreeseedDeployConfig();
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
    execution: manual
    mutation: local_branch
    repository: git
    verification: local
    notification: stub
    research: stub
  deploy: railway
  content:
    runtime: team_scoped_r2_overlay
    publish: team_scoped_r2_overlay
    docs: default
  site: default
`,
			);
			const cached = getTreeseedDeployConfig();
			expect(cached).toBe(first);
			expect(cached.slug).toBe('example-site');

			resetTreeseedDeployConfigForTests();
			stubEmbeddedDeployConfig(tenantRoot);

			const reloaded = getTreeseedDeployConfig();
			expect(reloaded.slug).toBe('changed-site');
		} finally {
			await rm(tenantRoot, { recursive: true, force: true });
		}
	});
});
