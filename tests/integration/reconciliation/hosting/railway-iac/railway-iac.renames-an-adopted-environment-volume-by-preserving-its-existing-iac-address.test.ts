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
it('renames an adopted environment volume by preserving its existing IaC address', () => {
		const input = baseInput('staging');
		input.services[1]!.volumeName = 'treeseed-api-operations-runner-staging-01-volume';
		input.services[1]!.volumeAddress = 'volume.treeseed-api-operati-2026-07-14 15:35 UTC';
		const rendered = renderRailwayIacProject(input);
		try {
			expect(rendered.volumeNames).toContain('treeseed-api-operations-runner-staging-01-volume');
			expect(rendered.source).toContain('volume("treeseed-api-operations-runner-staging-01-volume"');
			expect(rendered.source).toContain('address: "volume.treeseed-api-operati-2026-07-14 15:35 UTC"');
		} finally {
			cleanupRailwayIacRender(rendered);
		}
	});

it('detaches moved volumes from retained legacy services in the same desired graph', () => {
		const retained = [{
			address: 'service.treeseed-api-operations-runner-01',
			type: 'service',
			name: 'treeseed-api-operations-runner-01',
			kind: 'github',
			volumeAttachments: {
				'/data': { volume: 'volume.runner-copy', mountPath: '/data' },
			},
			deploy: { requiredMountPath: '/data', sleepApplication: false },
		}] as any;
		const result = detachRetainedRailwayVolumeBindings(retained, [{
			serviceName: 'treeseed-api-operations-runner-staging-01',
			volumeId: 'runner-copy',
			volumeName: 'runner-copy',
			canonicalVolumeName: 'treeseed-api-operations-runner-staging-01-volume',
			mode: 'environment-owned',
			reason: 'test',
		}]);

		expect(result[0]).not.toHaveProperty('volumeAttachments');
		expect(result[0]?.deploy).not.toHaveProperty('requiredMountPath');
	});

it('moves custom domains off retained legacy services in the desired graph', () => {
		const retained = [{
			address: 'service.treeseed-api',
			type: 'service',
			name: 'treeseed-api',
			kind: 'image',
			networking: {
				customDomains: {
					'api.preview.treeseed.dev': {},
					'legacy.example.test': {},
				},
			},
		}] as any;

		const result = detachRetainedRailwayCustomDomains(retained, ['api.preview.treeseed.dev']);

		expect(result[0]?.networking?.customDomains).toEqual({ 'legacy.example.test': {} });
	});

it('renders desired custom domains through Railway IaC networking', () => {
		const input = baseInput('staging');
		input.services[0]!.customDomains = ['api.preview.treeseed.dev'];
		const rendered = renderRailwayIacProject(input);
		try {
			expect(rendered.source).toContain('"customDomains":{"api.preview.treeseed.dev":{}}');
		} finally {
			cleanupRailwayIacRender(rendered);
		}
	});

it('renders the complete API project graph with canonical service and volume names', () => {
		const rendered = renderRailwayIacProject(baseInput('staging'));
		try {
			expect(rendered.serviceNames).toEqual([
				'treeseed-api-staging',
				'treeseed-api-operations-runner-staging-01',
				'public-treedx-node-staging-01',
			]);
			expect(rendered.databaseName).toBe('treeseed-api-postgres');
			expect(rendered.volumeNames).toEqual([
				'treeseed-api-postgres-volume',
				'treeseed-api-operations-runner-staging-01-volume',
				'public-treedx-node-staging-01-volume',
			]);
			expect(rendered.source).toContain('service("treeseed-api-staging"');
			expect(rendered.source).toContain('service("treeseed-api-operations-runner-staging-01"');
			expect(rendered.source).toContain('service("public-treedx-node-staging-01"');
			expect(rendered.source).toContain('service("treeseed-api-postgres"');
			expect(rendered.source).not.toContain('capacity-provider');
		} finally {
			cleanupRailwayIacRender(rendered);
		}
	});

it('renders staging services as Git Dockerfile builds', () => {
		const rendered = renderRailwayIacProject(baseInput('staging'));
		try {
			expect(rendered.source).toContain('github("treeseed-ai/api", {"branch":"staging","rootDirectory":".","commitSha":"abc123"})');
			expect(rendered.source).toContain('"builder":"DOCKERFILE"');
			expect(rendered.source).toContain('"dockerfilePath":"/Dockerfile.api"');
			expect(rendered.source).toContain('"dockerfilePath":"/Dockerfile.operations-runner"');
			expect(rendered.source).toContain('"dockerfilePath":"/Dockerfile"');
			expect(rendered.source).not.toContain('source: image("treeseed/api:');
		} finally {
			cleanupRailwayIacRender(rendered);
		}
	});

it('renders production services as immutable image sources without Git source', () => {
		const rendered = renderRailwayIacProject(baseInput('prod'));
		try {
			expect(rendered.source).toContain('source: image("treeseed/api:1.2.3")');
			expect(rendered.source).toContain('source: image("treeseed/api-operations-runner:1.2.3")');
			expect(rendered.source).toContain('source: image("treeseed/treedx:1.2.3")');
			expect(rendered.source).not.toContain('github(');
			expect(rendered.source).not.toContain('"builder":"DOCKERFILE"');
		} finally {
			cleanupRailwayIacRender(rendered);
		}
	});

it('retains staging sibling resources while rendering production identities', () => {
		const input = baseInput('prod');
		input.retainedResources = [
			{
				address: 'service.treeseed-api',
				type: 'service',
				name: 'treeseed-api',
				kind: 'github',
				source: { type: 'github', repo: 'treeseed-ai/api', branch: 'staging', commitSha: 'staging-sha' },
				variables: { TREESEED_DEPLOY_SOURCE_BRANCH: { type: 'preserve' } },
			} as any,
			{
				address: 'volume.treeseed-api-operations-runner-01-volume',
				type: 'volume',
				name: 'treeseed-api-operations-runner-01-volume',
				config: { region: 'us-east4-eqdc4a' },
			} as any,
		];
		const rendered = renderRailwayIacProject(input);
		try {
			expect(rendered.retainedResourceNames).toEqual(['treeseed-api', 'treeseed-api-operations-runner-01-volume']);
			expect(rendered.source).toContain('const retainedResources =');
			expect(rendered.source).toContain('source: image("treeseed/api:1.2.3")');
		} finally {
			cleanupRailwayIacRender(rendered);
		}
	});
});
