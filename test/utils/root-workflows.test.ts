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

	it('uses auto bootstrap mode with split checkout strategy in deploy jobs', () => {
		const source = readFileSync(rootDeployWorkflowPath, 'utf8');

		expect(source).toContain('TREESEED_BOOTSTRAP_MODE: auto');
		expect((source.match(/submodules: recursive/g) ?? []).length).toBeGreaterThanOrEqual(4);
		expect(source).toContain('migrations/*)');
		expect(source).toContain('code_changed="true"');
		expect(source).not.toContain('docs/*|migrations/*');
		expect(source).toContain('always() &&');
		expect(source).toContain("needs.provision.result == 'success'");
		expect(source).toContain('TREESEED_WORKFLOW_SKIP_PROVISION: "1"');
		expect(source).toContain('EXTRA_ARGS+=(--skip-provision)');
		expect(source).toContain('TREESEED_CONTENT_SERVING_MODE: published_runtime');
		expect(source).toContain('submodules: false');
		expect(source).toContain('sparse-checkout: |');
		expect(source).toContain('!/src/content/**');
		expect(source).toContain('!/public/books/**');
	});
});
