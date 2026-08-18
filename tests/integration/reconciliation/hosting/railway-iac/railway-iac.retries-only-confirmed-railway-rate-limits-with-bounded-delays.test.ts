import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync } from 'node:fs';

import { tmpdir } from 'node:os';

import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	applyRailwayIacProjectWithPlan,
	cleanupRailwayIacRender,
	cleanupStaleRailwayIacRenders,
	detachRetainedRailwayVolumeBindings,
	detachRetainedRailwayCustomDomains,
	findRailwayPendingVolumeNameCollisions,
	railwayIacApplyFailure,
	renderRailwayIacProject,
	resolveRailwayIacVolumeBindings,
	runRailwayIacWithRateLimitRetry,
	selectRailwayIacRetainedResources,
	validateRailwayIacChangeSet,
	waitForRailwayServices,
	waitForRailwayVolumeAdoptionResources,
	waitForRailwayVolumeName,
	type RailwayIacProjectInput,
} from '../../../../../src/reconcile/providers/railway-iac.ts';

const railwaySdkMocks = vi.hoisted(() => ({
	runRailwayIac: vi.fn(),
	getStagedPatch: vi.fn(),
	getProjectServices: vi.fn(),
	getCurrentEnvironment: vi.fn(),
	stageEnvironmentChanges: vi.fn(),
	commitStagedPatch: vi.fn(),
}));

vi.mock('railway/iac', async (importOriginal) => {
	const actual = await importOriginal<typeof import('railway/iac')>();
	return {
		...actual,
		IacClient: class {
			getStagedPatch = railwaySdkMocks.getStagedPatch;
			getProjectServices = railwaySdkMocks.getProjectServices;
			getCurrentEnvironment = railwaySdkMocks.getCurrentEnvironment;
			stageEnvironmentChanges = railwaySdkMocks.stageEnvironmentChanges;
			commitStagedPatch = railwaySdkMocks.commitStagedPatch;
		},
		runRailwayIac: railwaySdkMocks.runRailwayIac,
	};
});

vi.mock('../../../../../src/operations/services/hosting/railway/railway-api.ts', () => ({
	railwayGraphqlRequest: vi.fn(async () => ({
		data: { environmentStagedChanges: await railwaySdkMocks.getStagedPatch() },
	})),
}));

const tempRoots = new Set<string>();

function tempRoot() {
	const root = mkdtempSync(join(tmpdir(), 'treeseed-railway-iac-'));
	tempRoots.add(root);
	return root;
}

beforeEach(() => {
	railwaySdkMocks.getStagedPatch.mockReset().mockResolvedValue(null);
	railwaySdkMocks.getProjectServices.mockReset().mockResolvedValue([]);
	railwaySdkMocks.commitStagedPatch.mockReset().mockResolvedValue('commit-1');
	railwaySdkMocks.stageEnvironmentChanges.mockReset().mockResolvedValue({ id: 'staged-patch' });
	railwaySdkMocks.runRailwayIac.mockReset().mockResolvedValue({
		ok: true,
		diagnostics: [],
		changeSet: { version: 1, diagnostics: [], changes: [] },
	});
});

afterEach(() => {
	vi.clearAllMocks();
	for (const root of tempRoots) {
		rmSync(root, { recursive: true, force: true });
	}
	tempRoots.clear();
});

