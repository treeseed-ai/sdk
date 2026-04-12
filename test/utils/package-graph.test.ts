import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const workspaceRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const sdkPackageJsonPath = resolve(workspaceRoot, 'package.json');
const verifyConsumerPackageJsonPaths = [
	resolve(workspaceRoot, '..', '..', 'package.json'),
	resolve(workspaceRoot, '..', 'core', 'package.json'),
	resolve(workspaceRoot, '..', 'agent', 'package.json'),
	resolve(workspaceRoot, '..', 'cli', 'package.json'),
	resolve(workspaceRoot, '..', 'api', 'package.json'),
];
const removedVerifyDriverPaths = [
	resolve(workspaceRoot, '..', '..', 'scripts', 'verify-driver.mjs'),
	resolve(workspaceRoot, '..', 'core', 'scripts', 'verify-driver.mjs'),
	resolve(workspaceRoot, '..', 'agent', 'scripts', 'verify-driver.mjs'),
	resolve(workspaceRoot, '..', 'cli', 'scripts', 'verify-driver.mjs'),
	resolve(workspaceRoot, '..', 'api', 'scripts', 'verify-driver.mjs'),
];

function walkSourceFiles(root: string): string[] {
	return readdirSync(root).flatMap((entry: string) => {
		const fullPath = resolve(root, entry);
		const stats = statSync(fullPath);
		if (stats.isDirectory()) {
			if (entry === 'node_modules' || entry === 'dist' || entry === '.git') {
				return [];
			}
			return walkSourceFiles(fullPath);
		}
		return [fullPath];
	});
}

describe('sdk package graph', () => {
	it('does not depend on core or agent packages', () => {
		const packageJson = JSON.parse(readFileSync(sdkPackageJsonPath, 'utf8'));
		expect(packageJson.dependencies?.['@treeseed/core']).toBeUndefined();
		expect(packageJson.dependencies?.['@treeseed/agent']).toBeUndefined();
	});

	it('does not import core or agent runtime modules from sdk source', () => {
		const sourceRoot = resolve(workspaceRoot, 'src');
		const forbidden = [
			"from '@treeseed/core",
			'from "@treeseed/core',
			"from '@treeseed/agent",
			'from "@treeseed/agent',
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

	it('enforces package boundaries across sdk, core, and agent source', () => {
		const packageChecks = [
			{
				root: resolve(workspaceRoot, 'src'),
				forbidden: ["from '@treeseed/core", 'from "@treeseed/core', "from '@treeseed/agent", 'from "@treeseed/agent'],
			},
			{
				root: resolve(workspaceRoot, '..', 'core', 'src'),
				forbidden: ["from '@treeseed/agent", 'from "@treeseed/agent', "from '@treeseed/sdk'", 'from "@treeseed/sdk"'],
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
			.filter((filePath) => !filePath.includes('/.ts-run-'))
			.filter((filePath) => !filePath.includes('/package-lock.json'))
			.filter((filePath) => !filePath.endsWith('/sdk/test/utils/package-graph.test.ts'));

		for (const filePath of files) {
			const contents = readFileSync(filePath, 'utf8');
			for (const needle of forbidden) {
				expect(contents.includes(needle), `${filePath} contains deprecated sdk path ${needle}`).toBe(false);
			}
		}
	});

	it('publishes the shared verify executable for package consumers', () => {
		const packageJson = JSON.parse(readFileSync(sdkPackageJsonPath, 'utf8'));
		expect(packageJson.bin?.['treeseed-sdk-verify']).toBe('./scripts/verify-driver.mjs');
	});

	it('keeps verify consumers on the published sdk executable without local wrappers', () => {
		for (const packageJsonPath of verifyConsumerPackageJsonPaths) {
			if (!existsSync(packageJsonPath)) continue;
			const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
			expect(
				packageJson.scripts?.verify,
				`${packageJsonPath} should use the published sdk verify script entrypoint`,
			).toBe('node --input-type=module -e "await import(\'@treeseed/sdk/scripts/verify-driver\')"');
		}

		for (const filePath of removedVerifyDriverPaths) {
			expect(existsSync(filePath), `${filePath} should not exist`).toBe(false);
		}
	});
});
