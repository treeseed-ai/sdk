import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TREESEED_PUBLIC_RELEASE_PACKAGE_NAMES } from '../../src/operations/services/workspace-save.ts';
import { planTreeseedGuarantees } from '../../src/guarantees/index.ts';

const sdkRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const workspaceRoot = resolve(sdkRoot, '..', '..');
const rootVerifyWorkflowPath = resolve(workspaceRoot, '.github', 'workflows', 'verify.yml');
const rootDeployWorkflowPath = resolve(workspaceRoot, '.github', 'workflows', 'deploy.yml');
const rootStagingCandidateWorkflowPath = resolve(workspaceRoot, '.github', 'workflows', 'staging-candidate.yml');
const rootDeployWebWorkflowPath = resolve(workspaceRoot, '.github', 'workflows', 'deploy-web.yml');
const rootReleaseGateWorkflowPath = resolve(workspaceRoot, '.github', 'workflows', 'release-gate.yml');
const rootPrepareWorkspaceInstallPath = resolve(workspaceRoot, '.github', 'scripts', 'prepare-workspace-install.ts');
const packageVerifyWorkflowPath = resolve(sdkRoot, '.github', 'workflows', 'verify.yml');
const integratedWorkspaceAvailable = existsSync(rootVerifyWorkflowPath)
	&& existsSync(rootDeployWorkflowPath)
	&& existsSync(rootReleaseGateWorkflowPath)
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
	it('selects exact API/Agent and scene-backed release-gate collections', () => {
		if (!existsSync(rootPrepareWorkspaceInstallPath)) return;
		const apiAgent = planTreeseedGuarantees({ workspaceRoot, filter: { ownerPackages: ['@treeseed/api', '@treeseed/agent'] }, includeDependencies: false });
		const ui = planTreeseedGuarantees({ workspaceRoot, filter: { sceneBacked: true }, includeDependencies: false });
		expect(apiAgent.counts.selected).toBe(84);
		expect(apiAgent.counts.withDependencies).toBe(84);
		expect(ui.counts.selected).toBe(139);
		expect(ui.counts.withDependencies).toBe(139);
	}, 60_000);
	it('uses standardized verify, release-gate, and deploy workflow roles', () => {
		if (!existsSync(rootPrepareWorkspaceInstallPath)) return;
		const deploy = readFileSync(rootDeployWorkflowPath, 'utf8');
		const releaseGate = readFileSync(rootReleaseGateWorkflowPath, 'utf8');
		expect(deploy).toContain('branches: [staging]');
		expect(deploy).toContain("tags: ['*.*.*']");
		expect(deploy).toContain('git merge-base --is-ancestor "${GITHUB_SHA}" origin/main');
		expect(deploy).toContain('npm run test:unit');
		expect(deploy).toContain('guarantees validate --json');
		expect(deploy).not.toContain('guarantees run');
		expect(deploy).toContain('hosting verify --environment staging --app web --live --json');
		expect(deploy).toContain('hosting verify --environment prod --app web --live --json');
		expect(releaseGate).toContain('--scene-backed --no-dependencies');
		expect(existsSync(rootDeployWebWorkflowPath)).toBe(false);
		expect(existsSync(rootStagingCandidateWorkflowPath)).toBe(false);
		expect(existsSync(resolve(workspaceRoot, '.github/workflows/hosted-project.yml'))).toBe(false);
		expect(existsSync(resolve(workspaceRoot, '.github/workflows/production-release.yml'))).toBe(false);
		const operations = readFileSync(resolve(sdkRoot, 'src/workflow/operations.ts'), 'utf8');
		expect(operations).toContain('function stagingCandidateWorkflowGates');
		expect(operations).toContain('adapter?.capabilities.deploy === true');
		expect(operations).toContain('implicit resume skipped stale failed run');
		expect(operations).toContain("add(pkg.name, repoPath, pkg.commit, 'verify.yml')");
		expect(operations).toContain("add(pkg.name, repoPath, pkg.commit, 'deploy.yml', true)");
		expect(operations).toContain("add('@treeseed/market', marketRoot, manifest.root.commit, 'verify.yml')");
		expect(operations).toContain("add('@treeseed/market', marketRoot, manifest.root.commit, 'deploy.yml', true)");
		expect(operations).not.toContain("'--workflow', 'staging-candidate.yml'");
	});

	it('uses one API deployment workflow for source staging and image production', () => {
		const apiRoot = packageRootFor('api');
		if (!apiRoot) return;
		const deploy = readFileSync(resolve(apiRoot, '.github/workflows/deploy.yml'), 'utf8');
		const releaseGate = readFileSync(resolve(apiRoot, '.github/workflows/release-gate.yml'), 'utf8');
		expect(deploy).toContain('branches: [staging]');
		expect(deploy).toContain('target: api');
		expect(deploy).toContain('target: operations-runner');
		expect(deploy).toContain('TREESEED_API_IMAGE_REF: treeseed/api:${{ needs.verify.outputs.version }}');
		expect(deploy).toContain('TREESEED_OPERATIONS_RUNNER_IMAGE_REF: treeseed/op-runner:${{ needs.verify.outputs.version }}');
		expect(deploy).toContain('TREESEED_PUBLIC_TREEDX_IMAGE_REF: ${{ vars.TREESEED_PUBLIC_TREEDX_IMAGE_REF }}');
		expect(deploy).toContain('hosting verify --environment staging --app api --live --json');
		expect(deploy).toContain('hosting verify --environment prod --app api --live --json');
		expect(deploy).not.toContain('guarantees run');
		expect(releaseGate).toContain("--owner-package '@treeseed/api,@treeseed/agent' --no-dependencies");
		expect(existsSync(resolve(apiRoot, '.github/workflows/publish.yml'))).toBe(false);
	});
	it('waits for production deploy workflows only for deploy-capable packages', () => {
		const operations = readFileSync(resolve(sdkRoot, 'src/workflow/operations.ts'), 'utf8');
		expect(operations).toContain('adapter?.capabilities.deploy !== true');
	});
	it('keeps process force separate from local infrastructure recreation', () => {
		const devHandlerPath = resolve(workspaceRoot, 'packages/cli/src/cli/handlers/dev.ts');
		if (!existsSync(devHandlerPath)) return;
		const source = readFileSync(devHandlerPath, 'utf8');
		expect(source).toContain("unit.unitType === 'local-process'");
		expect(source).not.toContain('forceRecreate');
	});
	it('uses auto bootstrap mode in the root verify workflow', () => {
		if (!integratedWorkspaceAvailable) {
			expect(existsSync(packageVerifyWorkflowPath), `${packageVerifyWorkflowPath} must exist in package-only verification`).toBe(true);
			return;
		}
		expect(existsSync(rootVerifyWorkflowPath), `${rootVerifyWorkflowPath} must exist`).toBe(true);
		const source = readFileSync(rootVerifyWorkflowPath, 'utf8');

		expect(source).toContain('push:');
		expect(source).not.toContain('branches-ignore:');
		expect(source).toContain('TREESEED_BOOTSTRAP_MODE: auto');
		expect(source).toContain('submodules: recursive');
	});

	it('uses one verified Market deployment workflow with workspace-aware installs', () => {
		if (!integratedWorkspaceAvailable) {
			expect(existsSync(packageVerifyWorkflowPath), `${packageVerifyWorkflowPath} must exist in package-only verification`).toBe(true);
			return;
		}
		expect(existsSync(rootDeployWorkflowPath), `${rootDeployWorkflowPath} must exist`).toBe(true);
		expect(existsSync(rootVerifyWorkflowPath), `${rootVerifyWorkflowPath} must exist`).toBe(true);
		const source = readFileSync(rootDeployWorkflowPath, 'utf8');
		const releaseGateSource = readFileSync(rootReleaseGateWorkflowPath, 'utf8');
		const verifySource = readFileSync(rootVerifyWorkflowPath, 'utf8');
		const prepareInstallSource = readFileSync(rootPrepareWorkspaceInstallPath, 'utf8');

		expect(source).toContain('branches: [staging]');
		expect(source).toContain("tags: ['*.*.*']");
		expect(source).not.toContain('      - main');
		expect(source).toContain('git merge-base --is-ancestor "${GITHUB_SHA}" origin/main');
		expect(source).toContain('deploy-staging:\n    needs: verify');
		expect(source).toContain('deploy-production:\n    needs: verify');
		expect(source).toContain('npx --yes tsx ./.github/scripts/prepare-workspace-install.ts');
		expect(source).toContain('npm ci --ignore-scripts --no-audit --no-fund');
		expect(source).toContain('hosting plan --environment staging --app web --json');
		expect(source).toContain('hosting apply --environment staging --app web --json');
		expect(source).toContain('hosting verify --environment staging --app web --live --json');
		expect(source).toContain('hosting plan --environment prod --app web --json');
		expect(source).toContain('hosting apply --environment prod --app web --json');
		expect(source).toContain('hosting verify --environment prod --app web --live --json');
		expect(source).not.toContain('guarantees run');
		expect(releaseGateSource).toContain('--scene-backed --no-dependencies');
		expect(existsSync(rootDeployWebWorkflowPath)).toBe(false);
		expect(existsSync(rootStagingCandidateWorkflowPath)).toBe(false);
		expect(source).not.toContain('submodules: false');
		expect(source).not.toContain('sparse-checkout: |');
		expect(source).not.toContain('delete pkg.workspaces');
		expect(verifySource).not.toContain('delete pkg.workspaces');
		expect(verifySource).toContain('npx --yes tsx ./.github/scripts/prepare-workspace-install.ts');
		expect(verifySource).toContain('packages/cli packages/ui');
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
		expect(readFileSync(adminManifestPath, 'utf8')).toContain('workflow: verify.yml');
		expect(workspaceBootstrapSource).toContain("{ name: '@treeseed/admin', dir: 'packages/admin', build: true }");
		expect(operationsSource).toContain("{ name: '@treeseed/admin', dir: 'packages/admin', artifacts: ['dist/plugin.js'] }");
		expect(operationsSource).toContain("packageName === '@treeseed/core' || packageName === '@treeseed/ui' || packageName === '@treeseed/admin'");
		expect(operationsSource).toContain("file.startsWith('packages/core/') || file.startsWith('packages/ui/') || file.startsWith('packages/admin/')");
	});
});

