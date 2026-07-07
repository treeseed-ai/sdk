import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	cleanupRailwayIacRender,
	renderRailwayIacProject,
	validateRailwayIacChangeSet,
	type TreeseedRailwayIacProjectInput,
} from '../../src/reconcile/providers/railway-iac.ts';

vi.mock('railway/iac', () => ({
	runRailwayIac: vi.fn(async () => ({ ok: true, diagnostics: [], changeSet: { version: 1, diagnostics: [], changes: [] } })),
}));

const tempRoots = new Set<string>();

function tempRoot() {
	const root = mkdtempSync(join(tmpdir(), 'treeseed-railway-iac-'));
	tempRoots.add(root);
	return root;
}

afterEach(() => {
	for (const root of tempRoots) {
		rmSync(root, { recursive: true, force: true });
	}
	tempRoots.clear();
});

function baseInput(scope: 'staging' | 'prod' = 'staging'): TreeseedRailwayIacProjectInput {
	const git = scope === 'staging';
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
				serviceName: 'treeseed-api',
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
				serviceName: 'treeseed-api-operations-runner-01',
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
				serviceName: 'public-treedx-node-01',
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
	it('renders the complete API project graph with canonical service and volume names', () => {
		const rendered = renderRailwayIacProject(baseInput('staging'));
		try {
			expect(rendered.serviceNames).toEqual([
				'treeseed-api',
				'treeseed-api-operations-runner-01',
				'public-treedx-node-01',
			]);
			expect(rendered.databaseName).toBe('treeseed-api-postgres');
			expect(rendered.volumeNames).toEqual([
				'treeseed-api-postgres-volume',
				'treeseed-api-operations-runner-01-volume',
				'public-treedx-node-01-volume',
			]);
			expect(rendered.source).toContain('service("treeseed-api"');
			expect(rendered.source).toContain('service("treeseed-api-operations-runner-01"');
			expect(rendered.source).toContain('service("public-treedx-node-01"');
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
			expect(rendered.source).toContain('volume("treeseed-api-operations-runner-01-volume"');
			expect(rendered.source).toContain('volume("public-treedx-node-01-volume"');
			expect(rendered.source).toContain('volumeMounts: { "old-db-volume": null, "/var/lib/postgresql/data": dbVolume }');
			expect(rendered.source).toContain('volumeMounts: { "old-runner-volume": null, "/data": vol1 }');
			expect(rendered.source).toContain('volumeMounts: { "/data": vol2 }');
			expect(rendered.source).toContain('"requiredMountPath":"/data"');
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
		expect(result.blockedReasons.join('\n')).toContain('Use the explicit destroy workflow for deletions');
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
