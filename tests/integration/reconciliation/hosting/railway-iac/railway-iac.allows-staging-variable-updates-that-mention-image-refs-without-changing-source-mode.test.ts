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
describe('Railway IaC plan validation', () => {
it('allows staging variable updates that mention image refs without changing source mode', () => {
		const result = validateRailwayIacChangeSet({
			version: 1,
			diagnostics: [],
			changes: [{
				kind: 'resource.update',
				path: 'service.treeseed-api.variables.TREESEED_PUBLIC_TREEDX_IMAGE_REF',
				address: 'service.treeseed-api',
				field: 'variables',
				before: { TREESEED_PUBLIC_TREEDX_IMAGE_REF: '' },
				after: { TREESEED_PUBLIC_TREEDX_IMAGE_REF: 'treeseed/treedx:latest' },
				summary: 'Update service environment variable TREESEED_PUBLIC_TREEDX_IMAGE_REF',
				severity: 'safe',
				deployEffect: 'deploy',
			}],
		} as any, { services: ['treeseed-api'], volumes: [], database: null, scope: 'staging' });

		expect(result.ok).toBe(true);
		expect(result.blockedReasons).toEqual([]);
	});

it('rejects ambiguous staging API source updates even when desired source mode is Git', () => {
		const result = validateRailwayIacChangeSet({
			version: 1,
			diagnostics: [],
			changes: [{
				kind: 'resource.update',
				path: 'service.treeseed-api.source',
				address: 'service.treeseed-api',
				field: 'source',
				before: {},
				after: {},
				summary: 'Update service source image metadata while reconciling existing service',
				severity: 'safe',
				deployEffect: 'deploy',
			}],
		} as any, {
			services: ['treeseed-api'],
			volumes: [],
			database: null,
			scope: 'staging',
			serviceSourceModes: { 'treeseed-api': 'git' },
		});

		expect(result.ok).toBe(false);
		expect(result.blockedReasons.join('\n')).toContain('without confirming a GitHub source');
	});

it('allows staging API source repair when Railway confirms the target is GitHub', () => {
		const result = validateRailwayIacChangeSet({
			version: 1,
			diagnostics: [],
			changes: [{
				kind: 'resource.update',
				path: 'service.treeseed-api.source',
				address: 'service.treeseed-api',
				field: 'source',
				before: { kind: 'docker-image', image: 'treeseed/api:0.6.99' },
				after: { kind: 'github', repository: 'treeseed-ai/api', branch: 'staging' },
				summary: 'Update service source from docker image treeseed/api:0.6.99 to github repo treeseed-ai/api branch staging',
				severity: 'safe',
				deployEffect: 'deploy',
			}],
		} as any, {
			services: ['treeseed-api'],
			volumes: [],
			database: null,
			scope: 'staging',
			serviceSourceModes: { 'treeseed-api': 'git' },
			serviceSourceRefs: { 'treeseed-api': 'github:treeseed-ai/api:staging:.:abc123' },
		});

		expect(result.ok).toBe(true);
		expect(result.blockedReasons).toEqual([]);
	});
});