function baseInput(scope: 'staging' | 'prod' = 'staging'): RailwayIacProjectInput {
	const git = scope === 'staging';
	const environmentSuffix = git ? 'staging' : 'production';
	return {
		tenantRoot: tempRoot(),
		projectName: 'treeseed-api',
		projectId: 'project_123',
		environmentName: scope === 'prod' ? 'production' : 'staging',
		environmentId: 'environment_123',
		railwayApiToken: 'token_12345678',
		services: [
			{
				key: 'api',
				serviceName: `treeseed-api-${environmentSuffix}`,
				sourceMode: git ? 'git' : 'image',
				sourceRepo: git ? 'treeseed-ai/api' : null,
				sourceBranch: git ? 'staging' : null,
				sourceCommit: git ? 'abc123' : null,
				sourceRootDirectory: git ? '.' : null,
				imageRef: git ? null : 'treeseed/api:1.2.3',
				dockerfilePath: git ? '/Dockerfile.api' : null,
				startCommand: git ? 'node dist/server.js' : null,
				healthcheckPath: '/healthz',
				variables: { TREESEED_API_MODE: 'hosted' },
				secrets: { TREESEED_DATABASE_URL: '${{treeseed-api-postgres.DATABASE_URL}}' },
			},
			{
				key: 'operationsRunner:1',
				serviceName: `treeseed-api-operations-runner-${environmentSuffix}-01`,
				sourceMode: git ? 'git' : 'image',
				sourceRepo: git ? 'treeseed-ai/api' : null,
				sourceBranch: git ? 'staging' : null,
				sourceCommit: git ? 'abc123' : null,
				sourceRootDirectory: git ? '.' : null,
				imageRef: git ? null : 'treeseed/api-operations-runner:1.2.3',
				dockerfilePath: git ? '/Dockerfile.operations-runner' : null,
				startCommand: git ? 'node dist/operations-runner.js' : null,
				volumeMountPath: '/data',
				variables: { TREESEED_MANAGER_ID: 'staging' },
				secrets: { TREESEED_DATABASE_URL: '${{treeseed-api-postgres.DATABASE_URL}}' },
			},
			{
				key: 'public-treedx-node-01',
				serviceName: `public-treedx-node-${environmentSuffix}-01`,
				sourceMode: git ? 'git' : 'image',
				sourceRepo: git ? 'treeseed-ai/treedx' : null,
				sourceBranch: git ? 'staging' : null,
				sourceCommit: git ? 'abc123' : null,
				sourceRootDirectory: git ? '.' : null,
				imageRef: git ? null : 'treeseed/treedx:1.2.3',
				dockerfilePath: git ? '/Dockerfile' : null,
				startCommand: git ? '/app/bin/server' : null,
				volumeMountPath: '/data',
				variables: { TREEDX_DATA_DIR: '/data', PORT: '4000' },
				secrets: { TREEDX_SECRET_KEY_BASE: 'secret' },
			},
		],
		database: {
			serviceName: 'treeseed-api-postgres',
			environmentVariable: 'TREESEED_DATABASE_URL',
			mountPath: '/var/lib/postgresql/data',
		},
	};
}
describe('Railway IaC project rendering', () => {
it('retries only confirmed Railway rate limits with bounded delays', async () => {
		const run = vi.fn()
			.mockRejectedValueOnce(new Error('Railway GraphQL request failed with HTTP 429.'))
			.mockResolvedValue({ ok: true });
		const sleep = vi.fn(async () => {});
		const onRetry = vi.fn();
		const onWait = vi.fn();

		await expect(runRailwayIacWithRateLimitRetry(run, {
			delaysMs: [30_001],
			sleep,
			onRetry,
			onWait,
		})).resolves.toEqual({ ok: true });
		expect(run).toHaveBeenCalledTimes(2);
		expect(sleep).toHaveBeenNthCalledWith(1, 15_000);
		expect(sleep).toHaveBeenNthCalledWith(2, 15_000);
		expect(sleep).toHaveBeenNthCalledWith(3, 1);
		expect(onRetry).toHaveBeenCalledWith(2, 30_001, expect.any(Error));
		expect(onWait).toHaveBeenNthCalledWith(1, 2, 15_001);
		expect(onWait).toHaveBeenNthCalledWith(2, 2, 1);
		await expect(runRailwayIacWithRateLimitRetry(
			vi.fn().mockResolvedValueOnce({ ok: false, diagnostics: [{ message: 'fetch failed' }] }).mockResolvedValue({ ok: true }),
			{ delaysMs: [1], sleep },
		)).resolves.toEqual({ ok: true });
		await expect(runRailwayIacWithRateLimitRetry(
			async () => { throw new Error('invalid source'); },
			{ delaysMs: [1], sleep },
		)).rejects.toThrow('invalid source');
	});

it('waits for adopted services and volumes to become observable', async () => {
		const sleep = vi.fn(async () => {});
		const load = vi.fn()
			.mockResolvedValueOnce({ services: [], volumes: [] })
			.mockResolvedValueOnce({ services: [{ name: 'runner-01' }], volumes: [{ id: 'volume-01' }] });

		await expect(waitForRailwayVolumeAdoptionResources({
			load,
			serviceName: 'runner-01',
			volumeId: 'volume-01',
			attempts: 2,
			intervalMs: 1,
			sleep,
		})).resolves.toEqual({
			service: { name: 'runner-01' },
			volume: { id: 'volume-01' },
			services: [{ name: 'runner-01' }],
			volumes: [{ id: 'volume-01' }],
			attempt: 2,
		});
		expect(sleep).toHaveBeenCalledOnce();
	});

it('waits for a pending Railway volume name to leave the canonical namespace', async () => {
		const sleep = vi.fn(async () => {});
		const load = vi.fn()
			.mockResolvedValueOnce([{ id: 'volume-01', name: 'runner-01-volume' }])
			.mockResolvedValueOnce([{ id: 'volume-01', name: 'pending-delete-volume' }]);

		await expect(waitForRailwayVolumeName({
			load,
			volumeId: 'volume-01',
			expectedName: 'pending-delete-volume',
			attempts: 2,
			intervalMs: 1,
			sleep,
		})).resolves.toEqual({
			volume: { id: 'volume-01', name: 'pending-delete-volume' },
			attempt: 2,
		});
		expect(sleep).toHaveBeenCalledOnce();
	});

it('reclaims only aged Railway IaC render directories', () => {
		const tenantRoot = tempRoot();
		const tempDir = join(tenantRoot, '.treeseed', 'tmp');
		const stale = join(tempDir, 'railway-iac-stale');
		const active = join(tempDir, 'railway-iac-active');
		const unrelated = join(tempDir, 'other-tool-stale');
		mkdirSync(stale, { recursive: true });
		mkdirSync(active, { recursive: true });
		mkdirSync(unrelated, { recursive: true });
		const now = Date.now();
		const staleTime = (now - 20 * 60 * 1000) / 1000;
		utimesSync(stale, staleTime, staleTime);

		expect(cleanupStaleRailwayIacRenders(tenantRoot, now)).toEqual([stale]);
		expect(() => statSync(stale)).toThrow();
		expect(statSync(active).isDirectory()).toBe(true);
		expect(statSync(unrelated).isDirectory()).toBe(true);
	});

it('does not adopt cross-environment volumes into new qualified services', () => {
		const input = baseInput('staging');
		const result = resolveRailwayIacVolumeBindings({
			environmentId: 'environment-staging',
			services: input.services,
			liveServices: [
				{ id: 'runner-legacy', name: 'treeseed-api-operations-runner-01' },
				{ id: 'treedx-legacy', name: 'public-treedx-node-01' },
			],
			volumes: [
				{
					id: 'runner-shared',
					name: 'treeseed-api-operations-runner-01-volume',
					instances: [
						{ environmentId: 'environment-production', serviceId: 'runner-legacy', state: 'READY' },
						{ environmentId: 'environment-staging', serviceId: null, state: 'READY' },
					],
				},
				{
					id: 'runner-copy',
					name: 'treeseed-api-operati-2026-07-14 15:35 UTC',
					instances: [{ environmentId: 'environment-staging', serviceId: null, state: 'READY' }],
				},
				{
					id: 'runner-pending',
					name: 'treeseed-api-operations-runner-staging-01-volume',
					instances: [{
						environmentId: 'environment-staging',
						serviceId: null,
						state: 'READY',
						isPendingDeletion: true,
						deletedAt: '2026-07-16T00:00:00.000Z',
					}],
				},
				{
					id: 'treedx-shared',
					name: 'public-treedx-node-01-volume',
					instances: [
						{ environmentId: 'environment-production', serviceId: 'treedx-legacy', state: 'READY' },
						{ environmentId: 'environment-staging', serviceId: 'treedx-legacy', state: 'READY' },
					],
				},
			],
		});

		expect(result.blockedReasons).toEqual([]);
		expect(result.bindings).toEqual([]);
	});

it('releases a pending-only canonical volume name for deterministic replacement', () => {
		const input = baseInput('staging');
		const result = resolveRailwayIacVolumeBindings({
			environmentId: 'environment-staging',
			services: input.services,
			liveServices: [],
			volumes: [{
				id: 'pending-only',
				name: 'treeseed-api-operations-runner-staging-01-volume',
				instances: [{ environmentId: 'environment-staging', isPendingDeletion: true, state: 'READY' }],
			}],
		});

		expect(result.bindings).toEqual([]);
		expect(result.blockedReasons).toEqual([]);
	});
});
