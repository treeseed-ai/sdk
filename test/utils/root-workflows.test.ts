import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sdkRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const workspaceRoot = resolve(sdkRoot, '..', '..');
const rootVerifyWorkflowPath = resolve(workspaceRoot, '.github', 'workflows', 'verify.yml');
const rootDeployWorkflowPath = resolve(workspaceRoot, '.github', 'workflows', 'deploy.yml');
const rootDeployWebWorkflowPath = resolve(workspaceRoot, '.github', 'workflows', 'deploy-web.yml');
const describeRootWorkflowSelection =
	existsSync(rootVerifyWorkflowPath) && existsSync(rootDeployWorkflowPath) && existsSync(rootDeployWebWorkflowPath)
		? describe
		: describe.skip;

describeRootWorkflowSelection('root workflow bootstrap selection', () => {
	it('uses auto bootstrap mode in the root verify workflow', () => {
		const source = readFileSync(rootVerifyWorkflowPath, 'utf8');

		expect(source).toContain("branches-ignore:\n      - staging");
		expect(source).toContain('TREESEED_BOOTSTRAP_MODE: auto');
		expect(source).toContain('submodules: recursive');
	});

	it('uses auto bootstrap mode with workspace-aware deployment installs', () => {
		const source = readFileSync(rootDeployWorkflowPath, 'utf8');
		const webSource = readFileSync(rootDeployWebWorkflowPath, 'utf8');
		const verifySource = readFileSync(rootVerifyWorkflowPath, 'utf8');

		expect(source).toContain("branches:\n      - staging");
		expect(source).not.toContain('      - main');
		expect(source).toContain("tags:\n      - '*.*.*'");
		expect(source).toContain('release_tag=$');
		expect(source).toContain('^[0-9]+\\.[0-9]+\\.[0-9]+$');
		expect(source).toContain('uses: ./.github/workflows/deploy-web.yml');
		expect(source).not.toContain('deploy-processing');
		expect(source).not.toContain('deploy_processing');
		expect(webSource).toContain('TREESEED_BOOTSTRAP_MODE: auto');
		expect(webSource).toContain('TREESEED_WORKFLOW_PLANE: web');
		expect(webSource).toContain('TREESEED_BETTER_AUTH_SECRET');
		expect(webSource).toContain('TREESEED_WEB_SERVICE_SECRET');
		expect(webSource).toContain('TREESEED_SITE_URL');
		expect(webSource).toContain('BETTER_AUTH_URL');
		expect(webSource).toContain('packages/sdk packages/agent packages/core packages/cli');
		expect(webSource).toContain('npm ci --ignore-scripts');
		expect(webSource).toContain('node ./packages/sdk/scripts/run-ts.mjs ./packages/sdk/scripts/install-managed-dependencies.ts');
		expect(webSource).not.toContain('RAILWAY_API_TOKEN');
		expect(webSource).not.toContain('TREESEED_WORKER_POOL_SCALER');
		expect(source).toContain('migrations/*');
		expect(source).toContain('scripts/build-api.mjs');
		expect(source).toContain('treeseed.site.yaml');
		expect(source).toContain('.railwayignore');
		expect(source).toContain('.gitignore');
		expect(source).not.toContain('processing_changed');
		expect(source).not.toContain('docs/*|migrations/*');
		expect(webSource).not.toContain('TREESEED_WORKFLOW_SKIP_PROVISION');
		expect(source).not.toContain('submodules: false');
		expect(source).not.toContain('sparse-checkout: |');
		expect(source).not.toContain('delete pkg.workspaces');
		expect(verifySource).not.toContain('delete pkg.workspaces');
	});

	it('uploads built packages for Market API starts', () => {
		const source = readFileSync(resolve(workspaceRoot, '.railwayignore'), 'utf8');

		expect(source).not.toContain('\ndist/\n');
		expect(source).not.toContain('**/dist/');
	});
});

describe('package publish safeguards', () => {
	for (const packageName of ['sdk', 'agent', 'core', 'cli']) {
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
			expect(workflowSource).toContain('contents: write');
			expect(workflowSource).toContain('npm ci failed; retrying');
			expect(workflowSource).toContain('Create GitHub release');
			expect(workflowSource).toContain('gh release create "${GITHUB_REF_NAME}"');
			expect(workflowSource).toContain('--generate-notes');
			expect(workflowSource).toContain('--verify-tag');
			expect(verifyWorkflowSource).toContain('dependency install failed; retrying');
			expect(verifyWorkflowSource).not.toContain('TREESEED_GITHUB_AUTOMATION_MODE');
			expect(checkTagSource).toContain('^\\d+\\.\\d+\\.\\d+$');
			expect(publishSource).toContain('Refusing to publish');
			expect(publishSource).toContain('^\\d+\\.\\d+\\.\\d+$');
		});
	}
});
