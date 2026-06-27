import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	cloudflareDestroyVerification,
	createPersistentDeployTarget,
	destroyTreeseedEnvironmentResources,
	dockerLocalRuntimeResourceOperations,
	loadDeployState,
	setDestroyDockerRunnerForTests,
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
  kind: treeseed_control_plane
  teamId: acme
  projectId: market
runtime:
  mode: treeseed_managed
cloudflare:
  accountId: account-123
  workerName: destroy-test
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
  treeseedDatabase:
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
  operationsRunner:
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
		setDestroyDockerRunnerForTests(null);
	});

	it('preserves data repositories unless deleteData is set', async () => {
		const tenantRoot = createDestroyFixture();
		vi.stubEnv('TREESEED_CLOUDFLARE_ACCOUNT_ID', 'account-123');
		vi.stubEnv('TREESEED_RAILWAY_API_TOKEN', '');

		const result = await destroyTreeseedEnvironmentResources(tenantRoot, {
			target: createPersistentDeployTarget('staging'),
			dryRun: true,
		});

		const cloudflare = result.operations.cloudflare;
		expect(cloudflare.find((entry) => entry.type === 'd1-database')?.status).toBe('skipped');
		expect(cloudflare.find((entry) => entry.type === 'd1-database')?.reason).toBe('data_preserved');
		expect(cloudflare.find((entry) => entry.type === 'r2-bucket')?.status).toBe('skipped');
		expect(result.operations.railway.filter((entry) => ['postgres-service', 'volume'].includes(entry.type)).some((entry) =>
			['planned', 'deleted'].includes(entry.status)
		)).toBe(false);
	});

	it('plans data repository deletion when deleteData is set', async () => {
		const tenantRoot = createDestroyFixture();
		vi.stubEnv('TREESEED_CLOUDFLARE_ACCOUNT_ID', 'account-123');
		vi.stubEnv('TREESEED_RAILWAY_API_TOKEN', '');

		const result = await destroyTreeseedEnvironmentResources(tenantRoot, {
			target: createPersistentDeployTarget('staging'),
			dryRun: true,
			deleteData: true,
		});

		const cloudflare = result.operations.cloudflare;
		expect(cloudflare.find((entry) => entry.type === 'd1-database')?.status).toBe('planned');
		expect(cloudflare.find((entry) => entry.type === 'r2-bucket')?.status).toBe('planned');
		expect(cloudflare.find((entry) => entry.type === 'pages-project')?.status).toBe('skipped');
		expect(cloudflare.find((entry) => entry.type === 'pages-project')?.reason).toBe('shared_web_surface');
		expect(cloudflare.find((entry) => entry.type === 'pages-deployments')?.environment).toBe('preview');
		expect(cloudflare.filter((entry) => entry.type === 'pages-custom-domain').map((entry) => entry.name)).toEqual([
			'staging.destroy.example.com',
		]);
	});

	it('plans shared Pages project deletion only for production delete-data destroys', async () => {
		const tenantRoot = createDestroyFixture();
		vi.stubEnv('TREESEED_CLOUDFLARE_ACCOUNT_ID', 'account-123');
		vi.stubEnv('TREESEED_RAILWAY_API_TOKEN', '');

		const result = await destroyTreeseedEnvironmentResources(tenantRoot, {
			target: createPersistentDeployTarget('prod'),
			dryRun: true,
			deleteData: true,
		});

		const cloudflare = result.operations.cloudflare;
		expect(cloudflare.find((entry) => entry.type === 'pages-project')?.status).toBe('planned');
		expect(cloudflare.find((entry) => entry.type === 'pages-deployments')?.environment).toBe('all');
		expect(cloudflare.filter((entry) => entry.type === 'pages-custom-domain').map((entry) => entry.name)).toEqual([
			'destroy.example.com',
		]);
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

	it('plans local Docker cleanup when local delete-data destroy sees matching resources', async () => {
		const tenantRoot = createDestroyFixture();
		vi.stubEnv('TREESEED_CLOUDFLARE_ACCOUNT_ID', 'account-123');
		vi.stubEnv('TREESEED_RAILWAY_API_TOKEN', '');
		setDestroyDockerRunnerForTests((args: string[]) => {
			if (args[0] === 'info') return { status: 0, stdout: '', stderr: '' };
			if (args[0] === 'ps') return {
				status: 0,
				stdout: [
					'container-1\ttreeseed-market-local-postgres\tpostgres:16',
					'container-2\tunrelated\tpostgres:16',
				].join('\n'),
				stderr: '',
			};
			if (args[0] === 'volume') return {
				status: 0,
				stdout: [
					'treeseed-market-local-postgres-data',
					'treedb_legacy_data',
					'unrelated-data',
				].join('\n'),
				stderr: '',
			};
			if (args[0] === 'network') return {
				status: 0,
				stdout: [
					'network-1\ttreedx_federation_default',
					'network-2\tbridge',
				].join('\n'),
				stderr: '',
			};
			return { status: 1, stdout: '', stderr: 'unexpected docker call' };
		});

		const result = await destroyTreeseedEnvironmentResources(tenantRoot, {
			target: createPersistentDeployTarget('local'),
			dryRun: true,
			deleteData: true,
		});

		expect(result.operations.local.filter((entry) => entry.type.startsWith('docker-')).map((entry) => ({
			type: entry.type,
			name: entry.name,
			status: entry.status,
		}))).toEqual([
			{ type: 'docker-container', name: 'treeseed-market-local-postgres', status: 'planned' },
			{ type: 'docker-volume', name: 'treeseed-market-local-postgres-data', status: 'planned' },
			{ type: 'docker-volume', name: 'treedb_legacy_data', status: 'planned' },
			{ type: 'docker-network', name: 'treedx_federation_default', status: 'planned' },
		]);
	});

	it('deletes local Docker containers before volumes and networks during local delete-data destroy', async () => {
		const tenantRoot = createDestroyFixture();
		const calls: string[][] = [];
		vi.stubEnv('TREESEED_CLOUDFLARE_ACCOUNT_ID', 'account-123');
		vi.stubEnv('TREESEED_RAILWAY_API_TOKEN', '');
		setDestroyDockerRunnerForTests((args: string[]) => {
			calls.push(args);
			if (args[0] === 'info') return { status: 0, stdout: '', stderr: '' };
			if (args[0] === 'ps') return { status: 0, stdout: 'container-1\ttreeseed-market-local-postgres\tpostgres:16\n', stderr: '' };
			if (args[0] === 'volume' && args[1] === 'ls') return { status: 0, stdout: 'treeseed-market-local-postgres-data\n', stderr: '' };
			if (args[0] === 'network' && args[1] === 'ls') return { status: 0, stdout: 'network-1\ttreedx_federation_default\n', stderr: '' };
			return { status: 0, stdout: '', stderr: '' };
		});

		const operations = dockerLocalRuntimeResourceOperations({ dryRun: false });

		expect(operations.filter((entry) => entry.type.startsWith('docker-')).map((entry) => entry.status)).toEqual([
			'deleted',
			'deleted',
			'deleted',
		]);
		expect(calls.filter((args) =>
			args[0] === 'rm'
			|| (args[0] === 'volume' && args[1] === 'rm')
			|| (args[0] === 'network' && args[1] === 'rm')
		)).toEqual([
			['rm', '-f', 'container-1'],
			['volume', 'rm', '-f', 'treeseed-market-local-postgres-data'],
			['network', 'rm', 'network-1'],
		]);
	});

	it('collects Cloudflare API verification counts without Wrangler list output', async () => {
		const tenantRoot = createDestroyFixture();
		vi.stubEnv('TREESEED_CLOUDFLARE_ACCOUNT_ID', 'account-123');
		vi.stubEnv('TREESEED_RAILWAY_API_TOKEN', '');
		const target = createPersistentDeployTarget('staging');
		const deployConfig = loadCliDeployConfig(tenantRoot);
		const state = loadDeployState(tenantRoot, deployConfig, { target });
		const verification = cloudflareDestroyVerification(tenantRoot, deployConfig, state, {
			TREESEED_CLOUDFLARE_ACCOUNT_ID: 'account-123',
			TREESEED_CLOUDFLARE_API_TOKEN: '',
		});

		expect(verification).toMatchObject({
			provider: 'cloudflare',
			method: 'cloudflare-api',
			status: 'clean',
			totalRemaining: 0,
		});
		expect(verification.remaining).toMatchObject({
			pages: 0,
			workers: 0,
			kvNamespaces: 0,
			queues: 0,
			d1Databases: 0,
			r2Buckets: 0,
			turnstileWidgets: 0,
			dnsRecords: 0,
		});
	});
});
