import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TREESEED_PUBLIC_RELEASE_PACKAGE_NAMES } from '../../src/operations/services/workspace-save.ts';

const sdkRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const workspaceRoot = resolve(sdkRoot, '..', '..');
const rootVerifyWorkflowPath = resolve(workspaceRoot, '.github', 'workflows', 'verify.yml');
const rootDeployWorkflowPath = resolve(workspaceRoot, '.github', 'workflows', 'deploy.yml');
const rootDeployWebWorkflowPath = resolve(workspaceRoot, '.github', 'workflows', 'deploy-web.yml');
const rootPrepareWorkspaceInstallPath = resolve(workspaceRoot, '.github', 'scripts', 'prepare-workspace-install.ts');
const packageVerifyWorkflowPath = resolve(sdkRoot, '.github', 'workflows', 'verify.yml');
const integratedWorkspaceAvailable = existsSync(rootVerifyWorkflowPath)
	&& existsSync(rootDeployWorkflowPath)
	&& existsSync(rootDeployWebWorkflowPath)
	&& existsSync(rootPrepareWorkspaceInstallPath)
	&& existsSync(resolve(workspaceRoot, '.railwayignore'));

function packageRootFor(packageName: string) {
	const integratedPackageRoot = resolve(workspaceRoot, 'packages', packageName);
	if (existsSync(resolve(integratedPackageRoot, 'package.json'))) return integratedPackageRoot;
	if (packageName === 'sdk') return sdkRoot;
	return null;
}

