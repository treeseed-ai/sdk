import { readFileSync, readdirSync, statSync } from 'node:fs';
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
		];

		const walk = (root: string): string[] => {
			return readdirSync(root).flatMap((entry: string) => {
				const fullPath = resolve(root, entry);
				const stats = statSync(fullPath);
				return stats.isDirectory() ? walk(fullPath) : [fullPath];
			});
		};

		const sourceFiles = walk(sourceRoot)
			.filter((filePath) => /\.(ts|js|mjs)$/u.test(filePath))
			.filter((filePath) => !filePath.includes('/treeseed/template-catalog/templates/'));

		for (const filePath of sourceFiles) {
			const contents = readFileSync(filePath, 'utf8');
			for (const needle of forbidden) {
				expect(contents.includes(needle), `${filePath} contains forbidden import ${needle}`).toBe(false);
			}
		}
	});

	it('publishes the shared verify executable for package consumers', () => {
		const packageJson = JSON.parse(readFileSync(sdkPackageJsonPath, 'utf8'));
		expect(packageJson.bin?.['treeseed-sdk-verify']).toBe('./scripts/verify-driver.mjs');
	});

	it('keeps verify consumers on the published sdk executable without local wrappers', () => {
		for (const packageJsonPath of verifyConsumerPackageJsonPaths) {
			const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
			expect(
				packageJson.scripts?.verify,
				`${packageJsonPath} should use the published sdk verify script entrypoint`,
			).toBe('node --input-type=module -e "await import(\'@treeseed/sdk/scripts/verify-driver\')"');
		}

		for (const filePath of removedVerifyDriverPaths) {
			expect(() => statSync(filePath), `${filePath} should not exist`).toThrow();
		}
	});
});
