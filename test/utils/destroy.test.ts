import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	createPersistentDeployTarget,
	destroyTreeseedEnvironmentResources,
	loadDeployState,
	shouldDeleteRailwayProjectAfterEnvironmentDestroy,
	writeDeployState,
} from '../../src/operations/services/deploy.ts';
import { loadCliDeployConfig } from '../../src/operations/services/runtime-tools.ts';

function createDestroyFixture() {
	const tenantRoot = mkdtempSync(join(tmpdir(), 'treeseed-destroy-test-'));
	mkdirSync(resolve(tenantRoot, 'src'), { recursive: true });
	writeFileSync(resolve(tenantRoot, 'src/manifest.yaml'), 'id: destroy-test\n');
	writeFileSync(resolve(tenantRoot, 'treeseed.site.yaml'), `name: Destroy Test
slug: destroy-test
siteUrl: https://destroy.example.com
contactEmail: test@example.com
hosting:
  kind: market_control_plane
  teamId: acme
  projectId: market
runtime:
  mode: treeseed_managed
cloudflare:
  accountId: account-123
  workerName: destroy-test
  queueName: agent-work
  dlqName: agent-work-dlq
  pages:
    productionBranch: main
    stagingBranch: staging
  r2:
    manifestKeyTemplate: teams/{teamId}/published/common.json
surfaces:
  web:
    enabled: true
    provider: cloudflare
    publicBaseUrl: https://destroy.example.com
    environments:
      staging:
        domain: staging.destroy.example.com
      prod:
        domain: destroy.example.com
  api:
    enabled: true
    provider: railway
    environments:
      staging:
        domain: api-staging.destroy.example.com
      prod:
        domain: api.destroy.example.com
services:
  marketDatabase:
    enabled: true
    provider: railway
    railway:
      resourceType: postgres
      serviceName: destroy-test-postgres
  api:
    enabled: true
    provider: railway
    railway:
      projectName: destroy-test
      serviceName: destroy-test-api
  marketOperationsRunner:
    enabled: true
    provider: railway
    railway:
      projectName: destroy-test
      serviceName: destroy-test-operations-runner
      runnerPool:
        bootstrapCount: 1
providers:
  deploy: cloudflare
`, 'utf8');
	const target = createPersistentDeployTarget('staging');
	const state = loadDeployState(tenantRoot, loadCliDeployConfig(tenantRoot), { target });
	state.readiness.initialized = true;
	state.pages.projectName = 'acme-market';
	state.pages.url = 'https://acme-market.pages.dev';
	state.content.bucketName = 'acme-market-content';
	state.webCache.webHost = 'staging.destroy.example.com';
	state.webCache.webZoneId = 'zone-123';
	state.webCache.contentHost = 'content.destroy.example.com';
	state.webCache.contentZoneId = 'zone-123';
	writeDeployState(tenantRoot, state, { target });
	return tenantRoot;
}

describe('destroy planning', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('preserves data repositories unless deleteData is set', async () => {
		const tenantRoot = createDestroyFixture();
		vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'account-123');
		vi.stubEnv('RAILWAY_API_TOKEN', '');

		const result = await destroyTreeseedEnvironmentResources(tenantRoot, {
			target: createPersistentDeployTarget('staging'),
			dryRun: true,
		});

		const cloudflare = result.operations.cloudflare;
		expect(cloudflare.find((entry) => entry.type === 'd1-database')?.status).toBe('skipped');
		expect(cloudflare.find((entry) => entry.type === 'd1-database')?.reason).toBe('data_preserved');
		expect(cloudflare.find((entry) => entry.type === 'r2-bucket')?.status).toBe('skipped');
		expect(result.operations.railway.some((entry) => entry.status === 'blocked')).toBe(true);
	});

	it('plans data repository deletion when deleteData is set', async () => {
		const tenantRoot = createDestroyFixture();
		vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'account-123');
		vi.stubEnv('RAILWAY_API_TOKEN', '');

		const result = await destroyTreeseedEnvironmentResources(tenantRoot, {
			target: createPersistentDeployTarget('staging'),
			dryRun: true,
			deleteData: true,
		});

		const cloudflare = result.operations.cloudflare;
		expect(cloudflare.find((entry) => entry.type === 'd1-database')?.status).toBe('planned');
		expect(cloudflare.find((entry) => entry.type === 'r2-bucket')?.status).toBe('planned');
		expect(cloudflare.find((entry) => entry.type === 'pages-project')?.status).toBe('planned');
	});

	it('removes the Railway project when delete-data leaves no managed persistent environments', () => {
		const project = {
			id: 'project-1',
			name: 'destroy-test',
			environments: [
				{ id: 'env-staging', name: 'staging' },
			],
		};

		expect(shouldDeleteRailwayProjectAfterEnvironmentDestroy(project, 'staging', true, 'env-staging')).toBe(true);
	});

	it('keeps the Railway project when production still exists', () => {
		const project = {
			id: 'project-1',
			name: 'destroy-test',
			environments: [
				{ id: 'env-staging', name: 'staging' },
				{ id: 'env-production', name: 'production' },
			],
		};

		expect(shouldDeleteRailwayProjectAfterEnvironmentDestroy(project, 'staging', true, 'env-staging')).toBe(false);
	});
});
