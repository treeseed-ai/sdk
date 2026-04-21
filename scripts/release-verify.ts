import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { packageRoot } from './package-tools.ts';

const npmCacheDir = mkdtempSync(join(tmpdir(), 'treeseed-sdk-npm-cache-'));

const textExtensions = new Set(['.js', '.ts', '.mjs', '.cjs', '.d.ts', '.json', '.md']);
const forbiddenPatterns = [
	/['"`]workspace:[^'"`\n]+['"`]/,
	/['"`](?:\.\.\/|\.\/)[^'"`\n]*src\/[^'"`\n]*\.(?:[cm]?js|ts|tsx|json|astro|css)['"`]/,
	/['"`][^'"`\n]*\/packages\/[^'"`\n]*\/src\/[^'"`\n]*['"`]/,
];

function run(command: string, args: string[], cwd = packageRoot) {
	const result = spawnSync(command, args, {
		cwd,
		stdio: 'inherit',
		env: {
			...process.env,
			npm_config_cache: npmCacheDir,
			NPM_CONFIG_CACHE: npmCacheDir,
		},
	});

	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

function assertNoLocalDependencyLinks() {
	const packageJson = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>;
	for (const sectionName of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
		for (const [dependencyName, version] of Object.entries(packageJson[sectionName] ?? {})) {
			if (version.startsWith('workspace:') || version.startsWith('file:')) {
				throw new Error(`package.json ${sectionName}.${dependencyName} must not use local dependency specifiers: ${version}`);
			}
		}
	}

	const lockfile = JSON.parse(readFileSync(resolve(packageRoot, 'package-lock.json'), 'utf8')) as {
		packages?: Record<string, { resolved?: string; link?: boolean }>;
	};
	for (const [entryKey, entryValue] of Object.entries(lockfile.packages ?? {})) {
		if (entryKey.startsWith('../') || entryKey.includes('/../')) {
			throw new Error(`package-lock.json contains forbidden local package entry: ${entryKey}`);
		}
		if (entryValue.link) {
			throw new Error(`package-lock.json contains forbidden linked dependency entry: ${entryKey}`);
		}
		const resolved = entryValue.resolved ?? '';
		if (
			resolved.startsWith('../')
			|| resolved.startsWith('./')
			|| resolved.startsWith('file:')
			|| resolved.startsWith('workspace:')
		) {
			throw new Error(`package-lock.json contains forbidden local resolution for ${entryKey}: ${resolved}`);
		}
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

assertNoLocalDependencyLinks();
run('npm', ['run', 'lint']);
scanDirectory(resolve(packageRoot, 'dist'));
assertCleanDistArtifacts();
run('npm', ['run', 'test:unit']);
run('npm', ['run', 'test:smoke']);
