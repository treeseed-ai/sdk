import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveTreeseedEnvironmentRegistry } from '@treeseed/core/environment';
import { handleDoctor } from '../../src/treeseed/cli/handlers/doctor.ts';
import {
	loadTreeseedMachineConfig,
	resolveTreeseedMachineEnvironmentValues,
	runTreeseedConfigWizard,
	setTreeseedMachineEnvironmentValue,
	syncTreeseedRailwayEnvironment,
} from '../../src/treeseed/scripts/config-runtime-lib.ts';
import { loadCliDeployConfig } from '../../src/treeseed/scripts/package-tools.ts';
import { collectCliPreflight } from '../../src/treeseed/scripts/workspace-preflight-lib.ts';

function createTenantFixture() {
	const tenantRoot = mkdtempSync(join(tmpdir(), 'treeseed-token-auth-test-'));
	mkdirSync(resolve(tenantRoot, 'src'), { recursive: true });
	writeFileSync(resolve(tenantRoot, 'package.json'), JSON.stringify({
		name: 'treeseed-token-auth-fixture',
		private: true,
		workspaces: ['packages/*'],
	}, null, 2));
	writeFileSync(resolve(tenantRoot, 'src', 'manifest.yaml'), 'id: test\nsiteConfigPath: ./src/config.yaml\ncontent:\n  pages: ./src/content/pages\nfeatures:\n  docs: true\n');
	writeFileSync(resolve(tenantRoot, 'treeseed.site.yaml'), `name: Test
slug: test
siteUrl: https://example.com
contactEmail: test@example.com
cloudflare:
  accountId: account-123
  gatewayWorkerName: treeseed-agent-gateway
  queueName: agent-work
  dlqName: agent-work-dlq
services:
  gateway:
    enabled: true
    provider: cloudflare
    cloudflare:
      workerName: treeseed-agent-gateway
  manager:
    enabled: true
    provider: railway
    railway:
      projectName: treeseed-core
      serviceName: treeseed-manager
      rootDir: packages/agent
  worker:
    enabled: true
    provider: railway
    railway:
      projectName: treeseed-core
      serviceName: treeseed-worker
      rootDir: packages/agent
  api:
    enabled: true
    provider: railway
    railway:
      projectName: treeseed-core
      serviceName: treeseed-api
      rootDir: packages/api
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
    docs: default
  site: default
smtp:
  enabled: false
turnstile:
  enabled: false
`, 'utf8');
	return tenantRoot;
}

function setScopedValues(tenantRoot: string, scope: 'local' | 'staging' | 'prod', values: Record<string, string>) {
	const registry = resolveTreeseedEnvironmentRegistry({
		deployConfig: loadCliDeployConfig(tenantRoot),
	});

	for (const [id, value] of Object.entries(values)) {
		const entry = registry.entries.find((candidate) => candidate.id === id);
		if (!entry) {
			throw new Error(`Missing registry entry for ${id}`);
		}
		setTreeseedMachineEnvironmentValue(tenantRoot, scope, entry, value);
	}
}

