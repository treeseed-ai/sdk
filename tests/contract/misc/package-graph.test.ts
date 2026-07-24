import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentTestPath = fileURLToPath(import.meta.url);
const workspaceRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const sdkPackageJsonPath = resolve(workspaceRoot, 'package.json');
const verifyConsumerPackageJsonPaths = [
	resolve(workspaceRoot, '..', '..', 'package.json'),
	resolve(workspaceRoot, '..', 'agent', 'package.json'),
	resolve(workspaceRoot, '..', 'core', 'package.json'),
	resolve(workspaceRoot, '..', 'cli', 'package.json'),
];
const verifyDriverPaths = [
	resolve(workspaceRoot, '..', '..', 'scripts', 'verify-driver.ts'),
	resolve(workspaceRoot, '..', 'agent', 'scripts', 'support', 'verify-driver.ts'),
	resolve(workspaceRoot, '..', 'core', 'scripts', 'support', 'verify-driver.ts'),
	resolve(workspaceRoot, '..', 'cli', 'scripts', 'support', 'verify-driver.ts'),
];
const packageVerifyWorkflowPaths = [
	resolve(workspaceRoot, '.github', 'workflows', 'verify.yml'),
	resolve(workspaceRoot, '..', 'agent', '.github', 'workflows', 'verify.yml'),
	resolve(workspaceRoot, '..', 'core', '.github', 'workflows', 'verify.yml'),
	resolve(workspaceRoot, '..', 'cli', '.github', 'workflows', 'verify.yml'),
];

function walkSourceFiles(root: string): string[] {
	if (!existsSync(root)) {
		return [];
	}
	return readdirSync(root).flatMap((entry: string) => {
		const fullPath = resolve(root, entry);
		const stats = statSync(fullPath);
		if (stats.isDirectory()) {
			if (entry === 'node_modules' || entry === 'dist' || entry === '.git' || entry === '.treeseed') {
				return [];
			}
			return walkSourceFiles(fullPath);
		}
		return [fullPath];
	});
}

