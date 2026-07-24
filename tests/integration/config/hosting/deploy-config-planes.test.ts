import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { loadDeployConfigFromPath } from '../../../../src/platform/hosting/deploy-config.ts';

const tempRoots = new Set<string>();

afterEach(async () => {
	for (const root of tempRoots) {
		await rm(root, { recursive: true, force: true });
	}
	tempRoots.clear();
});

async function writeDeployConfig(body: string) {
	const root = await mkdtemp(join(tmpdir(), 'treeseed-sdk-deploy-config-'));
	tempRoots.add(root);
	const path = join(root, 'treeseed.site.yaml');
	await writeFile(path, body, 'utf8');
	return path;
}

describe('deploy config plane normalization', () => {
	it('resolves projectRoot relative to the TreeSeed tenant root', async () => {
		const configPath = await writeDeployConfig(`name: Test Site
slug: test-site
siteUrl: https://example.com
contactEmail: hello@example.com
projectRoot: ..
cloudflare:
  accountId: account-123
`);

		const config = loadDeployConfigFromPath(configPath) as ReturnType<typeof loadDeployConfigFromPath> & {
			__tenantRoot?: string;
			__projectRoot?: string;
		};
		expect(config.projectRoot).toBe('..');
		expect(config.__tenantRoot).toBe(dirname(configPath));
		expect(config.__projectRoot).toBe(resolve(dirname(configPath), '..'));
	});

	it('defaults to a treeseed-hosted hub without a runtime when no plane or hosting config is present', async () => {
		const configPath = await writeDeployConfig(`name: Test Site
slug: test-site
siteUrl: https://example.com
contactEmail: hello@example.com
cloudflare:
  accountId: account-123
`);

		const config = loadDeployConfigFromPath(configPath);
		expect(config.hub).toMatchObject({ mode: 'treeseed_hosted' });
		expect(config.runtime).toMatchObject({ mode: 'none', registration: 'none' });
		expect(config.hosting).toMatchObject({ kind: 'self_hosted_project', registration: 'none' });
		expect(config.processing).toMatchObject({ mode: 'market-assigned' });
	});

	it('normalizes legacy hosted_project configs into a treeseed-managed runtime plane', async () => {
		const previousApiBaseUrl = process.env.TREESEED_API_BASE_URL;
		delete process.env.TREESEED_API_BASE_URL;
		const configPath = await writeDeployConfig(`name: Test Site
slug: test-site
siteUrl: https://example.com
contactEmail: hello@example.com
hosting:
  kind: hosted_project
  registration: optional
  marketBaseUrl: https://market.example.com
  teamId: team-1
  projectId: project-1
cloudflare:
  accountId: account-123
`);

		try {
			const config = loadDeployConfigFromPath(configPath);
			expect(config.hub).toMatchObject({ mode: 'treeseed_hosted' });
			expect(config.runtime).toMatchObject({
				mode: 'treeseed_managed',
				registration: 'optional',
				marketBaseUrl: 'https://market.example.com',
				teamId: 'team-1',
				projectId: 'project-1',
			});
		} finally {
			if (previousApiBaseUrl === undefined) delete process.env.TREESEED_API_BASE_URL;
			else process.env.TREESEED_API_BASE_URL = previousApiBaseUrl;
		}
	});

	it('honors explicit plane config over legacy hosting defaults', async () => {
		const configPath = await writeDeployConfig(`name: Test Site
slug: test-site
siteUrl: https://example.com
contactEmail: hello@example.com
hosting:
  kind: hosted_project
  registration: optional
hub:
  mode: customer_hosted
runtime:
  mode: byo_attached
  registration: required
  marketBaseUrl: https://market.example.com
  teamId: team-1
  projectId: project-1
cloudflare:
  accountId: account-123
`);

		const config = loadDeployConfigFromPath(configPath);
		expect(config.hub).toMatchObject({ mode: 'customer_hosted' });
		expect(config.runtime).toMatchObject({ mode: 'byo_attached', registration: 'required' });
		expect(config.hosting).toMatchObject({ kind: 'self_hosted_project', registration: 'optional' });
	});

	it('preserves market control plane hosting when explicit plane config is present', async () => {
		const configPath = await writeDeployConfig(`name: Test Market
slug: test-market
siteUrl: https://market.example.com
contactEmail: hello@example.com
hosting:
  kind: treeseed_control_plane
  registration: optional
  teamId: treeseed
  projectId: market
hub:
  mode: treeseed_hosted
runtime:
  mode: treeseed_managed
  registration: none
cloudflare:
  accountId: account-123
`);

		const config = loadDeployConfigFromPath(configPath);
		expect(config.hub).toMatchObject({ mode: 'treeseed_hosted' });
		expect(config.runtime).toMatchObject({ mode: 'treeseed_managed', registration: 'none' });
		expect(config.hosting).toMatchObject({
			kind: 'treeseed_control_plane',
			registration: 'none',
			teamId: 'treeseed',
			projectId: 'market',
		});
	});

	it('parses explicit web cache policy for the public hub surface', async () => {
		const configPath = await writeDeployConfig(`name: Test Site
slug: test-site
siteUrl: https://example.com
contactEmail: hello@example.com
cloudflare:
  accountId: account-123
  zoneId: zone-123
surfaces:
  web:
    provider: cloudflare
    publicBaseUrl: https://example.com
    cache:
      sourcePages:
        browserTtlSeconds: 0
        edgeTtlSeconds: 31536000
        staleWhileRevalidateSeconds: 3600
        staleIfErrorSeconds: 7200
        paths:
          - /
          - /contact
      contentPages:
        browserTtlSeconds: 0
        edgeTtlSeconds: 31536000
        staleWhileRevalidateSeconds: 1800
        staleIfErrorSeconds: 3600
      r2PublishedObjects:
        browserTtlSeconds: 0
        edgeTtlSeconds: 31536000
        staleWhileRevalidateSeconds: 86400
        staleIfErrorSeconds: 86400
`);

		const config = loadDeployConfigFromPath(configPath);
		expect(config.cloudflare.zoneId).toBe('zone-123');
		expect(config.surfaces?.web?.cache?.sourcePages).toMatchObject({
			browserTtlSeconds: 0,
			edgeTtlSeconds: 31536000,
			staleWhileRevalidateSeconds: 3600,
			staleIfErrorSeconds: 7200,
			paths: ['/', '/contact'],
		});
		expect(config.surfaces?.web?.cache?.contentPages).toMatchObject({
			edgeTtlSeconds: 31536000,
			staleWhileRevalidateSeconds: 1800,
		});
		expect(config.surfaces?.web?.cache?.r2PublishedObjects).toMatchObject({
			edgeTtlSeconds: 31536000,
			staleWhileRevalidateSeconds: 86400,
		});
	});

	it('parses provider-aware local runtime config for surfaces and services', async () => {
		const configPath = await writeDeployConfig(`name: Test Site
slug: test-site
siteUrl: https://example.com
contactEmail: hello@example.com
cloudflare:
  accountId: account-123
surfaces:
  web:
    provider: cloudflare
    local:
      runtime: provider
services:
  api:
    provider: railway
    local:
      runtimeMode: local
  worker:
    provider: railway
    local:
      runtime_mode: auto
`);

		const config = loadDeployConfigFromPath(configPath);
		expect(config.surfaces?.web?.local?.runtime).toBe('provider');
		expect(config.services?.api?.local?.runtime).toBe('local');
		expect(config.services?.worker?.local?.runtime).toBe('auto');
		expect(config.processing).toMatchObject({ mode: 'project-owned' });
	});

	it('parses explicit processing capacity assignment', async () => {
		const configPath = await writeDeployConfig(`name: Test Site
slug: test-site
siteUrl: https://example.com
contactEmail: hello@example.com
cloudflare:
  accountId: account-123
processing:
  mode: team-owned
  providerRef: team-default-processing
  requiredCapabilities:
    - graph.refresh
    - task.execute
`);

		const config = loadDeployConfigFromPath(configPath);
		expect(config.processing).toEqual({
			mode: 'team-owned',
			providerRef: 'team-default-processing',
			requiredCapabilities: ['graph.refresh', 'task.execute'],
		});
	});

	it('rejects invalid provider-aware local runtime values', async () => {
		const configPath = await writeDeployConfig(`name: Test Site
slug: test-site
siteUrl: https://example.com
contactEmail: hello@example.com
cloudflare:
  accountId: account-123
surfaces:
  web:
    provider: cloudflare
    local:
      runtime: remote
`);

		expect(() => loadDeployConfigFromPath(configPath)).toThrow(/surfaces\.web\.local\.runtime/u);
	});
});
