import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
	formatTreeseedHostingAuditReport,
	resolveTreeseedHostingAuditTarget,
	runTreeseedHostingAudit,
} from '../../src/operations/services/hosting-audit.ts';

function createTenantFixture() {
	const tenantRoot = mkdtempSync(join(tmpdir(), 'treeseed-hosting-audit-'));
	mkdirSync(resolve(tenantRoot, 'src'), { recursive: true });
	writeFileSync(resolve(tenantRoot, 'src', 'manifest.yaml'), 'id: audit-site\nsiteConfigPath: ./src/config.yaml\ncontent:\n  pages: ./src/content/pages\n');
	writeFileSync(resolve(tenantRoot, 'treeseed.site.yaml'), `name: Audit Site
slug: audit-site
siteUrl: https://audit.example.com
contactEmail: hello@example.com
hosting:
  kind: hosted_project
  registration: optional
  teamId: team_123
  projectId: project_123
hub:
  mode: treeseed_hosted
runtime:
  mode: treeseed_managed
cloudflare:
  accountId: account-123
  pages:
    projectName: audit-site
    previewProjectName: audit-site-staging
  r2:
    bucketName: audit-site-content
    binding: TREESEED_CONTENT_BUCKET
services:
  api:
    provider: railway
    enabled: false
  workdayManager:
    provider: railway
    enabled: false
  workerRunner:
    provider: railway
    enabled: false
`);
	return tenantRoot;
}

describe('hosting audit', () => {
	it('maps explicit environments to stable reconcile targets', () => {
		const tenantRoot = createTenantFixture();
		expect(resolveTreeseedHostingAuditTarget({ tenantRoot, environment: 'local' })).toMatchObject({
			environment: 'local',
			scope: 'local',
			target: { kind: 'persistent', scope: 'staging' },
		});
		expect(resolveTreeseedHostingAuditTarget({ tenantRoot, environment: 'prod' })).toMatchObject({
			environment: 'prod',
			scope: 'prod',
			target: { kind: 'persistent', scope: 'prod' },
		});
	});

	it('returns a JSON-safe report without leaking configured secret values', async () => {
		const tenantRoot = createTenantFixture();
		const secret = 'super-secret-hosted-github-token';
		const report = await runTreeseedHostingAudit({
			tenantRoot,
			environment: 'local',
			hostKinds: ['repository'],
			env: {},
			valuesOverlay: {
				TREESEED_HOSTED_HUBS_GITHUB_OWNER: 'treeseed-sites',
				TREESEED_HOSTED_HUBS_GITHUB_TOKEN: secret,
			},
		});
		const json = JSON.stringify(report);
		expect(report.environment).toBe('local');
		expect(report.repairMode).toBe(false);
		expect(report.hostKinds).toEqual(['repository']);
		expect(Array.isArray(report.checks)).toBe(true);
		expect(json).not.toContain(secret);
		expect(formatTreeseedHostingAuditReport(report)).not.toContain(secret);
	}, 20_000);

	it('does not require GitHub config when auditing only web and processing hosts', async () => {
		const tenantRoot = createTenantFixture();
		const report = await runTreeseedHostingAudit({
			tenantRoot,
			environment: 'staging',
			hostKinds: ['web', 'processing'],
			env: {
				CLOUDFLARE_API_TOKEN: 'cloudflare-token',
				CLOUDFLARE_ACCOUNT_ID: 'account-123',
				RAILWAY_API_TOKEN: 'railway-token',
				TREESEED_RAILWAY_WORKSPACE: 'knowledge-coop',
			},
			valuesOverlay: {
				TREESEED_HOSTING_KIND: 'hosted_project',
				TREESEED_HOSTING_REGISTRATION: 'optional',
				TREESEED_MARKET_API_BASE_URL: 'https://api.example.com',
				TREESEED_HOSTING_TEAM_ID: 'team_123',
				TREESEED_PROJECT_ID: 'project_123',
			},
		});

		expect(report.hostKinds).toEqual(['web', 'processing']);
		expect(report.checks.some((check) => check.provider === 'github')).toBe(false);
		expect(report.checks.some((check) => check.id === 'config.GH_TOKEN')).toBe(false);
	}, 20_000);
});
