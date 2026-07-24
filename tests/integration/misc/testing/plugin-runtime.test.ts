import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { loadPluginRuntime, loadPlugins } from '../../../../src/platform/plugins/runtime.ts';
import { resetDeployConfigForTests } from '../../../../src/platform/hosting/deploy-runtime.ts';

const originalCwd = process.cwd();

afterEach(() => {
	process.chdir(originalCwd);
	resetDeployConfigForTests();
});

async function createTenantFixture({
	pluginsYaml,
	pluginFiles = {},
}: {
	pluginsYaml: string;
	pluginFiles?: Record<string, string>;
}) {
	const tenantRoot = await mkdtemp(join(tmpdir(), 'treeseed-sdk-plugin-runtime-'));
	await mkdir(join(tenantRoot, 'src'), { recursive: true });
	await mkdir(join(tenantRoot, 'node_modules', '@treeseed', 'sdk'), { recursive: true });
	await writeFile(
		join(tenantRoot, 'src/manifest.yaml'),
		'id: test-site\nsiteConfigPath: ./src/config.yaml\ncontent:\n  pages: ./src/content/pages\n  notes: ./src/content/notes\n  questions: ./src/content/questions\n  objectives: ./src/content/objectives\n  proposals: ./src/content/proposals\n  decisions: ./src/content/decisions\n  people: ./src/content/people\n  agents: ./src/content/agents\n  books: ./src/content/books\n  docs: ./src/content/knowledge\nfeatures:\n  docs: true\n  books: true\n  notes: true\n  questions: true\n  objectives: true\n  proposals: true\n  decisions: true\n  agents: true\n  forms: true\n',
	);
	await writeFile(
		join(tenantRoot, 'treeseed.site.yaml'),
		`name: Example Site
slug: example-site
siteUrl: https://example.com
contactEmail: hello@example.com
cloudflare:
  accountId: account-123
${pluginsYaml}
`,
	);
	await writeFile(
		join(tenantRoot, 'node_modules', '@treeseed', 'sdk', 'package.json'),
		JSON.stringify({
			name: '@treeseed/sdk',
			type: 'commonjs',
			exports: {
				'./plugin-default': './plugin-default.cjs',
			},
		}, null, 2),
	);
	await writeFile(
		join(tenantRoot, 'node_modules', '@treeseed', 'sdk', 'plugin-default.cjs'),
		`module.exports = {
  id: 'treeseed-sdk-default',
  provides: {
    forms: ['store_only'],
    operations: ['default'],
    agents: {
      execution: ['codex'],
      mutation: ['local_branch'],
      repository: ['git'],
      verification: ['local'],
      notification: ['sdk_message'],
      research: ['project_graph'],
      handlers: ['writer', 'actor', 'estimate', 'releaser', 'reporter']
    },
    deploy: ['cloudflare'],
    dns: ['cloudflare-dns'],
    content: {
      runtime: ['team_scoped_r2_overlay'],
      publish: ['team_scoped_r2_overlay'],
      docs: ['default']
    },
    site: ['default']
  }
};`,
	);

	for (const [relativePath, content] of Object.entries(pluginFiles)) {
		await mkdir(dirname(join(tenantRoot, relativePath)), { recursive: true });
		await writeFile(join(tenantRoot, relativePath), content);
	}

	return tenantRoot;
}

describe('sdk plugin runtime', () => {
	it('preserves explicit plugin order and plugin config', async () => {
		const tenantRoot = await createTenantFixture({
			pluginsYaml: `plugins:
  - package: '@treeseed/sdk/plugin-default'
  - package: ./plugin-one.cjs
    config:
      greeting: hello
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
    docs: default
  site: default`,
			pluginFiles: {
				'plugin-one.cjs': `module.exports = {
  id: 'plugin-one',
  provides: {},
  siteHooks(context) {
    return { customCss: [context.pluginConfig.greeting + '.css'] };
  }
};`,
			},
		});

		try {
			process.chdir(tenantRoot);
			const plugins = loadPlugins();

			expect(plugins.map((entry) => entry.package)).toEqual([
				'@treeseed/sdk/plugin-default',
				'./plugin-one.cjs',
			]);
			expect(plugins[1]?.config).toEqual({ greeting: 'hello' });
		} finally {
			await rm(tenantRoot, { recursive: true, force: true });
		}
	});

	it('fails fast when a selected provider is unknown', async () => {
		const tenantRoot = await createTenantFixture({
			pluginsYaml: `plugins:
  - package: '@treeseed/sdk/plugin-default'
providers:
  forms: missing-provider
  agents:
    execution: codex
    mutation: local_branch
    repository: git
    verification: local
    notification: sdk_message
    research: project_graph
  deploy: cloudflare
  content:
    docs: default
  site: default`,
		});

		try {
			process.chdir(tenantRoot);
			expect(() => loadPluginRuntime()).toThrow(/missing-provider/);
		} finally {
			await rm(tenantRoot, { recursive: true, force: true });
		}
	});

	it('resolves the sdk default plugin from the local workspace in tests', async () => {
		const tenantRoot = await createTenantFixture({
			pluginsYaml: `plugins:
  - package: '@treeseed/sdk/plugin-default'
providers:
  forms: store_only
  operations: default
  agents:
    execution: codex
    mutation: local_branch
    repository: git
    verification: local
    notification: sdk_message
    research: project_graph
  deploy: cloudflare
  content:
    docs: default
  site: default`,
		});

		try {
			process.chdir(tenantRoot);
			const runtime = loadPluginRuntime();
			expect(runtime.plugins[0]?.package).toBe('@treeseed/sdk/plugin-default');
		} finally {
			await rm(tenantRoot, { recursive: true, force: true });
		}
	});

	it('resolves Treeseed package plugin subpaths from a local package checkout before installed modules', async () => {
		const tenantRoot = await createTenantFixture({
			pluginsYaml: `plugins:
  - package: '@treeseed/core/plugin-default'
providers:
  forms: store_only
  operations: default
  agents:
    execution: stub
    mutation: local_branch
    repository: stub
    verification: stub
    notification: stub
    research: stub
  deploy: cloudflare
  content:
    docs: default
  site: default`,
			pluginFiles: {
				'packages/core/package.json': JSON.stringify({
					name: '@treeseed/core',
					type: 'module',
				}, null, 2),
				'packages/core/dist/plugin-default.js': `export default {
  id: 'local-core-default',
  provides: {
    forms: ['store_only'],
    operations: ['default'],
    agents: {
      execution: ['stub'],
      mutation: ['local_branch'],
      repository: ['stub'],
      verification: ['stub'],
      notification: ['stub'],
      research: ['stub'],
      handlers: ['planner']
    },
    deploy: ['cloudflare'],
    dns: ['cloudflare-dns'],
    content: {
      runtime: ['team_scoped_r2_overlay'],
      publish: ['team_scoped_r2_overlay'],
      docs: ['default']
    },
    site: ['default']
  }
};`,
			},
		});

		try {
			process.chdir(tenantRoot);
			const runtime = loadPluginRuntime();
			expect(runtime.plugins[0]?.package).toBe('@treeseed/core/plugin-default');
			expect(runtime.plugins[0]?.plugin.id).toBe('local-core-default');
		} finally {
			await rm(tenantRoot, { recursive: true, force: true });
		}
	});
});
