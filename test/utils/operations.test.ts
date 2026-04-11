import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	findTreeseedOperation,
	TRESEED_OPERATION_SPECS,
	TreeseedWorkflowSdk,
} from '../../src/operations.ts';

describe('treeseed operations registry', () => {
	it('keeps workflow operations discoverable by name', () => {
		expect(TRESEED_OPERATION_SPECS.map((spec) => spec.name)).toContain('status');
		expect(TRESEED_OPERATION_SPECS.map((spec) => spec.name)).toContain('tasks');
		expect(TRESEED_OPERATION_SPECS.map((spec) => spec.name)).toContain('release');
	});

	it('resolves aliases through the shared registry', () => {
		expect(findTreeseedOperation('release:verify')?.name).toBe('test:release:full');
	});
});

describe('treeseed workflow sdk', () => {
	it('returns structured workflow status', async () => {
		const workflow = new TreeseedWorkflowSdk({ cwd: process.cwd() });
		const result = await workflow.status();
		expect(result.ok).toBe(true);
		expect(result.operation).toBe('status');
		expect(result.payload).toHaveProperty('branchRole');
	});

	it('returns structured task metadata', async () => {
		const workflow = new TreeseedWorkflowSdk({ cwd: resolve(process.cwd(), '..', '..') });
		const result = await workflow.tasks();
		expect(result.ok).toBe(true);
		expect(result.operation).toBe('tasks');
		expect(Array.isArray(result.payload.tasks)).toBe(true);
	});
});
