import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { loadTreeseedDeployConfigFromPath } from '../../src/platform/deploy-config.ts';

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
	it('defaults to a treeseed-hosted hub without a runtime when no plane or hosting config is present', async () => {
		const configPath = await writeDeployConfig(`name: Test Site
slug: test-site
siteUrl: https://example.com
contactEmail: hello@example.com
cloudflare:
  accountId: account-123
`);

		const config = loadTreeseedDeployConfigFromPath(configPath);
		expect(config.hub).toMatchObject({ mode: 'treeseed_hosted' });
		expect(config.runtime).toMatchObject({ mode: 'none', registration: 'none' });
		expect(config.hosting).toMatchObject({ kind: 'self_hosted_project', registration: 'none' });
	});

	it('normalizes legacy hosted_project configs into a treeseed-managed runtime plane', async () => {
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

		const config = loadTreeseedDeployConfigFromPath(configPath);
		expect(config.hub).toMatchObject({ mode: 'treeseed_hosted' });
		expect(config.runtime).toMatchObject({
			mode: 'treeseed_managed',
			registration: 'optional',
			marketBaseUrl: 'https://market.example.com',
			teamId: 'team-1',
			projectId: 'project-1',
		});
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

		const config = loadTreeseedDeployConfigFromPath(configPath);
		expect(config.hub).toMatchObject({ mode: 'customer_hosted' });
		expect(config.runtime).toMatchObject({ mode: 'byo_attached', registration: 'required' });
		expect(config.hosting).toMatchObject({ kind: 'self_hosted_project', registration: 'optional' });
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

		const config = loadTreeseedDeployConfigFromPath(configPath);
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

		const config = loadTreeseedDeployConfigFromPath(configPath);
		expect(config.surfaces?.web?.local?.runtime).toBe('provider');
		expect(config.services?.api?.local?.runtime).toBe('local');
		expect(config.services?.worker?.local?.runtime).toBe('auto');
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

		expect(() => loadTreeseedDeployConfigFromPath(configPath)).toThrow(/surfaces\.web\.local\.runtime/u);
	});
});
