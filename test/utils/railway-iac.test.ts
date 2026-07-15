import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
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
	waitForRailwayVolumeDetachment,
	waitForRailwayVolumeName,
	waitForRailwayServiceAbsence,
	type TreeseedRailwayIacProjectInput,
} from '../../src/reconcile/providers/railway-iac.ts';

const railwaySdkMocks = vi.hoisted(() => ({
	getCurrentEnvironment: vi.fn(),
	stageEnvironmentChanges: vi.fn(),
	commitStagedPatch: vi.fn(),
}));

vi.mock('railway/iac', () => ({
	IacClient: class {
		getCurrentEnvironment = railwaySdkMocks.getCurrentEnvironment;
		stageEnvironmentChanges = railwaySdkMocks.stageEnvironmentChanges;
		commitStagedPatch = railwaySdkMocks.commitStagedPatch;
	},
	runRailwayIac: vi.fn(async () => ({ ok: true, diagnostics: [], changeSet: { version: 1, diagnostics: [], changes: [] } })),
}));

const tempRoots = new Set<string>();

function tempRoot() {
	const root = mkdtempSync(join(tmpdir(), 'treeseed-railway-iac-'));
	tempRoots.add(root);
	return root;
}

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
	it('waits for a replaced Railway service identity to disappear', async () => {
		const sleep = vi.fn(async () => {});
		const load = vi.fn()
			.mockResolvedValueOnce([{ id: 'service-01' }])
			.mockResolvedValueOnce([]);

		await expect(waitForRailwayServiceAbsence({
			load,
			serviceId: 'service-01',
			attempts: 2,
			intervalMs: 1,
			sleep,
		})).resolves.toEqual({ attempt: 2 });
		expect(sleep).toHaveBeenCalledOnce();
	});
	it('waits for a pending Railway volume to detach before replacement', async () => {
		const sleep = vi.fn(async () => {});
		const load = vi.fn()
			.mockResolvedValueOnce([{
				id: 'volume-01',
				instances: [{ environmentId: 'prod', serviceId: 'runner-01' }],
			}])
			.mockResolvedValueOnce([{ id: 'volume-01', instances: [] }]);

		await expect(waitForRailwayVolumeDetachment({
			load,
			volumeId: 'volume-01',
			environmentId: 'prod',
			serviceId: 'runner-01',
			attempts: 2,
			intervalMs: 1,
			sleep,
		})).resolves.toEqual({ volume: { id: 'volume-01', instances: [] }, attempt: 2 });
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

describe('Railway IaC runner safety', () => {
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

	it('uses non-destructive merge mode for plan and apply', async () => {
		const railway = await import('railway/iac');
		const { applyRailwayIacProject, planRailwayIacProject } = await import('../../src/reconcile/providers/railway-iac.ts');
		const rendered = renderRailwayIacProject(baseInput('staging'));
		try {
			await planRailwayIacProject(baseInput('staging'), rendered);
			await applyRailwayIacProject(baseInput('staging'), rendered);
			const calls = vi.mocked(railway.runRailwayIac).mock.calls;
			expect(calls.map(([arg]) => arg.backboard?.merge)).toEqual([true, true]);
		} finally {
			cleanupRailwayIacRender(rendered);
		}
	});
});
