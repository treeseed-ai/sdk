import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	configuredRailwayServices,
	ensureRailwayScheduledJobs,
	planRailwayServiceDeploy,
	resolveRailwayAuthToken,
	validateRailwayDeployPrerequisites,
	verifyRailwayScheduledJobs,
} from '../../src/operations/services/railway-deploy.ts';

const tempRoots = new Set<string>();

async function createTenantFixture() {
	const tenantRoot = await mkdtemp(join(tmpdir(), 'treeseed-sdk-railway-deploy-'));
	tempRoots.add(tenantRoot);
	await mkdir(join(tenantRoot, 'src'), { recursive: true });
	await writeFile(
		join(tenantRoot, 'src/manifest.yaml'),
		'id: test-site\nsiteConfigPath: ./src/config.yaml\ncontent:\n  pages: ./src/content/pages\n',
	);
	await writeFile(
		join(tenantRoot, 'treeseed.site.yaml'),
		`name: Test Site
slug: test-site
siteUrl: https://example.com
contactEmail: hello@example.com
hosting:
  kind: hosted_project
  teamId: acme
  projectId: docs
cloudflare:
  accountId: account-123
services:
  api:
    provider: railway
    enabled: true
    railway:
      projectName: acme-docs
      serviceName: acme-docs-api
      rootDir: .
  worker:
    provider: railway
    enabled: true
    railway:
      projectName: acme-docs
      serviceName: acme-docs-worker
      rootDir: .
  manager:
    provider: railway
    enabled: true
    railway:
      projectId: railway-project-1
      projectName: acme-docs
      serviceId: svc-manager
      serviceName: acme-docs-manager
      startCommand: npm run manager:reconcile
      schedule:
        - "*/5 * * * *"
  workdayStart:
    provider: railway
    enabled: true
    railway:
      projectName: acme-docs
      serviceName: acme-docs-workday-start
      rootDir: .
      startCommand: npm run workday:start
  workdayReport:
    provider: railway
    enabled: true
    railway:
      projectName: acme-docs
      serviceName: acme-docs-workday-report
      rootDir: .
      startCommand: npm run workday:report
`,
	);
	return tenantRoot;
}

function railwayTopologyPayload() {
	return {
		data: {
			me: {
				id: 'user-1',
				name: 'Adrian Webb',
				email: 'adrian@example.com',
				workspaces: [
					{ id: 'workspace-1', name: 'knowledge-coop' },
				],
			},
		},
	};
}

function railwayProjectsPayload() {
	return {
		data: {
			projects: {
				edges: [{
					node: {
						id: 'railway-project-1',
						name: 'acme-docs',
						workspaceId: 'workspace-1',
						environments: {
							edges: [{
								node: {
									id: 'env-production',
									name: 'production',
								},
							}],
						},
						services: {
							edges: [
								{
									node: {
										id: 'svc-manager',
										name: 'acme-docs-manager',
									},
								},
								{
									node: {
										id: 'svc-workday-start',
										name: 'acme-docs-workday-start',
									},
								},
								{
									node: {
										id: 'svc-workday-report',
										name: 'acme-docs-workday-report',
									},
								},
							],
						},
					},
				}],
			},
		},
	};
}

afterEach(async () => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	for (const tenantRoot of tempRoots) {
		await rm(tenantRoot, { recursive: true, force: true });
	}
	tempRoots.clear();
});

