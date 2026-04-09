import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { packageRoot } from './package-tools.ts';

const textExtensions = new Set(['.js', '.ts', '.mjs', '.cjs', '.d.ts', '.json', '.md']);
const forbiddenPatterns = [
	/['"`]workspace:[^'"`\n]+['"`]/,
	/['"`](?:\.\.\/|\.\/)[^'"`\n]*src\/[^'"`\n]*\.(?:[cm]?js|ts|tsx|json|astro|css)['"`]/,
	/['"`][^'"`\n]*\/packages\/[^'"`\n]*\/src\/[^'"`\n]*['"`]/,
];

function run(command: string, args: string[]) {
	const result = spawnSync(command, args, {
		cwd: packageRoot,
		stdio: 'inherit',
		env: process.env,
	});

	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

function walkFiles(root: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const fullPath = join(root, entry.name);
		if (entry.isDirectory()) {
			files.push(...walkFiles(fullPath));
			continue;
		}
		files.push(fullPath);
	}
	return files;
}

function scanDirectory(root: string) {
	for (const filePath of walkFiles(root)) {
		if (!textExtensions.has(extname(filePath))) continue;
		const source = readFileSync(filePath, 'utf8');
		for (const pattern of forbiddenPatterns) {
			if (pattern.test(source)) {
				throw new Error(`${filePath} contains forbidden publish reference matching ${pattern}.`);
			}
		}
	}
}

function assertCleanDistArtifacts() {
	const forbiddenPaths = [
		resolve(packageRoot, 'dist', 'src'),
		resolve(packageRoot, 'dist', 'test'),
		resolve(packageRoot, 'dist', 'vitest.config.d.ts'),
	];

	for (const targetPath of forbiddenPaths) {
		if (existsSync(targetPath)) {
			throw new Error(`Unexpected publish artifact present in dist: ${targetPath}`);
		}
	}

	for (const filePath of walkFiles(resolve(packageRoot, 'dist'))) {
		if (filePath.endsWith('.d.js')) {
			throw new Error(`Unexpected generated declaration runtime artifact: ${filePath}`);
		}
		if (basename(filePath).startsWith('.ts-run-')) {
			throw new Error(`Unexpected temporary runtime artifact: ${filePath}`);
		}
		if (filePath.includes('/dist/scripts/') && filePath.endsWith('.d.ts')) {
			throw new Error(`Unexpected script declaration artifact: ${filePath}`);
		}
	}
}

run('npm', ['run', 'fixtures:check']);
run('npm', ['run', 'build:dist']);
scanDirectory(resolve(packageRoot, 'dist'));
assertCleanDistArtifacts();
run('npm', ['run', 'test:unit']);
run('npm', ['run', 'test:smoke']);
