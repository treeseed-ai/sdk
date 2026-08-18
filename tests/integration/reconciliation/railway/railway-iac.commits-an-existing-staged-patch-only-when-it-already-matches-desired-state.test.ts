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
} from '../../../../src/reconcile/providers/railway-iac.ts';

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

vi.mock('../../../../src/operations/services/hosting/railway/railway-api.ts', () => ({
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
describe('Railway IaC runner safety', () => {
function emptyRailwayPlan() {
		return {
			ok: true,
			diagnostics: [],
			currentGraph: {
				version: 1,
				project: { name: 'treeseed-api' },
				environments: [],
				resources: [],
				edges: [],
			},
			currentConfig: {},
			changeSet: { version: 1, diagnostics: [], changes: [] },
		} as any;
	}

it('commits an existing staged patch only when it already matches desired state', async () => {
		railwaySdkMocks.getStagedPatch
			.mockResolvedValueOnce({ id: 'patch-1', status: 'PENDING', patch: {}, meta: {} })
			.mockResolvedValueOnce({ id: '<empty>', status: 'EMPTY', patch: {} });
		railwaySdkMocks.commitStagedPatch.mockResolvedValue('commit-1');
		const plan = emptyRailwayPlan();

		await expect(applyRailwayIacProjectWithPlan(baseInput('prod'), undefined, plan)).resolves.toMatchObject({
			command: 'apply',
			stagedPatchId: 'patch-1',
			applyResult: { status: 'APPLIED' },
		});
		expect(railwaySdkMocks.commitStagedPatch).toHaveBeenCalledWith({
			environmentId: 'environment_123',
			message: 'Apply TreeSeed reconciled Railway configuration',
			skipDeploys: false,
		});
		const railway = await import('railway/iac');
		expect(railway.runRailwayIac).not.toHaveBeenCalled();
	});

it('replaces a stale patch with the exact desired patch before committing', async () => {
		railwaySdkMocks.getStagedPatch
			.mockResolvedValueOnce({
				id: 'patch-2',
				status: 'PENDING',
				patch: { services: { unexpected: { isDeleted: true } } },
				meta: {},
			})
			.mockResolvedValueOnce({ id: 'patch-2-replacement', status: 'PENDING', patch: {}, meta: {} })
			.mockResolvedValueOnce(null);
		railwaySdkMocks.stageEnvironmentChanges.mockResolvedValueOnce({ id: 'patch-2-replacement' });

		await expect(applyRailwayIacProjectWithPlan(baseInput('prod'), undefined, emptyRailwayPlan())).resolves.toMatchObject({
			stagedPatchId: 'patch-2-replacement',
		});
		expect(railwaySdkMocks.stageEnvironmentChanges).toHaveBeenCalledWith({
			environmentId: 'environment_123',
			patch: {},
			merge: false,
		});
		expect(railwaySdkMocks.commitStagedPatch).toHaveBeenCalledOnce();
	});

it('blocks stale patch recovery when the plan cannot compile a replacement', async () => {
		railwaySdkMocks.getStagedPatch.mockResolvedValue({ id: 'patch-unprovable', status: 'PENDING', patch: {}, meta: {} });
		await expect(applyRailwayIacProjectWithPlan(baseInput('prod'), undefined, {
			ok: true,
			diagnostics: [],
			changeSet: { changes: [] },
		} as any)).rejects.toThrow(/could not compile a validated replacement/u);
		expect(railwaySdkMocks.stageEnvironmentChanges).not.toHaveBeenCalled();
		expect(railwaySdkMocks.commitStagedPatch).not.toHaveBeenCalled();
	});

it('commits and clears a patch staged by a new Railway apply', async () => {
		railwaySdkMocks.getStagedPatch
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ id: 'patch-3', status: 'PENDING', patch: {}, meta: {} })
			.mockResolvedValueOnce(null);
		railwaySdkMocks.commitStagedPatch.mockResolvedValue('commit-3');
		const railway = await import('railway/iac');
		vi.mocked(railway.runRailwayIac).mockResolvedValueOnce({
			ok: true,
			diagnostics: [],
			changeSet: { changes: [{ kind: 'resource.update' }] },
			stagedPatchId: 'patch-3',
			applyResult: { id: 'apply-3', status: 'APPLIED', changes: [{ kind: 'resource.update', status: 'APPLIED' }], diagnostics: [] },
		} as any);

		await expect(applyRailwayIacProjectWithPlan(baseInput('prod'))).resolves.toMatchObject({ stagedPatchId: 'patch-3' });
		expect(railwaySdkMocks.commitStagedPatch).toHaveBeenCalledOnce();
		expect(railwaySdkMocks.getStagedPatch).toHaveBeenCalledTimes(3);
	});

it('does not ask Railway to apply an explicitly validated empty plan', async () => {
		railwaySdkMocks.getStagedPatch.mockResolvedValueOnce(null);
		const railway = await import('railway/iac');

		await expect(applyRailwayIacProjectWithPlan(baseInput('prod'), undefined, emptyRailwayPlan())).resolves.toMatchObject({
			command: 'apply',
			applyResult: { status: 'APPLIED', changes: [] },
		});
		expect(railway.runRailwayIac).not.toHaveBeenCalled();
		expect(railwaySdkMocks.commitStagedPatch).not.toHaveBeenCalled();
	});

it('fails when Railway replaces the patch while a commit is settling', async () => {
		railwaySdkMocks.getStagedPatch
			.mockResolvedValueOnce({ id: 'patch-4', status: 'PENDING', patch: {}, meta: {} })
			.mockResolvedValueOnce({ id: 'patch-5', status: 'PENDING', patch: {}, meta: {} });

		await expect(applyRailwayIacProjectWithPlan(baseInput('prod'), undefined, emptyRailwayPlan())).rejects.toThrow(/changed from patch-4 to patch-5/u);
	});

it('fails when the patch remains pending after the commit', async () => {
		railwaySdkMocks.getStagedPatch.mockResolvedValue({ id: 'patch-6', status: 'PENDING', patch: {}, meta: {} });
		const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
		vi.useFakeTimers();
		try {
			const result = applyRailwayIacProjectWithPlan(baseInput('prod'), undefined, emptyRailwayPlan());
			const assertion = expect(result).rejects.toThrow(/patch-6 remained pending/u);
			await vi.runAllTimersAsync();
			await assertion;
		} finally {
			vi.useRealTimers();
			stderr.mockRestore();
		}
	});

it('requires a successful apply result for a non-empty change set', () => {
		expect(railwayIacApplyFailure({
			ok: true,
			diagnostics: [],
			changeSet: { changes: [{ kind: 'resource.create' }] },
			applyResult: {
				status: 'FAILED',
				changes: [{ kind: 'resource.create', path: 'service.api', status: 'FAILED' }],
				diagnostics: [{ message: 'service already exists' }],
			},
		} as any)).toContain('service already exists');
	});

it('accepts no-op and fully applied results', () => {
		expect(railwayIacApplyFailure({ ok: true, diagnostics: [], changeSet: { changes: [] } } as any)).toBeNull();
		expect(railwayIacApplyFailure({
			ok: true,
			diagnostics: [],
			changeSet: { changes: [{ kind: 'resource.create' }] },
			applyResult: {
				status: 'APPLIED',
				changes: [{ kind: 'resource.create', path: 'service.api', status: 'APPLIED' }],
				diagnostics: [],
			},
		} as any)).toBeNull();
	});
});
