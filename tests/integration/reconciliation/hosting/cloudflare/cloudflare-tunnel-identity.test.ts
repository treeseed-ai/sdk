import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { loadDeployConfigFromPath } from '../../../../../src/platform/hosting/deploy-config.ts';
import { localDevelopmentResources } from '../../../../../src/platform/desired-state/local-development-resources.ts';
import { scopedLocalTunnelIdentity } from '../../../../../src/platform/desired-state/local-tunnel-identity.ts';
import { tunnelConnectorApplyAction } from '../../../../../src/reconcile/builtin-adapters/hosting/cloudflare-tunnel/build-cloudflare-tunnel-adapter.ts';

const roots = new Set<string>();

afterEach(async () => {
	for (const root of roots) await rm(root, { recursive: true, force: true });
	roots.clear();
});

async function tenantRoot() {
	const root = await mkdtemp(join(tmpdir(), 'treeseed-tunnel-identity-'));
	roots.add(root);
	await writeFile(join(root, 'treeseed.site.yaml'), `name: Test Site
slug: test-site
siteUrl: https://example.com
contactEmail: hello@example.com
cloudflare:
  tunnel:
    local:
      enabled: true
      name: local-connectors
      hostname: connect.example.com
      originUrl: http://127.0.0.1:3000
`, 'utf8');
	return root;
}

describe('local Cloudflare Tunnel deployment identity', () => {
	it('is stable for one deployment and distinct across worktree roots', async () => {
		const firstRoot = await tenantRoot();
		const secondRoot = await tenantRoot();
		const first = scopedLocalTunnelIdentity(firstRoot, 'local-connectors', 'connect.example.com');
		const repeated = scopedLocalTunnelIdentity(firstRoot, 'local-connectors', 'connect.example.com');
		const second = scopedLocalTunnelIdentity(secondRoot, 'local-connectors', 'connect.example.com');

		expect(first).toEqual(repeated);
		expect(first.scope).toMatch(/^[a-f0-9]{12}$/u);
		expect(second.scope).not.toBe(first.scope);
		expect(first.name).toBe(`local-connectors-${first.scope}`);
		expect(first.hostname).toBe(`connect-${first.scope}.example.com`);
	});

	it('compiles readable manifest bases into scoped remote resources', async () => {
		const root = await tenantRoot();
		const config = loadDeployConfigFromPath(join(root, 'treeseed.site.yaml'));
		const tunnel = localDevelopmentResources(root, 'local', 'none', [], undefined, config)
			.find((resource) => resource.id === 'cloudflare-tunnel:local-connectors');

		expect(tunnel?.spec).toMatchObject({
			baseName: 'local-connectors',
			baseHostname: 'connect.example.com',
		});
		expect(tunnel?.spec.name).toMatch(/^local-connectors-[a-f0-9]{12}$/u);
		expect(tunnel?.spec.hostname).toMatch(/^connect-[a-f0-9]{12}\.example\.com$/u);
	});

	it('keeps the scoped DNS label within the provider limit', async () => {
		const root = await tenantRoot();
		const identity = scopedLocalTunnelIdentity(root, 'local-connectors', `${'a'.repeat(63)}.example.com`);
		expect(identity.hostname.split('.')[0]).toHaveLength(63);
	});

	it('restarts an existing connector when a scoped Tunnel is created', () => {
		expect(tunnelConnectorApplyAction({ requestedAction: 'start', diffAction: 'create', connectorReady: true })).toBe('restart');
		expect(tunnelConnectorApplyAction({ requestedAction: 'start', diffAction: 'create', connectorReady: false })).toBe('start');
	});
});
