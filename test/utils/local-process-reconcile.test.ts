import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runManagedDevAction } from '../../src/reconcile/providers/local-private.ts';

describe('local process reconcile provider', () => {
	it('redacts inherited process environment from managed dev observations', async () => {
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
		expect(serialized).not.toContain('"env"');
		expect(serialized).toContain('"TREESEED_KEY_PASSPHRASE":"<redacted>"');
		expect(serialized).toContain('"PUBLIC_SAFE_VALUE":"<redacted>"');
	});
});
