import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureRailwayScheduledJobs, verifyRailwayScheduledJobs } from '../../src/operations/services/railway-deploy.ts';

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
cloudflare:
  accountId: account-123
services:
  manager:
    provider: railway
    enabled: true
    railway:
      projectId: railway-project-1
      projectName: Railway Project
      serviceId: svc-manager
      serviceName: manager
      startCommand: npm run manager:reconcile
      schedule:
        - "*/5 * * * *"
`,
	);
	return tenantRoot;
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
	it('creates a missing schedule and returns its locator', async () => {
		const tenantRoot = await createTenantFixture();
		vi.stubEnv('RAILWAY_API_TOKEN', 'railway-token');
		vi.stubEnv('TREESEED_RAILWAY_ENVIRONMENT_ID', 'env-staging');

		const fetchMock = vi.fn(async (_input, init) => {
			const body = JSON.parse(String(init?.body ?? '{}'));
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
						environment: { id: 'env-staging', name: 'staging' },
					},
				},
			}), { status: 200, headers: { 'content-type': 'application/json' } });
		});

		const result = await ensureRailwayScheduledJobs(tenantRoot, 'staging', { fetchImpl: fetchMock as typeof fetch });

		expect(fetchMock).toHaveBeenCalledTimes(2);
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
		vi.stubEnv('TREESEED_RAILWAY_ENVIRONMENT_ID', 'env-staging');

		const fetchMock = vi.fn(async (_input, init) => {
			const body = JSON.parse(String(init?.body ?? '{}'));
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
										environment: { id: 'env-staging', name: 'staging' },
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
						environment: { id: 'env-staging', name: 'staging' },
					},
				},
			}), { status: 200, headers: { 'content-type': 'application/json' } });
		});

		const ensured = await ensureRailwayScheduledJobs(tenantRoot, 'staging', { fetchImpl: fetchMock as typeof fetch });
		expect(ensured[0]).toMatchObject({
			id: 'cron-1',
			status: 'updated',
			command: 'npm run manager:reconcile',
		});

		const verifyFetchMock = vi.fn(async () => new Response(JSON.stringify({
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
								environment: { id: 'env-staging', name: 'staging' },
							},
						}],
					},
				},
			},
		}), { status: 200, headers: { 'content-type': 'application/json' } }));

		const verified = await verifyRailwayScheduledJobs(tenantRoot, 'staging', { fetchImpl: verifyFetchMock as typeof fetch });
		expect(verified.ok).toBe(true);
		expect(verified.checks[0]).toMatchObject({
			id: 'cron-1',
			ok: true,
		});
	});
});
