import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const resolveRailwayWorkspaceContextMock = vi.fn();

vi.mock('../../src/operations/services/railway-api.ts', async () => {
	const actual = await vi.importActual<typeof import('../../src/operations/services/railway-api.ts')>('../../src/operations/services/railway-api.ts');
	return {
		...actual,
		resolveRailwayWorkspaceContext: resolveRailwayWorkspaceContextMock,
	};
});

function createTenantFixture() {
	const tenantRoot = mkdtempSync(join(tmpdir(), 'treeseed-provider-checks-'));
	mkdirSync(resolve(tenantRoot, 'src'), { recursive: true });
	writeFileSync(resolve(tenantRoot, 'src', 'manifest.yaml'), 'id: test-site\n');
	writeFileSync(resolve(tenantRoot, 'treeseed.site.yaml'), `name: Test Site
slug: test-site
siteUrl: https://example.com
contactEmail: hello@example.com
surfaces:
  api:
    enabled: true
    provider: railway
services:
  api:
    provider: railway
    enabled: true
`);
	return tenantRoot;
}

describe('config provider connection checks', () => {
	it('checks Railway connectivity through the API instead of the CLI whoami path', async () => {
		resolveRailwayWorkspaceContextMock.mockReset();
		resolveRailwayWorkspaceContextMock.mockResolvedValue({ id: 'workspace-1', name: 'knowledge-coop' });
		const { checkTreeseedProviderConnections } = await import('../../src/operations/services/config-runtime.ts');

		const report = await checkTreeseedProviderConnections({
			tenantRoot: createTenantFixture(),
			scope: 'staging',
			env: {},
			valuesOverlay: {
				RAILWAY_API_TOKEN: 'railway-token',
				TREESEED_RAILWAY_WORKSPACE: 'knowledge-coop',
			},
		});

		expect(report.ok).toBe(true);
		expect(resolveRailwayWorkspaceContextMock).toHaveBeenCalledWith(expect.objectContaining({
			workspace: 'knowledge-coop',
		}));
		expect(report.checks.find((check) => check.provider === 'railway')).toMatchObject({
			ready: true,
			detail: 'Railway API token can access workspace knowledge-coop. Project and service existence will be reconciled during bootstrap.',
		});
	});

	it('treats repeated transient Railway API preflight failures as skipped warnings', async () => {
		resolveRailwayWorkspaceContextMock.mockReset();
		resolveRailwayWorkspaceContextMock.mockRejectedValue(new Error('Railway API request timed out after 5000ms.'));
		const { checkTreeseedProviderConnections } = await import('../../src/operations/services/config-runtime.ts');

		const report = await checkTreeseedProviderConnections({
			tenantRoot: createTenantFixture(),
			scope: 'staging',
			env: {},
			valuesOverlay: {
				RAILWAY_API_TOKEN: 'railway-token',
				TREESEED_RAILWAY_WORKSPACE: 'knowledge-coop',
			},
		});

		expect(report.ok).toBe(true);
		expect(report.checks.find((check) => check.provider === 'railway')).toMatchObject({
			ready: false,
			skipped: true,
			warning: true,
			transient: true,
		});
	});
});
