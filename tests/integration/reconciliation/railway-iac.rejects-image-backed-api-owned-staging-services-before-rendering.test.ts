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
it('rejects image-backed API-owned staging services before rendering', () => {
		const input = baseInput('staging');
		input.services[0] = {
			...input.services[0]!,
			sourceMode: 'image',
			sourceRepo: null,
			sourceBranch: null,
			sourceCommit: null,
			sourceRootDirectory: null,
			imageRef: 'treeseed/api:1.2.3',
			dockerfilePath: null,
		};
		expect(() => renderRailwayIacProject(input)).toThrow(/API Railway staging services must use GitHub Dockerfile source builds/u);
	});

it('rejects Git-backed API-owned production services before rendering', () => {
		const input = baseInput('prod');
		input.services[0] = {
			...input.services[0]!,
			sourceMode: 'git',
			sourceRepo: 'treeseed-ai/api',
			sourceBranch: 'staging',
			sourceCommit: 'abc123',
			sourceRootDirectory: '.',
			imageRef: null,
			dockerfilePath: '/Dockerfile.api',
		};
		expect(() => renderRailwayIacProject(input)).toThrow(/API Railway production services must use released Docker image sources/u);
	});

it('mounts runner, TreeDX, and Postgres canonical volumes at their required paths', () => {
		const input = baseInput('staging');
		input.database!.detachVolumeIds = ['old-db-volume'];
		input.services[1]!.detachVolumeIds = ['old-runner-volume'];
		const rendered = renderRailwayIacProject(input);
		try {
			expect(rendered.source).toContain('volume("treeseed-api-postgres-volume"');
			expect(rendered.source).toContain('volume("treeseed-api-operations-runner-staging-01-volume"');
			expect(rendered.source).toContain('volume("public-treedx-node-staging-01-volume"');
			expect(rendered.source).toContain('volumeMounts: { "old-db-volume": null, "/var/lib/postgresql/data": dbVolume }');
			expect(rendered.source).toContain('volumeMounts: { "old-runner-volume": null, "/data": vol1 }');
			expect(rendered.source).toContain('volumeMounts: { "/data": vol2 }');
			expect(rendered.source).not.toContain('"requiredMountPath":"/data"');
			expect(rendered.source).not.toContain('"sleepApplication":false');
			expect(rendered.source).not.toMatch(/deploy: \{[^\n]*"region"/u);
			expect(rendered.source).toContain('regions: {"us-east4-eqdc4a":1}');
		} finally {
			cleanupRailwayIacRender(rendered);
		}
	});

it('renders existing Postgres services as native Railway database resources', () => {
		const input = baseInput('staging');
		input.database!.useNativePostgres = true;
		const rendered = renderRailwayIacProject(input);
		try {
			expect(rendered.source).toContain('const db = postgres("treeseed-api-postgres"');
			expect(rendered.source).not.toContain('const db = service("treeseed-api-postgres"');
			expect(rendered.volumeNames).toContain('treeseed-api-postgres-volume');
		} finally {
			cleanupRailwayIacRender(rendered);
		}
	});

it('rejects invalid generated variables while allowing native TreeDX variables on TreeDX services', () => {
		const rendered = renderRailwayIacProject(baseInput('staging'));
		try {
			expect(rendered.source).toContain('"TREEDX_DATA_DIR": "/data"');
			expect(rendered.source).toContain('"TREEDX_SECRET_KEY_BASE": "secret"');
		} finally {
			cleanupRailwayIacRender(rendered);
		}
		const input = baseInput('staging');
		input.services[0]!.variables = { NODE_ENV: 'production' };
		expect(() => renderRailwayIacProject(input)).toThrow(/invalid generated variables: NODE_ENV/u);
	});
});
