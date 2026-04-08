import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { packageRoot } from './package-tools.ts';

const textExtensions = new Set(['.js', '.ts', '.mjs', '.cjs', '.d.ts', '.json', '.md']);
const forbiddenPatterns = [
	/['"`]file:[^'"`\n]+['"`]/,
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

run('npm', ['run', 'fixtures:check']);
run('npm', ['run', 'build:dist']);
scanDirectory(resolve(packageRoot, 'dist'));
run('npm', ['run', 'test:unit']);
run('npm', ['run', 'test:smoke']);
