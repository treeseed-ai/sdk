import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createIntegratedDevPlan } from '../../../../src/index.ts';
import { runManagedDevAction } from '../../../../src/reconcile/providers/local-private.ts';

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
		expect(result.parsed?.plan?.processes?.[0]?.logPath).toContain('.treeseed/logs/dev/web.log');
	});

	it('injects local API database and service defaults for managed dev processes', () => {
		const tenantRoot = mkdtempSync(join(tmpdir(), 'treeseed-local-process-env-'));
		const plan = createIntegratedDevPlan({ cwd: tenantRoot, surfaces: 'web,api,operations-runner' });
		const api = plan.processes.find((entry) => entry.id === 'api');
		const web = plan.processes.find((entry) => entry.id === 'web');
		const runner = plan.processes.find((entry) => entry.id === 'operations-runner');

	expect(api?.port).toBe(3000);
	expect(api?.env.TREESEED_DATABASE_URL).toBe('postgresql://treeseed:treeseed-local-dev@127.0.0.1:54329/treeseed_api');
		expect(api?.env.TREESEED_API_BASE_URL).toBe('http://127.0.0.1:3000');
		expect(api?.env.TREESEED_PLATFORM_RUNNER_SECRET).toBe('treeseed-platform-runner-dev-secret');
		expect(web?.env.TREESEED_MARKET_API_BASE_URL).toBe('http://127.0.0.1:3000');
		expect(runner?.env.TREESEED_DATABASE_URL).toBe(api?.env.TREESEED_DATABASE_URL);
		expect(runner?.env.TREESEED_PLATFORM_RUNNER_ENVIRONMENT).toBe('local');
		expect(runner?.health).toEqual([{ id: 'operations-runner', kind: 'http', url: 'http://127.0.0.1:3001/readyz', timeoutMs: 10_000 }]);
	});
});