describe('sdk package graph', () => {
	it('does not depend on core packages', () => {
		const packageJson = JSON.parse(readFileSync(sdkPackageJsonPath, 'utf8'));
		expect(packageJson.dependencies?.['@treeseed/core']).toBeUndefined();
	});

	it('keeps core package.json independent from the agent package', () => {
		const corePackageJsonPath = resolve(workspaceRoot, '..', 'core', 'package.json');
		if (!existsSync(corePackageJsonPath)) {
			return;
		}
		const packageJson = JSON.parse(readFileSync(corePackageJsonPath, 'utf8'));
		expect(packageJson.dependencies?.['@treeseed/agent']).toBeUndefined();
		expect(packageJson.devDependencies?.['@treeseed/agent']).toBeUndefined();
	});

	it('does not import core runtime modules from sdk source', () => {
		const sourceRoot = resolve(workspaceRoot, 'src');
		const forbidden = [
			"from '@treeseed/core",
			'from "@treeseed/core',
			"from '@treeseed/sdk'",
			'from "@treeseed/sdk"',
		];

		const sourceFiles = walkSourceFiles(sourceRoot)
			.filter((filePath) => /\.(ts|js|mjs)$/u.test(filePath))
			.filter((filePath) => !filePath.includes('/treeseed/template-catalog/templates/'));

		for (const filePath of sourceFiles) {
			const contents = readFileSync(filePath, 'utf8');
			for (const needle of forbidden) {
				expect(contents.includes(needle), `${filePath} contains forbidden import ${needle}`).toBe(false);
			}
		}
	});

	it('enforces package boundaries across sdk and core source', () => {
		const packageChecks = [
			{
				root: resolve(workspaceRoot, 'src'),
				forbidden: ["from '@treeseed/core", 'from "@treeseed/core'],
			},
			{
				root: resolve(workspaceRoot, '..', 'core', 'src'),
				forbidden: ["from '@treeseed/agent", 'from "@treeseed/agent'],
			},
			{
				root: resolve(workspaceRoot, '..', 'agent', 'src'),
				forbidden: ["from '@treeseed/core", 'from "@treeseed/core'],
			},
		];

		for (const check of packageChecks) {
			const files = walkSourceFiles(check.root)
				.filter((filePath) => /\.(ts|js|mjs)$/u.test(filePath))
				.filter((filePath) => !filePath.includes('/.ts-run-'))
				.filter((filePath) => !filePath.includes('/treeseed/template-catalog/templates/'));
			for (const filePath of files) {
				const contents = readFileSync(filePath, 'utf8');
				for (const needle of check.forbidden) {
					expect(contents.includes(needle), `${filePath} contains forbidden import ${needle}`).toBe(false);
				}
			}
		}
	});

	it('does not use deprecated sdk alias paths anywhere in the workspace packages', () => {
		const packagesRoot = resolve(workspaceRoot, '..');
		const forbidden = [
			'@treeseed/sdk/platform/tenant/config',
			'@treeseed/sdk/platform/deploy/config',
			'@treeseed/sdk/platform/plugins/plugin',
			'@treeseed/sdk/types/agents.js',
			'@treeseed/sdk/types/cloudflare.js',
			'@treeseed/sdk/wrangler-d1.js',
			'@treeseed/sdk/utils/agents/runtime-types',
			'@treeseed/sdk/utils/agents/contracts/messages',
			'@treeseed/sdk/utils/agents/contracts/run',
		];

		const files = walkSourceFiles(packagesRoot)
			.filter((filePath) => /\.(ts|tsx|js|mjs|cjs|json|md)$/u.test(filePath))
			.filter((filePath) => !filePath.includes('/.treeseed/'))
			.filter((filePath) => !filePath.includes('/.ts-run-'))
			.filter((filePath) => !filePath.includes('/docs/research/'))
			.filter((filePath) => !filePath.includes('/package-lock.json'))
			.filter((filePath) => !/\/test\/.*\.(?:js|mjs|cjs)$/u.test(filePath))
			.filter((filePath) => filePath !== currentTestPath);

		for (const filePath of files) {
			const contents = readFileSync(filePath, 'utf8');
			for (const needle of forbidden) {
				expect(contents.includes(needle), `${filePath} contains deprecated sdk path ${needle}`).toBe(false);
			}
		}
	}, 20_000);

	it('keeps the canonical agent contracts shim in sdk fixture support', () => {
		const sdkFixtureSupportPath = resolve(workspaceRoot, 'src', 'testing', 'fixture-support.ts');
		expect(existsSync(sdkFixtureSupportPath)).toBe(true);
		const sdkFixtureSupport = readFileSync(sdkFixtureSupportPath, 'utf8');
		expect(sdkFixtureSupport.includes("contractsShim?: 'agent-contracts'")).toBe(true);
		const builtFixtureSupportPath = resolve(workspaceRoot, 'dist', 'fixture-support.js');
		if (existsSync(builtFixtureSupportPath)) {
			const builtFixtureSupport = readFileSync(builtFixtureSupportPath, 'utf8');
			expect(builtFixtureSupport).toContain('./runtime-types.d.ts');
			expect(builtFixtureSupport).not.toContain('./runtime-types.d.js');
		}

		const coreRunFixturePath = resolve(workspaceRoot, '..', 'core', 'scripts', 'run-fixture-astro-command.ts');
		if (existsSync(coreRunFixturePath)) {
			const coreRunFixture = readFileSync(coreRunFixturePath, 'utf8');
			expect(coreRunFixture.includes("from '@treeseed/sdk/fixture-support'")).toBe(true);
			expect(coreRunFixture.includes('buildAgentContractsShimPackage')).toBe(false);
			expect(coreRunFixture.includes("modes: ['contracts-only']")).toBe(true);
			expect(coreRunFixture.includes("workspaceDirName: 'agent'")).toBe(false);
		}
	});

	it('publishes the shared verify executable for package consumers', () => {
		const packageJson = JSON.parse(readFileSync(sdkPackageJsonPath, 'utf8'));
		expect(packageJson.bin?.['treeseed-sdk-verify']).toBe('./dist/scripts/verification/verify-driver.js');
	});

	it('keeps package verify workflows branch-push triggerable for staging saves', () => {
		for (const workflowPath of packageVerifyWorkflowPaths) {
			if (!existsSync(workflowPath)) continue;
			const workflow = readFileSync(workflowPath, 'utf8');
			expect(workflow, `${workflowPath} should define a push trigger`).toMatch(/\bon:\s*\n\s+push:\s*(?:\n|$)/u);
			expect(workflow, `${workflowPath} should not filter verify branch pushes by tag`).not.toMatch(
				/\b(tags|tags-ignore|branches|branches-ignore):/u,
			);
		}
	});

	it('keeps verify consumers on package-local entrypoints without workspace-linked verify dependencies', () => {
		const [workspacePackageJsonPath, ...packageRepoJsonPaths] = verifyConsumerPackageJsonPaths;
		if (existsSync(workspacePackageJsonPath)) {
			const workspacePackageJson = JSON.parse(readFileSync(workspacePackageJsonPath, 'utf8'));
			expect(
				workspacePackageJson.scripts?.verify,
				`${workspacePackageJsonPath} should keep using the published sdk verify script entrypoint`,
			).toBe('treeseed-sdk-verify');
		}

		for (const [index, packageJsonPath] of packageRepoJsonPaths.entries()) {
			if (!existsSync(packageJsonPath)) continue;
			const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
			const verifyDriverPath = verifyDriverPaths[index + 1];
			const verifyScript = packageJson.scripts?.verify;

			if (typeof verifyScript === 'string' && verifyScript.includes('scripts/') && verifyScript.includes('verify-driver.ts')) {
				expect(
					existsSync(verifyDriverPath),
					`${verifyDriverPath} should exist when ${packageJsonPath} uses a package-local verify wrapper`,
				).toBe(true);
				continue;
			}

			expect(
				verifyScript,
				`${packageJsonPath} should use either the package-local verify wrapper or the published sdk verify script entrypoint`,
			).toBe('treeseed-sdk-verify');
		}

		const [workspaceVerifyDriverPath] = verifyDriverPaths;
		expect(existsSync(workspaceVerifyDriverPath), `${workspaceVerifyDriverPath} should not exist in the workspace root`).toBe(false);
	});
});