describe('railway scheduled jobs', () => {
	it('normalizes prod scope to the Railway production environment by default', async () => {
		const tenantRoot = await createTenantFixture();

		const services = configuredRailwayServices(tenantRoot, 'prod');

		expect(services).toHaveLength(5);
		expect(services.every((service) => service.railwayEnvironment === 'production')).toBe(true);
	});

	it('does not plan recurring schedules for staging bootstrap', async () => {
		const tenantRoot = await createTenantFixture();

		const result = await ensureRailwayScheduledJobs(tenantRoot, 'staging');

		expect(result).toEqual([]);
	});

	it('passes project and environment selectors to Railway deploys', () => {
		const plan = planRailwayServiceDeploy({
			projectId: 'railway-project-1',
			serviceName: 'acme-docs-api',
			railwayEnvironment: 'staging',
			rootDir: '.',
		});

		expect(plan).toMatchObject({
			command: 'railway',
			args: [
				'up',
				'--service',
				'acme-docs-api',
				'--ci',
				'--project',
				'railway-project-1',
				'--environment',
				'staging',
			],
			cwd: '.',
		});
	});

	it('creates a missing schedule and returns its locator for prod deploy', async () => {
		const tenantRoot = await createTenantFixture();
		vi.stubEnv('RAILWAY_API_TOKEN', 'railway-token');
		vi.stubEnv('TREESEED_RAILWAY_ENVIRONMENT_ID', 'env-production');

		const fetchMock = vi.fn(async (_input, init) => {
			const body = JSON.parse(String(init?.body ?? '{}'));
			if (String(body.query).includes('query TreeseedRailwayAuthProfile')) {
				return new Response(JSON.stringify(railwayTopologyPayload()), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			if (String(body.query).includes('query TreeseedRailwayProjects')) {
				return new Response(JSON.stringify(railwayProjectsPayload()), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			if (String(body.query).includes('query TreeseedScheduleList')) {
				return new Response(JSON.stringify({
					data: {
						service: {
							cronTriggers: {
								edges: [],
							},
						},
					},
				}), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			return new Response(JSON.stringify({
				data: {
					cronTriggerCreate: {
						id: 'cron-1',
						name: 'manager:1',
						schedule: '*/5 * * * *',
						command: 'npm run manager:reconcile',
						enabled: true,
						service: { id: 'svc-manager', name: 'manager' },
						environment: { id: 'env-production', name: 'production' },
					},
				},
			}), { status: 200, headers: { 'content-type': 'application/json' } });
		});

		const result = await ensureRailwayScheduledJobs(tenantRoot, 'prod', { fetchImpl: fetchMock as typeof fetch });

		expect(fetchMock).toHaveBeenCalledTimes(4);
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			id: 'cron-1',
			logicalName: 'manager:1',
			status: 'created',
			expression: '*/5 * * * *',
		});
	});

	it('updates a drifted schedule and verifies reconciled jobs', async () => {
		const tenantRoot = await createTenantFixture();
		vi.stubEnv('RAILWAY_API_TOKEN', 'railway-token');
		vi.stubEnv('TREESEED_RAILWAY_ENVIRONMENT_ID', 'env-production');

		const fetchMock = vi.fn(async (_input, init) => {
			const body = JSON.parse(String(init?.body ?? '{}'));
			if (String(body.query).includes('query TreeseedRailwayAuthProfile')) {
				return new Response(JSON.stringify(railwayTopologyPayload()), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			if (String(body.query).includes('query TreeseedRailwayProjects')) {
				return new Response(JSON.stringify(railwayProjectsPayload()), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			if (String(body.query).includes('query TreeseedScheduleList')) {
				return new Response(JSON.stringify({
					data: {
						service: {
							cronTriggers: {
								edges: [{
									node: {
										id: 'cron-1',
										name: 'manager:1',
										schedule: '0 * * * *',
										command: 'npm run manager:old',
										enabled: true,
										service: { id: 'svc-manager', name: 'manager' },
										environment: { id: 'env-production', name: 'production' },
									},
								}],
							},
						},
					},
				}), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			return new Response(JSON.stringify({
				data: {
					cronTriggerUpdate: {
						id: 'cron-1',
						name: 'manager:1',
						schedule: '*/5 * * * *',
						command: 'npm run manager:reconcile',
						enabled: true,
						service: { id: 'svc-manager', name: 'manager' },
						environment: { id: 'env-production', name: 'production' },
					},
				},
			}), { status: 200, headers: { 'content-type': 'application/json' } });
		});

		const ensured = await ensureRailwayScheduledJobs(tenantRoot, 'prod', { fetchImpl: fetchMock as typeof fetch });
		expect(ensured[0]).toMatchObject({
			id: 'cron-1',
			status: 'updated',
			command: 'npm run manager:reconcile',
		});

		const verifyFetchMock = vi.fn(async (_input, init) => {
			const body = JSON.parse(String(init?.body ?? '{}'));
			if (String(body.query).includes('query TreeseedRailwayAuthProfile')) {
				return new Response(JSON.stringify(railwayTopologyPayload()), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			if (String(body.query).includes('query TreeseedRailwayProjects')) {
				return new Response(JSON.stringify(railwayProjectsPayload()), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			return new Response(JSON.stringify({
				data: {
					service: {
						cronTriggers: {
							edges: [{
								node: {
									id: 'cron-1',
									name: 'manager:1',
									schedule: '*/5 * * * *',
									command: 'npm run manager:reconcile',
									enabled: true,
									service: { id: 'svc-manager', name: 'manager' },
									environment: { id: 'env-production', name: 'production' },
								},
							}],
						},
					},
				},
			}), { status: 200, headers: { 'content-type': 'application/json' } });
		});

		const verified = await verifyRailwayScheduledJobs(tenantRoot, 'prod', { fetchImpl: verifyFetchMock as typeof fetch });
		expect(verified.ok).toBe(true);
		expect(verified.checks[0]).toMatchObject({
			id: 'cron-1',
			ok: true,
		});
	});

	it('accepts Railway deploy prerequisites and schedule sync from explicit env overrides', async () => {
		const tenantRoot = await createTenantFixture();
		vi.stubEnv('TREESEED_RAILWAY_ENVIRONMENT_ID', 'env-production');

		expect(() =>
			validateRailwayDeployPrerequisites(tenantRoot, 'prod', {
				env: { RAILWAY_API_TOKEN: 'railway-token' },
			}),
		).not.toThrow();

		const fetchMock = vi.fn(async (_input, init) => {
			const body = JSON.parse(String(init?.body ?? '{}'));
			if (String(body.query).includes('query TreeseedRailwayAuthProfile')) {
				return new Response(JSON.stringify(railwayTopologyPayload()), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			if (String(body.query).includes('query TreeseedRailwayProjects')) {
				return new Response(JSON.stringify(railwayProjectsPayload()), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			if (String(body.query).includes('query TreeseedScheduleList')) {
				expect(init?.headers).toMatchObject({
					authorization: 'Bearer railway-token',
				});
				return new Response(JSON.stringify({
					data: {
						service: {
							cronTriggers: {
								edges: [],
							},
						},
					},
				}), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			return new Response(JSON.stringify({
				data: {
					cronTriggerCreate: {
						id: 'cron-1',
						name: 'manager:1',
						schedule: '*/5 * * * *',
						command: 'npm run manager:reconcile',
						enabled: true,
						service: { id: 'svc-manager', name: 'manager' },
						environment: { id: 'env-production', name: 'production' },
					},
				},
			}), { status: 200, headers: { 'content-type': 'application/json' } });
		});

		const result = await ensureRailwayScheduledJobs(tenantRoot, 'prod', {
			env: { RAILWAY_API_TOKEN: 'railway-token' },
			fetchImpl: fetchMock as typeof fetch,
		});

		expect(result[0]).toMatchObject({
			id: 'cron-1',
			status: 'created',
		});
	});

	it('uses only RAILWAY_API_TOKEN for Railway auth resolution', async () => {
		expect(resolveRailwayAuthToken({
			RAILWAY_API_TOKEN: 'railway-api-token',
		})).toBe('railway-api-token');
		expect(resolveRailwayAuthToken({})).toBe('');
	});
});