describe('package publish safeguards', () => {
	it('keeps CLI publish and verification on the supported Node runtime', () => {
		const cliRoot = packageRootFor('cli');
		if (!cliRoot) {
			expect(integratedWorkspaceAvailable, 'CLI workflows are only available in integrated workspace verification').toBe(false);
			return;
		}
		const publishWorkflow = readFileSync(resolve(cliRoot, '.github/workflows/publish.yml'), 'utf8');
		const verifyWorkflow = readFileSync(resolve(cliRoot, '.github/workflows/verify.yml'), 'utf8');
		expect(publishWorkflow).toContain('node-version: 24.12.0');
		expect(verifyWorkflow).toContain('node-version: 24.12.0');
	});

	it('keeps Reviewer verification-only', () => {
		const reviewerRoot = packageRootFor('reviewer');
		if (!reviewerRoot) {
			expect(integratedWorkspaceAvailable, 'Reviewer workflow is only available in integrated workspace verification').toBe(false);
			return;
		}
		const manifest = readFileSync(resolve(reviewerRoot, 'treeseed.package.yaml'), 'utf8');
		expect(manifest).toContain('publish: false');
		expect(manifest).toContain('deploy: false');
		expect(existsSync(resolve(reviewerRoot, '.github/workflows/verify.yml'))).toBe(true);
		expect(existsSync(resolve(reviewerRoot, '.github/workflows/publish.yml'))).toBe(false);
	});

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
			expect(workflowSource).not.toMatch(/(?:npm ci|dependency install) failed; retrying/);
			expect(workflowSource).toContain('Create GitHub release');
			expect(workflowSource).toContain('gh release create "${GITHUB_REF_NAME}"');
			expect(workflowSource).toContain('--generate-notes');
			expect(workflowSource).toContain('--verify-tag');
			expect(verifyWorkflowSource).not.toContain('dependency install failed; retrying');
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
