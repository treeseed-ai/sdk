import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

function source(path: string) {
	return readFileSync(resolve(root, path), 'utf8');
}

describe('platform config hard-cut boundary', () => {
	it('keeps canonical reconciliation paths off loadCliDeployConfig', () => {
		const canonicalFiles = [
			'packages/sdk/src/reconcile/desired-state.ts',
			'packages/sdk/src/reconcile/state.ts',
			'packages/sdk/src/platform/desired-state.ts',
			'packages/sdk/src/workflow-state.ts',
		];
		const offenders = canonicalFiles
			.filter((file) => source(file).includes('loadCliDeployConfig'))
			.map((file) => `${file} imports loadCliDeployConfig`);
		expect(offenders).toEqual([]);
	});

	it('keeps loadCliDeployConfig as a runtime-tools compatibility wrapper', () => {
		const runtimeTools = source('packages/sdk/src/operations/services/runtime-tools.ts');
		expect(runtimeTools).toContain('export function loadCliDeployConfig');
		expect(runtimeTools).toContain('loadTreeseedDeployConfigFromPath');
	});
});