describe('token-first Treeseed auth', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	});

	it('treats GH_TOKEN, CLOUDFLARE_API_TOKEN, and RAILWAY_API_TOKEN as auth readiness', () => {
		vi.stubEnv('GH_TOKEN', 'ghp_test');
		vi.stubEnv('CLOUDFLARE_API_TOKEN', 'cf_test');
		vi.stubEnv('RAILWAY_API_TOKEN', 'rail_test');

		const report = collectCliPreflight({ cwd: process.cwd(), requireAuth: true });

		expect(report.ok).toBe(true);
		expect(report.failingAuth).toEqual([]);
		expect(report.checks.auth.gh?.authenticated).toBe(true);
		expect(report.checks.auth.wrangler?.authenticated).toBe(true);
		expect(report.checks.auth.railway?.authenticated).toBe(true);
		expect(report.checks.auth.copilot?.configured).toBe(true);
	});

	it('doctor reports missing tokens without consulting CLI login state', () => {
		const tenantRoot = createTenantFixture();
		const result = handleDoctor({
			commandName: 'doctor',
			args: {},
			positionals: [],
			rawArgs: [],
		}, {
			cwd: tenantRoot,
			env: process.env,
			write: () => {},
			spawn: () => ({ status: 0 }),
			outputFormat: 'json',
		});

		const optional = (result.report as { optional: string[] }).optional;
		expect(optional).toContain('Configure `GH_TOKEN` for GitHub CLI automation and Copilot-backed workflows.');
		expect(optional).toContain('Configure `CLOUDFLARE_API_TOKEN` before staging, preview, or production deployment work.');
		expect(optional).toContain('Configure `RAILWAY_API_TOKEN` before deploying the managed Railway services.');
	});

	it('config wizard writes token values into machine config and local env files', async () => {
		const tenantRoot = createTenantFixture();
		const answers: Record<string, string> = {
			GH_TOKEN: 'ghp_local',
			CLOUDFLARE_API_TOKEN: 'cf_local',
			RAILWAY_API_TOKEN: 'rail_local',
		};

		await runTreeseedConfigWizard({
			tenantRoot,
			scopes: ['local'],
			sync: 'none',
			authStatus: collectCliPreflight({ cwd: tenantRoot, requireAuth: false }).checks.auth,
			write: () => {},
			prompt: async (message: string) => {
				const key = message.split('[')[0]?.split(':')[0]?.trim() ?? '';
				return answers[key] ?? '';
			},
		});

		const machineConfig = loadTreeseedMachineConfig(tenantRoot);
		const resolvedValues = resolveTreeseedMachineEnvironmentValues(tenantRoot, 'local');
		expect(machineConfig.environments.local.secrets.GH_TOKEN).toBeTruthy();
		expect(machineConfig.environments.local.secrets.CLOUDFLARE_API_TOKEN).toBeTruthy();
		expect(machineConfig.environments.local.secrets.RAILWAY_API_TOKEN).toBeTruthy();
		expect(resolvedValues.GH_TOKEN).toBe('ghp_local');
		expect(resolvedValues.CLOUDFLARE_API_TOKEN).toBe('cf_local');
		expect(resolvedValues.RAILWAY_API_TOKEN).toBe('rail_local');

		const envLocal = readFileSync(resolve(tenantRoot, '.env.local'), 'utf8');
		const devVars = readFileSync(resolve(tenantRoot, '.dev.vars'), 'utf8');
		expect(envLocal).toContain('GH_TOKEN=ghp_local');
		expect(envLocal).toContain('CLOUDFLARE_API_TOKEN=cf_local');
		expect(envLocal).toContain('RAILWAY_API_TOKEN=rail_local');
		expect(devVars).not.toContain('GH_TOKEN=');
		expect(devVars).not.toContain('CLOUDFLARE_API_TOKEN=');
	});

	it('Railway sync only plans railway-targeted secrets', () => {
		const tenantRoot = createTenantFixture();
		setScopedValues(tenantRoot, 'prod', {
			GH_TOKEN: 'ghp_prod',
			CLOUDFLARE_API_TOKEN: 'cf_prod',
			RAILWAY_API_TOKEN: 'rail_api_prod',
			RAILWAY_TOKEN: 'rail_project_prod',
		});

		const summary = syncTreeseedRailwayEnvironment({ tenantRoot, scope: 'prod', dryRun: true });

		expect(summary.services.length).toBeGreaterThan(0);
		expect(summary.services.every((service) => service.secrets.includes('GH_TOKEN'))).toBe(true);
		expect(summary.services.every((service) => service.secrets.includes('RAILWAY_API_TOKEN'))).toBe(true);
		expect(summary.services.every((service) => service.secrets.includes('RAILWAY_TOKEN'))).toBe(true);
		expect(summary.services.some((service) => service.secrets.includes('CLOUDFLARE_API_TOKEN'))).toBe(false);
	});
});