function firstExistingFile(root: string, paths: string[]) {
	for (const path of paths) {
		const resolved = resolve(root, path);
		if (existsSync(resolved)) return resolved;
	}
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
		const prepareInstallSource = readFileSync(rootPrepareWorkspaceInstallPath, 'utf8');

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
		expect(webSource).toContain('tenant-workflow-action.ts --action "${TREESEED_WORKFLOW_ACTION}" --environment "${TREESEED_WORKFLOW_ENVIRONMENT}"');
		expect(webSource).toContain('TREESEED_WORKFLOW_ACTION: ${{ inputs.action_kind }}');
		expect(webSource).toContain('TREESEED_WORKFLOW_ENVIRONMENT: ${{ inputs.environment }}');
		expect(webSource).toContain('TREESEED_BETTER_AUTH_SECRET');
		expect(webSource).toContain('TREESEED_WEB_SERVICE_SECRET');
		expect(webSource).toContain('TREESEED_API_WEB_SERVICE_SECRET');
		expect(webSource).toContain('TREESEED_HOSTED_HUBS_GITHUB_TOKEN');
		expect(webSource).toContain('TREESEED_GITHUB_TOKEN: ${{ secrets.TREESEED_HOSTED_HUBS_GITHUB_TOKEN }}');
		expect(webSource).toContain('TREESEED_GITHUB_TOKEN: ${{ secrets.TREESEED_HOSTED_HUBS_GITHUB_TOKEN }}');
		expect(webSource).toContain('TREESEED_SITE_URL');
		expect(webSource).toContain('TREESEED_BETTER_AUTH_URL');
		expect(webSource).toContain('https://preview.treeseed.dev');
		expect(webSource).toContain('https://treeseed.dev');
		expect(webSource).toContain('https://api.preview.treeseed.dev');
		expect(webSource).toContain('https://api.treeseed.dev');
		expect(webSource).not.toContain('api-treeseed-market-staging-ca844c56.treeseed.ai');
		expect(webSource).not.toContain('https://api.treeseed.ai');
		expect(webSource).toContain('npm --prefix packages/sdk run build:dist');
		expect(webSource).toContain('packages/ui/dist/astro/layouts/MainLayout.astro');
		expect(webSource).toContain('packages/admin/dist/plugin.js');
		expect(webSource).toContain('npm --prefix packages/ui run build:dist');
		expect(webSource).toContain('npm --prefix packages/core run build:dist');
		expect(webSource).toContain('npm --prefix packages/admin run build:dist');
		expect(webSource).toContain('for dir in packages/cli packages/agent');
		expect(webSource).toContain('pids["${dir}"]="$!"');
		expect(webSource).toContain('npx --yes tsx ./.github/scripts/prepare-workspace-install.ts');
		expect(webSource).toContain('npm ci --ignore-scripts');
		expect(source).toContain('npx --yes tsx ./.github/scripts/prepare-workspace-install.ts');
		expect(webSource).toContain('tsx ./packages/sdk/scripts/install-managed-dependencies.ts');
			expect(webSource).not.toContain('TREESEED_RAILWAY_API_TOKEN');
			expect(webSource).not.toContain('TREESEED_RAILWAY_PROJECT_ID');
			expect(webSource).not.toContain('TREESEED_PLATFORM_RUNNER_SECRET');
			expect(webSource).toContain('TREESEED_CREDENTIAL_SESSION_SECRET: ${{ secrets.TREESEED_CREDENTIAL_SESSION_SECRET }}');
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
		expect(verifySource).toContain('npx --yes tsx ./.github/scripts/prepare-workspace-install.ts');
		expect(verifySource).toContain('packages/api packages/ui');
		expect(prepareInstallSource).toContain('localPackageNames');
		expect(prepareInstallSource).toContain('dependencyName !== manifest.name');
		expect(prepareInstallSource).toContain('localPackageNames.has(dependencyName)');
		expect(prepareInstallSource).not.toContain("['@treeseed/ui']");
	});

	it('uploads built packages for API starts', () => {
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

describe('admin package workflow integration', () => {
	it('keeps admin in public release order and web app staging selection', () => {
		const operationsSource = readFileSync(resolve(sdkRoot, 'src', 'workflow', 'operations.ts'), 'utf8');

		if (!integratedWorkspaceAvailable) {
			expect(TREESEED_PUBLIC_RELEASE_PACKAGE_NAMES).toContain('@treeseed/admin');
			expect(operationsSource).toContain("{ name: '@treeseed/admin', dir: 'packages/admin', artifacts: ['dist/plugin.js'] }");
			return;
		}

		const workspaceBootstrapSource = readFileSync(resolve(workspaceRoot, 'packages', 'core', 'scripts', 'workspace-bootstrap.ts'), 'utf8');
		const adminManifestPath = resolve(workspaceRoot, 'packages', 'admin', 'treeseed.package.yaml');
		const adminPackagePath = resolve(workspaceRoot, 'packages', 'admin', 'package.json');

		expect(TREESEED_PUBLIC_RELEASE_PACKAGE_NAMES).toEqual([
			'@treeseed/sdk',
			'@treeseed/ui',
			'@treeseed/core',
			'@treeseed/admin',
			'@treeseed/cli',
			'@treeseed/agent',
		]);
		expect(existsSync(adminManifestPath), `${adminManifestPath} must exist`).toBe(true);
		expect(existsSync(adminPackagePath), `${adminPackagePath} must exist`).toBe(true);
		expect(readFileSync(adminManifestPath, 'utf8')).toContain('workflow: deploy.yml');
		expect(workspaceBootstrapSource).toContain("{ name: '@treeseed/admin', dir: 'packages/admin', build: true }");
		expect(operationsSource).toContain("{ name: '@treeseed/admin', dir: 'packages/admin', artifacts: ['dist/plugin.js'] }");
		expect(operationsSource).toContain("packageName === '@treeseed/core' || packageName === '@treeseed/ui' || packageName === '@treeseed/admin'");
		expect(operationsSource).toContain("file.startsWith('packages/core/') || file.startsWith('packages/ui/') || file.startsWith('packages/admin/')");
	});
});

describe('package publish safeguards', () => {
	for (const packageName of ['sdk', 'agent', 'core', 'cli', 'admin']) {
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
			const checkTagPath = firstExistingFile(packageRoot, [
				'scripts/assert-release-tag-version.ts',
				'scripts/assert-release-tag-version.ts',
			]);
			const publishPath = firstExistingFile(packageRoot, [
				'scripts/publish-package.ts',
				'scripts/publish-package.ts',
			]);
			expect(checkTagPath, `${packageName} release tag script must exist`).toBeTruthy();
			expect(publishPath, `${packageName} publish script must exist`).toBeTruthy();
			const checkTagSource = readFileSync(checkTagPath!, 'utf8');
			const publishSource = readFileSync(publishPath!, 'utf8');

			expect(workflowSource).toContain("startsWith(github.ref, 'refs/tags/')");
			expect(workflowSource).toContain('- "*.*.*"');
			expect(workflowSource).not.toContain('- "v*"');
			expect(workflowSource).toContain("!contains(github.ref_name, '-')");
			expect(workflowSource).toContain('contents: write');
			expect(workflowSource).toMatch(/(?:npm ci|dependency install) failed; retrying/);
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
			expect(publishSource).toContain('publish');
			expect(publishSource).not.toContain('could not be found or you do not have permission');
			expect(publishSource).not.toContain('is not in this registry');
		});
	}
});
