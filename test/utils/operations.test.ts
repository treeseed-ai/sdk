import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
	findTreeseedOperation,
	TRESEED_OPERATION_SPECS,
	TreeseedWorkflowSdk,
} from '../../src/operations.ts';
import { sdkFixtureRoot } from '../test-fixture.ts';

function runGit(cwd: string, args: string[]) {
	const result = spawnSync('git', args, {
		cwd,
		stdio: 'pipe',
		encoding: 'utf8',
	});
	if (result.status !== 0) {
		throw new Error(result.stderr?.trim() || result.stdout?.trim() || `git ${args.join(' ')} failed`);
	}
}

function createTempWorkflowSite() {
	const root = mkdtempSync(join(tmpdir(), 'treeseed-sdk-workflow-'));
	cpSync(sdkFixtureRoot, root, { recursive: true });
	runGit(root, ['init', '-b', 'staging']);
	runGit(root, ['config', 'user.name', 'Treeseed Test']);
	runGit(root, ['config', 'user.email', 'test@treeseed.local']);
	runGit(root, ['add', '.']);
	runGit(root, ['commit', '-m', 'fixture']);
	runGit(root, ['checkout', '-b', 'feature/demo-task']);
	return root;
}

describe('treeseed operations registry', () => {
	it('keeps workflow operations discoverable by name', () => {
		expect(TRESEED_OPERATION_SPECS.map((spec) => spec.name)).toContain('status');
		expect(TRESEED_OPERATION_SPECS.map((spec) => spec.name)).toContain('ci');
		expect(TRESEED_OPERATION_SPECS.map((spec) => spec.name)).toContain('tasks');
		expect(TRESEED_OPERATION_SPECS.map((spec) => spec.name)).toContain('release');
	});

	it('resolves aliases through the shared registry', () => {
		expect(findTreeseedOperation('release:verify')?.name).toBe('test:release:full');
	});
});

describe('treeseed workflow sdk', () => {
	it('returns structured workflow status', async () => {
		const workflow = new TreeseedWorkflowSdk({ cwd: sdkFixtureRoot });
		const result = await workflow.status();
		expect(result.ok).toBe(true);
		expect(result.operation).toBe('status');
		expect(result.payload).toHaveProperty('branchRole');
		expect(result.payload).toHaveProperty('environmentStatus');
		expect(result.payload.environmentStatus).toHaveProperty('local');
		expect(result.payload.environmentStatus).toHaveProperty('staging');
		expect(result.payload.environmentStatus).toHaveProperty('prod');
		expect(result.payload).toHaveProperty('providerStatus');
		expect(result.payload.providerStatus).toHaveProperty('local');
		expect(result.payload.providerStatus).toHaveProperty('staging');
		expect(result.payload.providerStatus).toHaveProperty('prod');
		expect(result.payload).toHaveProperty('auth');
		expect(result.payload).toHaveProperty('persistentEnvironments');
		expect(result.payload).toHaveProperty('readiness');
	});

	it('returns structured task metadata', async () => {
		const workflowRoot = createTempWorkflowSite();
		const workflow = new TreeseedWorkflowSdk({ cwd: workflowRoot });
		const result = await workflow.tasks();
		expect(result.ok).toBe(true);
		expect(result.operation).toBe('tasks');
		expect(Array.isArray(result.payload.tasks)).toBe(true);
		expect(result.payload.tasks.some((task) => task.name === 'feature/demo-task')).toBe(true);
	});
});
