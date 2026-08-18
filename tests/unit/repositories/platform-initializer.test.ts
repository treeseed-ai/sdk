import { mkdtempSync,readFileSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { expect,test } from 'vitest';
import { persistPlatformMachineIdentity } from '../../../src/operations/services/repositories/platform-initializer.ts';

test('Platform initialization persists portable identity outside tracked source', () => {
	const root = mkdtempSync(resolve(tmpdir(), 'platform-machine-identity-'));
	try {
		writeFileSync(resolve(root, 'treeseed.site.yaml'), `name: Platform\nslug: platform\nsiteUrl: https://example.test\ncontactEmail: test@example.test\n`, 'utf8');
		expect(persistPlatformMachineIdentity(root, ' treeseed ')).toEqual({
			teamId: 'treeseed',
			projectId: 'platform',
		});
		const config = parse(readFileSync(resolve(root, '.treeseed/config/machine.yaml'), 'utf8'));
		expect(config.shared.values.TREESEED_HOSTING_TEAM_ID).toBe('treeseed');
		expect(config.shared.values.TREESEED_PROJECT_ID).toBe('platform');
		expect(readFileSync(resolve(root, 'treeseed.site.yaml'), 'utf8')).not.toContain('teamId');
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
