import { describe, expect, it } from 'vitest';
import { buildDockerComposeArgs } from '../../../../src/reconcile/providers/docker-private.ts';

describe('Docker Compose reconciliation commands', () => {
	it('explicitly converges every service declared by the desired unit', () => {
		expect(buildDockerComposeArgs({
			composeFiles: ['/workspace/base.yml', '/workspace/local.yml'],
			projectName: 'treeseed-test',
			services: ['manager', 'runner'],
			action: 'restart',
		})).toEqual([
			'compose', '-f', '/workspace/base.yml', '-f', '/workspace/local.yml',
			'-p', 'treeseed-test', 'up', '-d', '--force-recreate', 'manager', 'runner',
		]);
	});

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
