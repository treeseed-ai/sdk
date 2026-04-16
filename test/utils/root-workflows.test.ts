import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sdkRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const workspaceRoot = resolve(sdkRoot, '..', '..');
const rootVerifyWorkflowPath = resolve(workspaceRoot, '.github', 'workflows', 'verify.yml');
const rootDeployWorkflowPath = resolve(workspaceRoot, '.github', 'workflows', 'deploy.yml');
const describeRootWorkflowSelection =
	existsSync(rootVerifyWorkflowPath) && existsSync(rootDeployWorkflowPath)
		? describe
		: describe.skip;

describeRootWorkflowSelection('root workflow bootstrap selection', () => {
	it('uses auto bootstrap mode in the root verify workflow', () => {
		const source = readFileSync(rootVerifyWorkflowPath, 'utf8');

		expect(source).toContain('TREESEED_BOOTSTRAP_MODE: auto');
		expect(source).toContain('submodules: recursive');
	});

	it('uses auto bootstrap mode with recursive submodule checkout in deploy jobs', () => {
		const source = readFileSync(rootDeployWorkflowPath, 'utf8');

		expect(source).toContain('TREESEED_BOOTSTRAP_MODE: auto');
		expect((source.match(/submodules: recursive/g) ?? []).length).toBeGreaterThanOrEqual(5);
	});
});
