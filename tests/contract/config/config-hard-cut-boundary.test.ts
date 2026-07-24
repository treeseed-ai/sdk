import { describe, expect, it } from 'vitest';
import { readTestSource, resolveTestRoot } from '../../support/workspace-test-root.ts';

const testRoot = resolveTestRoot(import.meta.url);

function source(path: string) {
	const result = readTestSource(testRoot, path);
	expect(result, `${path} exists`).not.toBeNull();
	return result ?? '';
}

describe('platform config hard-cut boundary', () => {
	it('keeps canonical reconciliation paths off loadCliDeployConfig', () => {
		const canonicalFiles = [
			'packages/sdk/src/reconcile/reconciliation/desired-state.ts',
			'packages/sdk/src/reconcile/support/state/state.ts',
			'packages/sdk/src/platform/reconciliation/desired-state.ts',
			'packages/sdk/src/operations/workflow-state.ts',
		];
		const offenders = canonicalFiles
			.filter((file) => source(file).includes('loadCliDeployConfig'))
			.map((file) => `${file} imports loadCliDeployConfig`);
		expect(offenders).toEqual([]);
	});

	it('keeps loadCliDeployConfig as a runtime-tools compatibility wrapper', () => {
		const runtimeTools = source('packages/sdk/src/operations/services/agents/runtime-tools.ts');
		expect(runtimeTools).toContain('export function loadCliDeployConfig');
		expect(runtimeTools).toContain('loadDeployConfigFromPath');
	});
});
