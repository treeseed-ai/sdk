import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
});
