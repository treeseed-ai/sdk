import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ControlPlaneReporter } from '../../src/control-plane.ts';
import {
	monitorProjectPlatform,
	publishProjectContent,
} from '../../src/operations/services/project-platform.ts';

const tempRoots = new Set<string>();

function noopReporter(): ControlPlaneReporter {
	return {
		kind: 'noop',
		enabled: false,
		async reportEnvironment() {},
		async reportResource() {},
		async reportDeployment() {},
		async registerAgentPoolHeartbeat() {},
		async reportScaleDecision() {},
		async reportWorkdaySummary() {},
	};
}

async function createTenantFixture(configExtra = '') {
	const tenantRoot = await mkdtemp(join(tmpdir(), 'treeseed-sdk-project-platform-'));
	tempRoots.add(tenantRoot);
	await mkdir(join(tenantRoot, 'src'), { recursive: true });
	await writeFile(
		join(tenantRoot, 'src/manifest.yaml'),
		'id: test-site\nsiteConfigPath: ./src/config.yaml\ncontent:\n  pages: ./src/content/pages\n  books: ./src/content/books\n  docs: ./src/content/knowledge\n',
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
providers:
  forms: store_only
  agents:
    execution: stub
    mutation: local_branch
    repository: stub
    verification: stub
    notification: stub
    research: stub
  deploy: cloudflare
  content:
    runtime: team_scoped_r2_overlay
    publish: team_scoped_r2_overlay
    docs: default
  site: default
turnstile:
  enabled: false
${configExtra}`,
	);
	return tenantRoot;
}

afterEach(async () => {
	vi.unstubAllGlobals();
	for (const root of tempRoots) {
		await rm(root, { recursive: true, force: true });
	}
	tempRoots.clear();
	delete process.env.TREESEED_API_BASE_URL;
	delete process.env.TREESEED_WORKER_POOL_SCALER;
});

describe('project platform workflow actions', () => {
	it('skips API and agent monitor probes when runtime systems are not selected', async () => {
		const tenantRoot = await createTenantFixture();
		const fetched: string[] = [];
		vi.stubGlobal('fetch', vi.fn(async (input) => {
			fetched.push(String(input));
			return new Response('ok', { status: 200 });
		}));
		process.env.TREESEED_API_BASE_URL = 'https://api.example.com';

		const result = await monitorProjectPlatform({
			tenantRoot,
			scope: 'staging',
			dryRun: true,
			reporter: noopReporter(),
			bootstrapSystems: ['data', 'web'],
		});

		expect(result.checks.apiHealth).toMatchObject({ ok: true, skipped: true, reason: 'api_not_selected' });
		expect(result.checks.agentHealth).toMatchObject({ ok: true, skipped: true, reason: 'agents_not_selected' });
		expect(fetched.every((url) => !url.startsWith('https://api.example.com'))).toBe(true);
	});

	it('fails publish-content preflight with deploy readiness errors before R2 operations', async () => {
		const tenantRoot = await createTenantFixture();

		await expect(publishProjectContent({
			tenantRoot,
			scope: 'staging',
			reporter: noopReporter(),
		})).rejects.toThrow(/Treeseed environment is not ready for deploy \(staging\)/u);
	});
});
