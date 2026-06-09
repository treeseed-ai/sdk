import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectTreeseedLiveHostedServiceChecks } from '../../src/operations/services/live-hosted-service-checks.ts';

let roots: string[] = [];

afterEach(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
	roots = [];
});

function root() {
	const path = mkdtempSync(resolve(tmpdir(), 'treeseed-live-hosted-'));
	roots.push(path);
	writeFileSync(resolve(path, 'package.json'), '{"name":"@treeseed/market","type":"module"}\n');
	writeFileSync(resolve(path, 'treeseed.site.yaml'), `name: TreeSeed Market
slug: treeseed-market
siteUrl: https://web.example.test
contactEmail: hello@treeseed.ai
hosting:
  kind: treeseed_control_plane
runtime:
  mode: treeseed_managed
surfaces:
  web:
    enabled: true
    provider: cloudflare
    rootDir: .
    publicBaseUrl: https://web.example.test
  api:
    enabled: true
    provider: railway
services:
  api:
    enabled: true
    provider: railway
    rootDir: packages/api
    railway:
      projectName: treeseed-api
      serviceName: treeseed-api
      rootDir: packages/api
      buildCommand: npm run build
      startCommand: npm run start:api
      healthcheckPath: /healthz
  apiDatabase:
    enabled: true
    provider: railway
    railway:
      serviceTargets: [api, operationsRunner]
`);
	return path;
}

describe('live hosted service checks', () => {
	it('marks required missing live observations as failed in strict mode', async () => {
		const report = await collectTreeseedLiveHostedServiceChecks({
			tenantRoot: root(),
			target: 'staging',
			strict: true,
			requireLiveRailway: true,
			requireLiveHttp: false,
			env: {},
		});
		expect(report.summary.failed).toBeGreaterThan(0);
		expect(report.checks.some((check) => check.provider === 'railway' && check.status === 'failed')).toBe(true);
		expect(JSON.stringify(report)).not.toContain('postgres://redacted');
		expect(JSON.stringify(report)).not.toContain('do-not-print');
	});

	it('observes HTTP checks with retry', async () => {
		let attempts = 0;
		const report = await collectTreeseedLiveHostedServiceChecks({
			tenantRoot: root(),
			target: 'staging',
			requireLiveRailway: false,
			requireLiveHttp: true,
			retry: { attempts: 2, intervalMs: 1 },
			fetchImpl: (async () => {
				attempts += 1;
				if (attempts === 1) throw new Error('temporary');
				return new Response('{}', { status: 200 });
			}) as typeof fetch,
		});
		expect(report.checks.find((check) => check.id === 'http:web')?.status).toBe('passed');
	});
});
