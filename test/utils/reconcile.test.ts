import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTreeseedReconcileRegistry, deriveTreeseedDesiredUnits } from '../../src/reconcile/index.ts';

function createTenantFixture(withPlugin = false) {
	const tenantRoot = mkdtempSync(join(tmpdir(), 'treeseed-reconcile-test-'));
	mkdirSync(resolve(tenantRoot, 'src'), { recursive: true });
	writeFileSync(resolve(tenantRoot, 'src', 'manifest.yaml'), 'id: test\nsiteConfigPath: ./src/config.yaml\ncontent:\n  pages: ./src/content/pages\n');
	if (withPlugin) {
		const pluginPath = resolve(tenantRoot, 'duplicate-plugin.cjs');
		writeFileSync(pluginPath, `module.exports = {
  provides: { reconcile: { providers: ['cloudflare'] } },
  reconcileAdapters: {
    duplicateQueue() {
      return {
        providerId: 'cloudflare',
        unitTypes: ['queue'],
        supports(unitType, providerId) { return unitType === 'queue' && providerId === 'cloudflare'; },
        observe() { return { exists: true, status: 'ready', live: {}, locators: {}, warnings: [] }; },
        plan() { return { action: 'noop', reasons: ['duplicate'], before: {}, after: {} }; },
        reconcile(input) { return { unit: input.unit, observed: input.observed, diff: input.diff, action: 'noop', warnings: [], resourceLocators: {}, state: {}, verification: null }; },
        verify(input) { return { unitId: input.unit.unitId, supported: true, exists: true, configured: true, ready: true, verified: true, checks: [], missing: [], drifted: [], warnings: [] }; }
      };
    }
  }
};`);
		writeFileSync(resolve(tenantRoot, 'treeseed.site.yaml'), `name: Test
slug: test
siteUrl: https://example.com
contactEmail: test@example.com
hosting:
  kind: self_hosted_project
  teamId: acme
  projectId: docs
cloudflare:
  accountId: account-123
runtime:
  mode: treeseed_managed
services:
  api:
    enabled: true
    provider: railway
plugins:
  - package: ./duplicate-plugin.cjs
`);
		return tenantRoot;
	}
	writeFileSync(resolve(tenantRoot, 'treeseed.site.yaml'), `name: Test
slug: test
siteUrl: https://example.com
contactEmail: test@example.com
hosting:
  kind: self_hosted_project
  teamId: acme
  projectId: docs
cloudflare:
  accountId: account-123
runtime:
  mode: treeseed_managed
services:
  api:
    enabled: true
    provider: railway
`);
	return tenantRoot;
}

describe('reconcile registry and desired units', () => {
	beforeEach(() => {
		vi.stubEnv('HOME', mkdtempSync(join(tmpdir(), 'treeseed-reconcile-home-')));
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('uses treeseed as the composite provider for runtime and surface units', () => {
		const tenantRoot = createTenantFixture();
		const { units } = deriveTreeseedDesiredUnits({
			tenantRoot,
			target: { kind: 'persistent', scope: 'staging' },
		});

		expect(units.find((unit) => unit.unitType === 'web-ui')?.provider).toBe('treeseed');
		expect(units.find((unit) => unit.unitType === 'api-runtime')?.provider).toBe('treeseed');
		expect(units.find((unit) => unit.unitType === 'railway-service:api')?.provider).toBe('railway');
	});

	it('normalizes workday railway units to registered kebab-case names', () => {
		const tenantRoot = mkdtempSync(join(tmpdir(), 'treeseed-reconcile-workday-'));
		mkdirSync(resolve(tenantRoot, 'src'), { recursive: true });
		writeFileSync(resolve(tenantRoot, 'src', 'manifest.yaml'), 'id: test\nsiteConfigPath: ./src/config.yaml\ncontent:\n  pages: ./src/content/pages\n');
		writeFileSync(resolve(tenantRoot, 'treeseed.site.yaml'), `name: Test
slug: test
siteUrl: https://example.com
contactEmail: test@example.com
hosting:
  kind: self_hosted_project
  teamId: acme
  projectId: docs
cloudflare:
  accountId: account-123
runtime:
  mode: treeseed_managed
services:
  workdayStart:
    enabled: true
    provider: railway
  workdayReport:
    enabled: true
    provider: railway
`);
		const { units } = deriveTreeseedDesiredUnits({
			tenantRoot,
			target: { kind: 'persistent', scope: 'staging' },
		});
		const unitTypes = units.map((unit) => unit.unitType);
		expect(unitTypes).toContain('railway-service:workday-start');
		expect(unitTypes).toContain('railway-service:workday-report');
		expect(unitTypes).not.toContain('railway-service:workdayStart');
		expect(unitTypes).not.toContain('railway-service:workdayReport');
	});

	it('rejects duplicate reconcile adapter bindings', () => {
		const tenantRoot = createTenantFixture(true);
		const { deployConfig } = deriveTreeseedDesiredUnits({
			tenantRoot,
			target: { kind: 'persistent', scope: 'staging' },
		});

		expect(() => createTreeseedReconcileRegistry(deployConfig)).toThrow(/Duplicate Treeseed reconcile adapter binding/);
	});

	it('derives identity-based shared and scoped resource names', () => {
		const tenantRoot = createTenantFixture();
		const { units } = deriveTreeseedDesiredUnits({
			tenantRoot,
			target: { kind: 'persistent', scope: 'staging' },
		});

		expect(units.find((unit) => unit.unitType === 'pages-project')?.logicalName).toBe('acme-docs');
		expect(units.find((unit) => unit.unitType === 'content-store')?.logicalName).toBe('acme-docs-content');
		expect(units.find((unit) => unit.unitType === 'queue')?.logicalName).toBe('acme-docs-agent-work-staging');
		expect(units.find((unit) => unit.unitType === 'database')?.logicalName).toBe('acme-docs-site-data-staging');
		expect(units.find((unit) => unit.unitType === 'queue')?.identity).toMatchObject({
			teamId: 'acme',
			projectId: 'docs',
			deploymentKey: 'acme-docs',
			environmentKey: 'acme-docs-staging',
		});
	});

	it('derives deterministic staging preview domains and DNS policies', () => {
		const tenantRoot = createTenantFixture();
		const { units } = deriveTreeseedDesiredUnits({
			tenantRoot,
			target: { kind: 'persistent', scope: 'staging' },
		});

		expect(units.find((unit) => unit.unitType === 'custom-domain:web')?.logicalName)
			.toBe('acme-docs-staging-57cbdcb5.example.com');
		expect(units.find((unit) => unit.unitType === 'custom-domain:api')?.logicalName)
			.toBe('api-acme-docs-staging-15eec347.example.com');

		const webDnsUnit = units.find((unit) => unit.unitType === 'dns-record' && unit.logicalName === 'web:acme-docs-staging-57cbdcb5.example.com');
		const apiDnsUnit = units.find((unit) => unit.unitType === 'dns-record' && unit.logicalName === 'api:api-acme-docs-staging-15eec347.example.com');

		expect(webDnsUnit?.spec).toMatchObject({
			recordName: 'acme-docs-staging-57cbdcb5.example.com',
			proxied: true,
		});
		expect(apiDnsUnit?.spec).toMatchObject({
			domain: 'api-acme-docs-staging-15eec347.example.com',
		});
	});
});
