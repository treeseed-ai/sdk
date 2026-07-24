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
describe('Railway IaC plan validation', () => {
it('waits for every asynchronously created service to become observable', async () => {
		let calls = 0;
		const result = await waitForRailwayServices({
			serviceNames: ['runner-01', 'runner-02'],
			load: async () => ++calls === 1 ? [{ name: 'runner-01' }] : [{ name: 'runner-01' }, { name: 'runner-02' }],
			sleep: async () => undefined,
		});
		expect(result).toMatchObject({ attempt: 2 });
	});

it('selects every explicitly allowed sibling resource from the live graph', () => {
		const stagingService = {
			address: 'service.treeseed-api',
			type: 'service',
			name: 'treeseed-api',
			kind: 'github',
		} as any;
		const unrelatedService = {
			address: 'service.unmanaged-service',
			type: 'service',
			name: 'unmanaged-service',
			kind: 'empty',
		} as any;
		const retained = selectRailwayIacRetainedResources({
			currentGraph: {
				version: 1,
				project: { name: 'treeseed-api' },
				environments: [],
				resources: [stagingService, unrelatedService],
				edges: [],
			},
			changeSet: {
				version: 1,
				diagnostics: [],
				changes: [stagingService, unrelatedService].map((resource) => ({
					kind: 'resource.delete',
					path: resource.address,
					address: resource.address,
					previous: resource,
					summary: `Delete service ${resource.name}`,
					severity: 'destructive',
					deployEffect: 'unknown',
				})),
			},
		}, ['treeseed-api']);

		expect(retained).toEqual([stagingService]);
	});

it('rejects deletion of canonical desired resources', () => {
		const result = validateRailwayIacChangeSet({
			version: 1,
			diagnostics: [],
			changes: [{
				kind: 'resource.delete',
				path: 'service.treeseed-api',
				address: 'service.treeseed-api',
				summary: 'Delete service treeseed-api',
				severity: 'destructive',
				deployEffect: 'unknown',
				previous: { address: 'service.treeseed-api', type: 'service', kind: 'empty', name: 'treeseed-api' },
			}],
		} as any, {
			services: ['treeseed-api'],
			volumes: ['treeseed-api-operations-runner-01-volume'],
			database: 'treeseed-api-postgres',
			scope: 'staging',
		});
		expect(result.ok).toBe(false);
		expect(result.blockedReasons.join('\n')).toContain('delete desired resource treeseed-api');
	});

it('rejects same-name replacement of a desired resource during hosting apply', () => {
		const result = validateRailwayIacChangeSet({
			version: 1,
			diagnostics: [],
			changes: [
				{
					kind: 'resource.delete',
					path: 'database.treeseed-api-postgres',
					address: 'database.treeseed-api-postgres',
					summary: 'Delete database treeseed-api-postgres',
					severity: 'destructive',
					deployEffect: 'unknown',
					previous: { address: 'database.treeseed-api-postgres', type: 'database', kind: 'database', engine: 'postgres', image: 'postgres', output: 'DATABASE_URL', name: 'treeseed-api-postgres' },
				},
				{
					kind: 'resource.create',
					path: 'service.treeseed-api-postgres',
					address: 'service.treeseed-api-postgres',
					summary: 'Create service treeseed-api-postgres',
					severity: 'safe',
					deployEffect: 'deploy',
					resource: { address: 'service.treeseed-api-postgres', type: 'service', kind: 'docker-image', name: 'treeseed-api-postgres' },
				},
			],
		} as any, {
			services: ['treeseed-api'],
			volumes: ['treeseed-api-postgres-volume'],
			database: 'treeseed-api-postgres',
			scope: 'staging',
		});
		expect(result.ok).toBe(false);
		expect(result.destructiveChanges).toHaveLength(1);
		expect(result.blockedReasons.join('\n')).toContain('Use the explicit destroy workflow for other deletions');
	});

it('allows deletion only for explicitly recognized obsolete environment aliases', () => {
		const change = (name: string) => ({
			kind: 'resource.delete',
			path: `service.${name}`,
			address: `service.${name}`,
			summary: `Delete service ${name}`,
			severity: 'destructive',
			deployEffect: 'unknown',
			previous: { address: `service.${name}`, type: 'service', kind: 'docker-image', name },
		});
		const result = validateRailwayIacChangeSet({
			version: 1,
			diagnostics: [],
			changes: [change('treeseed-api-production')],
		} as any, {
			services: ['treeseed-api'],
			volumes: [],
			database: null,
			scope: 'prod',
			allowedResourceDeletions: ['treeseed-api-production'],
		});
		expect(result.ok).toBe(true);
		expect(result.destructiveChanges).toHaveLength(1);
	});

it('rejects staging image-source changes and production Git-source changes', () => {
		const staging = validateRailwayIacChangeSet({
			version: 1,
			diagnostics: [],
			changes: [{
				kind: 'resource.update',
				path: 'service.treeseed-api.source',
				address: 'service.treeseed-api',
				field: 'source',
				before: {},
				after: {},
				summary: 'Update service source image treeseed/api:latest',
				severity: 'safe',
				deployEffect: 'deploy',
			}],
		} as any, { services: ['treeseed-api'], volumes: [], database: null, scope: 'staging' });
		const prod = validateRailwayIacChangeSet({
			version: 1,
			diagnostics: [],
			changes: [{
				kind: 'resource.update',
				path: 'service.treeseed-api.source',
				address: 'service.treeseed-api',
				field: 'source',
				before: {},
				after: {},
				summary: 'Update service source github repo treeseed-ai/api branch staging',
				severity: 'safe',
				deployEffect: 'deploy',
			}],
		} as any, { services: ['treeseed-api'], volumes: [], database: null, scope: 'prod' });
		expect(staging.ok).toBe(false);
		expect(prod.ok).toBe(false);
	});
});
