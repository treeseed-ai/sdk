import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sdkRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const workspaceRoot = resolve(sdkRoot, '..', '..');
const rootVerifyWorkflowPath = resolve(workspaceRoot, '.github', 'workflows', 'verify.yml');
const rootDeployWorkflowPath = resolve(workspaceRoot, '.github', 'workflows', 'deploy.yml');
const rootDeployWebWorkflowPath = resolve(workspaceRoot, '.github', 'workflows', 'deploy-web.yml');
const packageVerifyWorkflowPath = resolve(sdkRoot, '.github', 'workflows', 'verify.yml');
const integratedWorkspaceAvailable = existsSync(rootVerifyWorkflowPath)
	&& existsSync(rootDeployWorkflowPath)
	&& existsSync(rootDeployWebWorkflowPath)
	&& existsSync(resolve(workspaceRoot, '.railwayignore'));

function packageRootFor(packageName: string) {
	const integratedPackageRoot = resolve(workspaceRoot, 'packages', packageName);
	if (existsSync(resolve(integratedPackageRoot, 'package.json'))) return integratedPackageRoot;
	if (packageName === 'sdk') return sdkRoot;
	return null;
}

describe('root workflow bootstrap selection', () => {
	it('uses auto bootstrap mode in the root verify workflow', () => {
		if (!integratedWorkspaceAvailable) {
			expect(existsSync(packageVerifyWorkflowPath), `${packageVerifyWorkflowPath} must exist in package-only verification`).toBe(true);
			return;
		}
		expect(existsSync(rootVerifyWorkflowPath), `${rootVerifyWorkflowPath} must exist`).toBe(true);
		const source = readFileSync(rootVerifyWorkflowPath, 'utf8');

		expect(source).toContain("branches-ignore:\n      - staging");
		expect(source).toContain('TREESEED_BOOTSTRAP_MODE: auto');
		expect(source).toContain('submodules: recursive');
	});

	it('uses auto bootstrap mode with workspace-aware deployment installs', () => {
		if (!integratedWorkspaceAvailable) {
			expect(existsSync(packageVerifyWorkflowPath), `${packageVerifyWorkflowPath} must exist in package-only verification`).toBe(true);
			return;
		}
		expect(existsSync(rootDeployWorkflowPath), `${rootDeployWorkflowPath} must exist`).toBe(true);
		expect(existsSync(rootDeployWebWorkflowPath), `${rootDeployWebWorkflowPath} must exist`).toBe(true);
		expect(existsSync(rootVerifyWorkflowPath), `${rootVerifyWorkflowPath} must exist`).toBe(true);
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
		expect(webSource).toContain('TREESEED_WORKFLOW_PLANE: all');
		expect(webSource).toContain('tenant-workflow-action.ts --action "${TREESEED_WORKFLOW_ACTION}" --environment "${TREESEED_WORKFLOW_ENVIRONMENT}"');
		expect(webSource).toContain('TREESEED_WORKFLOW_ACTION: ${{ inputs.action_kind }}');
		expect(webSource).toContain('TREESEED_WORKFLOW_ENVIRONMENT: ${{ inputs.environment }}');
		expect(webSource).toContain('TREESEED_BETTER_AUTH_SECRET');
		expect(webSource).toContain('TREESEED_WEB_SERVICE_SECRET');
		expect(webSource).toContain('TREESEED_API_WEB_SERVICE_SECRET');
		expect(webSource).toContain('TREESEED_PLATFORM_RUNNER_SECRET');
		expect(webSource).toContain('TREESEED_HOSTED_HUBS_GITHUB_TOKEN');
		expect(webSource).toContain('GH_TOKEN: ${{ secrets.TREESEED_HOSTED_HUBS_GITHUB_TOKEN }}');
		expect(webSource).toContain('GITHUB_TOKEN: ${{ secrets.TREESEED_HOSTED_HUBS_GITHUB_TOKEN }}');
		expect(webSource).toContain('TREESEED_SITE_URL');
		expect(webSource).toContain('BETTER_AUTH_URL');
		expect(webSource).toContain('https://api-treeseed-market-staging-ca844c56.treeseed.ai');
		expect(webSource).toContain('npm --prefix packages/sdk run build:dist');
		expect(webSource).toContain('for dir in packages/core packages/cli packages/agent');
		expect(webSource).toContain('pids["${dir}"]="$!"');
		expect(webSource).toContain('npm ci --ignore-scripts');
		expect(webSource).toContain('node ./packages/sdk/scripts/run-ts.mjs ./packages/sdk/scripts/install-managed-dependencies.ts');
		expect(webSource).toContain('RAILWAY_API_TOKEN');
		expect(webSource).toContain('TREESEED_RAILWAY_PROJECT_ID');
		expect(webSource).not.toContain('TREESEED_WORKER_POOL_SCALER');
		expect(source).not.toContain('migrations/*');
		expect(source).toContain('packages/api');
		expect(source).toContain('treeseed.site.yaml');
		expect(source).toContain('.railwayignore');
		expect(source).toContain('.gitignore');
		expect(source).not.toContain('processing_changed');
		expect(source).not.toContain('docs/*|migrations/*');
		expect(webSource).not.toContain('TREESEED_WORKFLOW_SKIP_PROVISION');
		expect(verifySource).toContain('packages/api');
		expect(source).not.toContain('submodules: false');
		expect(source).not.toContain('sparse-checkout: |');
		expect(source).not.toContain('delete pkg.workspaces');
		expect(verifySource).not.toContain('delete pkg.workspaces');
	});

	it('uploads built packages for Market API starts', () => {
		if (!integratedWorkspaceAvailable) {
			expect(existsSync(packageVerifyWorkflowPath), `${packageVerifyWorkflowPath} must exist in package-only verification`).toBe(true);
			return;
		}
		expect(existsSync(resolve(workspaceRoot, '.railwayignore')), `${resolve(workspaceRoot, '.railwayignore')} must exist`).toBe(true);
		const source = readFileSync(resolve(workspaceRoot, '.railwayignore'), 'utf8');

		expect(source).not.toContain('\ndist/\n');
		expect(source).not.toContain('**/dist/');
	});
});

describe('package publish safeguards', () => {
	for (const packageName of ['sdk', 'agent', 'core', 'cli']) {
		it(`guards ${packageName} publishing to stable semver tags`, () => {
			const packageRoot = packageRootFor(packageName);
			if (!packageRoot) {
				expect(integratedWorkspaceAvailable, `${packageName} package workflow is only available in integrated workspace verification`).toBe(false);
				return;
			}
			const publishWorkflowPath = resolve(packageRoot, '.github', 'workflows', 'publish.yml');
			expect(existsSync(publishWorkflowPath), `${publishWorkflowPath} must exist`).toBe(true);
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
			expect(publishSource).toContain('process.exit(result.status ?? 1)');
			expect(publishSource).not.toContain('unprovisionedScopedPackage');
			expect(publishSource).not.toContain('treating git-tag');
			expect(publishSource).not.toContain('could not be found or you do not have permission');
			expect(publishSource).not.toContain('is not in this registry');
		});
	}
});
