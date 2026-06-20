import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTreeseedIntegratedDevPlan } from '../../src/index.ts';
import { runManagedDevAction } from '../../src/reconcile/providers/local-private.ts';

describe('local process reconcile provider', () => {
	it('omits inherited process environment from managed dev observations', async () => {
		const tenantRoot = mkdtempSync(join(tmpdir(), 'treeseed-local-process-redaction-'));
		const result = await runManagedDevAction({
			tenantRoot,
			action: 'status',
			surfaces: ['web'],
			env: {
				TREESEED_KEY_PASSPHRASE: 'do-not-serialize',
				PUBLIC_SAFE_VALUE: 'visible',
			},
		});

		const serialized = JSON.stringify(result);
		expect(serialized).not.toContain('do-not-serialize');
		expect(serialized).not.toContain('PUBLIC_SAFE_VALUE');
		expect(serialized).not.toContain('TREESEED_KEY_PASSPHRASE');
		expect(serialized).not.toContain('"env"');
		expect(result.parsed?.processes?.[0]?.logPath).toContain('.treeseed/logs/dev/web.log');
	});

	it('injects local API database and service defaults for managed dev processes', () => {
		const tenantRoot = mkdtempSync(join(tmpdir(), 'treeseed-local-process-env-'));
		const plan = createTreeseedIntegratedDevPlan({ cwd: tenantRoot, surfaces: 'web,api,operations-runner' });
		const api = plan.processes.find((entry) => entry.id === 'api');
		const web = plan.processes.find((entry) => entry.id === 'web');
		const runner = plan.processes.find((entry) => entry.id === 'operations-runner');

		expect(api?.port).toBe(3000);
		expect(api?.env.TREESEED_DATABASE_URL).toBe(`postgres://treeseed:treeseed@127.0.0.1:${api?.env.TREESEED_MARKET_LOCAL_POSTGRES_PORT}/market_local`);
		expect(api?.env.TREESEED_API_BASE_URL).toBe('http://127.0.0.1:3000');
		expect(api?.env.TREESEED_PLATFORM_RUNNER_SECRET).toBe('treeseed-platform-runner-dev-secret');
		expect(api?.env.TREESEED_SMTP_PORT).toBe('1025');
		expect(web?.env.TREESEED_MARKET_API_BASE_URL).toBe('http://127.0.0.1:3000');
		expect(runner?.env.TREESEED_DATABASE_URL).toBe(api?.env.TREESEED_DATABASE_URL);
		expect(runner?.env.TREESEED_PLATFORM_RUNNER_ENVIRONMENT).toBe('local');
	});
});
