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
	type TreeseedRailwayIacProjectInput,
} from '../../../src/reconcile/providers/railway-iac.ts';

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

vi.mock('../../../src/operations/services/railway-api.ts', () => ({
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

function baseInput(scope: 'staging' | 'prod' = 'staging'): TreeseedRailwayIacProjectInput {
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
it('continues cleanup when a prior retry already tombstoned the pending volume name', () => {
		const input = baseInput('prod');
		const service = input.services[1]!;
		const liveServices = [{ id: 'runner-prod', name: service.serviceName }];
		const volumes = [{
			id: 'pending-only',
			name: 'pending-delete-pending',
			instances: [{
				environmentId: 'environment-production',
				serviceId: 'runner-prod',
				isPendingDeletion: true,
				state: 'READY',
			}],
		}];

		expect(resolveRailwayIacVolumeBindings({
			environmentId: 'environment-production',
			services: [service],
			liveServices,
			volumes,
		}).blockedReasons).toEqual([]);
		expect(findRailwayPendingVolumeNameCollisions({
			services: [service],
			liveServices,
			volumes,
		})).toEqual([expect.objectContaining({ volumeId: 'pending-only', serviceId: 'runner-prod' })]);
	});

it('ignores pending duplicates when an active canonical volume already exists', () => {
		const service = baseInput('prod').services[1]!;
		const canonicalName = `${service.serviceName}-volume`;
		expect(findRailwayPendingVolumeNameCollisions({
			services: [service],
			liveServices: [{ id: 'runner-prod', name: service.serviceName }],
			volumes: [
				{
					id: 'active-volume',
					name: canonicalName,
					instances: [{ environmentId: 'environment-production', serviceId: 'runner-prod', state: 'READY' }],
				},
				{
					id: 'pending-volume',
					name: canonicalName,
					instances: [{ environmentId: 'environment-production', isPendingDeletion: true, state: 'DELETING' }],
				},
			],
		})).toEqual([]);
	});

it('blocks a canonical volume that has both active and pending attachment records', () => {
		const service = baseInput('prod').services[1]!;
		const canonicalName = `${service.serviceName}-volume`;
		expect(findRailwayPendingVolumeNameCollisions({
			services: [service],
			liveServices: [{ id: 'runner-prod', name: service.serviceName }],
			volumes: [{
				id: 'mixed-volume',
				name: canonicalName,
				instances: [
					{ environmentId: 'environment-production', serviceId: 'runner-prod', state: 'READY' },
					{ environmentId: 'environment-production', serviceId: 'runner-prod', isPendingDeletion: true, state: 'READY' },
				],
			}],
		})).toEqual([expect.objectContaining({ volumeId: 'mixed-volume', serviceId: 'runner-prod' })]);
	});

it('allows canonical volume creation only for services with no prior lineage', () => {
		const input = baseInput('staging');
		const result = resolveRailwayIacVolumeBindings({
			environmentId: 'environment-staging',
			services: input.services,
			liveServices: [],
			volumes: [],
		});

		expect(result).toEqual({ bindings: [], blockedReasons: [] });
	});

it('allows a new pool instance when only sibling instance volumes exist', () => {
		const input = baseInput('staging');
		const secondRunner = {
			...input.services[1]!,
			serviceName: 'treeseed-api-operations-runner-staging-02',
		};
		const result = resolveRailwayIacVolumeBindings({
			environmentId: 'environment-staging',
			services: [secondRunner],
			liveServices: [{ id: 'runner-01', name: 'treeseed-api-operations-runner-staging-01' }],
			volumes: [{
				id: 'runner-01-volume',
				name: 'treeseed-api-operations-runner-staging-01-volume',
				instances: [{ environmentId: 'environment-staging', serviceId: 'runner-01', state: 'READY' }],
			}],
		});

		expect(result).toEqual({ bindings: [], blockedReasons: [] });
	});

it('does not adopt a noncanonical volume already attached to the desired service', () => {
		const input = baseInput('staging');
		const result = resolveRailwayIacVolumeBindings({
			environmentId: 'environment-staging',
			services: [input.services[1]!],
			liveServices: [{ id: 'runner-staging', name: 'treeseed-api-operations-runner-staging-01' }],
			volumes: [{
				id: 'runner-copy',
				name: 'treeseed-api-operati-copy',
				instances: [{ environmentId: 'environment-staging', serviceId: 'runner-staging', state: 'READY' }],
			}],
		});

		expect(result.blockedReasons).toEqual([]);
		expect(result.bindings).toEqual([]);
	});

it('prefers an active canonical environment volume without copying data', () => {
		const input = baseInput('staging');
		const service = input.services[2]!;
		const volumes = [{
			id: 'target-volume',
			name: 'public-treedx-node-staging-01-volume',
			instances: [{ environmentId: 'environment-staging', serviceId: 'treedx-staging', state: 'READY' }],
		}, {
			id: 'shared-volume',
			name: 'public-treedx-node-01-volume',
			instances: [
				{ environmentId: 'environment-staging', serviceId: 'treedx-legacy', state: 'READY' },
				{ environmentId: 'environment-production', serviceId: 'treedx-legacy', state: 'READY' },
			],
		}];
		const liveServices = [
			{ id: 'treedx-staging', name: 'public-treedx-node-staging-01' },
			{ id: 'treedx-legacy', name: 'public-treedx-node-01' },
		];
		const resolved = resolveRailwayIacVolumeBindings({
			environmentId: 'environment-staging',
			services: [service],
			liveServices,
			volumes,
		});
		expect(resolved.bindings).toEqual([expect.objectContaining({ volumeId: 'target-volume', mode: 'canonical' })]);
	});

it('does not adopt another service family volume', () => {
		const input = baseInput('staging');
		const result = resolveRailwayIacVolumeBindings({
			environmentId: 'environment-staging',
			services: [input.services[1]!],
			liveServices: [{ id: 'runner-legacy', name: 'treeseed-api-operations-runner-01' }],
			volumes: [{
				id: 'treedx-copy',
				name: 'public-treedx-node-copy',
				instances: [{ environmentId: 'environment-staging', state: 'READY' }],
			}],
		});

		expect(result.bindings).toEqual([]);
		expect(result.blockedReasons).toEqual([]);
	});
});
