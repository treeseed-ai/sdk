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

	it('uses auto bootstrap mode with workspace-aware deployment installs', () => {
		const source = readFileSync(rootDeployWorkflowPath, 'utf8');
		const verifySource = readFileSync(rootVerifyWorkflowPath, 'utf8');

		expect(source).toContain('TREESEED_BOOTSTRAP_MODE: auto');
		expect((source.match(/submodules: recursive/g) ?? []).length).toBeGreaterThanOrEqual(5);
		expect((source.match(/npm ci --ignore-scripts/g) ?? []).length).toBeGreaterThanOrEqual(5);
		expect(source).not.toContain('\n          npm ci\n');
		expect(source).toContain('migrations/*)');
		expect(source).toContain('code_changed="true"');
		expect(source).not.toContain('docs/*|migrations/*');
		expect(source).toContain('always() &&');
		expect(source).toContain("needs.provision.result == 'success'");
		expect(source).toContain('TREESEED_WORKFLOW_SKIP_PROVISION: "1"');
		expect(source).toContain('EXTRA_ARGS+=(--skip-provision)');
		expect(source).toContain('uses: actions/upload-artifact@v4');
		expect(source).toContain('uses: actions/download-artifact@v4');
		expect(source).toContain('Ensure Treeseed deployment state');
		expect(source).toContain("'.treeseed/state/environments/' + scope + '/deploy.json'");
		expect(source).toContain('name: treeseed-deploy-state-${{ needs.classify.outputs.scope }}');
		expect(source).toContain('path: .treeseed/state');
		expect(source).toContain('include-hidden-files: true');
		expect(source).toContain('TREESEED_CONTENT_SERVING_MODE: published_runtime');
		expect(source).not.toContain('submodules: false');
		expect(source).not.toContain('sparse-checkout: |');
		expect(source).not.toContain('delete pkg.workspaces');
		expect(verifySource).not.toContain('delete pkg.workspaces');
	});
});

describe('package publish safeguards', () => {
	for (const packageName of ['sdk', 'core', 'cli']) {
		const packageRoot = resolve(workspaceRoot, 'packages', packageName);
		const publishWorkflowPath = resolve(packageRoot, '.github', 'workflows', 'publish.yml');
		const describePackagePublishSafeguard = existsSync(publishWorkflowPath)
			? it
			: it.skip;

		describePackagePublishSafeguard(`guards ${packageName} publishing to stable semver tags`, () => {
			const workflowSource = readFileSync(publishWorkflowPath, 'utf8');
			const verifyWorkflowSource = readFileSync(resolve(packageRoot, '.github', 'workflows', 'verify.yml'), 'utf8');
			const checkTagSource = readFileSync(resolve(packageRoot, 'scripts', 'assert-release-tag-version.ts'), 'utf8');
			const publishSource = readFileSync(resolve(packageRoot, 'scripts', 'publish-package.ts'), 'utf8');

			expect(workflowSource).toContain("startsWith(github.ref, 'refs/tags/')");
			expect(workflowSource).toContain("!contains(github.ref_name, '-')");
			expect(workflowSource).toContain('npm ci failed; retrying');
			expect(verifyWorkflowSource).toContain('dependency install failed; retrying');
			expect(checkTagSource).toContain('^\\d+\\.\\d+\\.\\d+$');
			expect(publishSource).toContain('Refusing to publish');
			expect(publishSource).toContain('^\\d+\\.\\d+\\.\\d+$');
		});
	}
});
