import { describe, expect, it } from 'vitest';
import { buildDockerComposeArgs } from '../../../../src/reconcile/providers/docker-private.ts';

describe('Docker Compose reconciliation commands', () => {
	it('removes named volumes and orphans only for an explicit disposable-data reset', () => {
		const base = {
			composeFiles: ['/workspace/compose.yml'],
			projectName: 'treeseed-test',
			action: 'down' as const,
		};
		expect(buildDockerComposeArgs(base)).toEqual([
			'compose', '-f', '/workspace/compose.yml', '-p', 'treeseed-test', 'down',
		]);
		expect(buildDockerComposeArgs({ ...base, removeVolumes: true })).toEqual([
			'compose', '-f', '/workspace/compose.yml', '-p', 'treeseed-test', 'down', '--volumes', '--remove-orphans',
		]);
	});
});
