import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type TreeseedTestRoot = {
	root: string;
	layout: 'workspace' | 'sdk-package';
};

export function resolveTreeseedTestRoot(metaUrl: string): TreeseedTestRoot {
	const start = dirname(fileURLToPath(metaUrl));
	let current = start;
	for (;;) {
		if (existsSync(resolve(current, 'packages', 'sdk', 'src'))) {
			return { root: current, layout: 'workspace' };
		}
		if (existsSync(resolve(current, 'src')) && existsSync(resolve(current, 'package.json'))) {
			try {
				const packageJson = JSON.parse(readFileSync(resolve(current, 'package.json'), 'utf8')) as { name?: string };
				if (packageJson.name === '@treeseed/sdk') {
					return { root: current, layout: 'sdk-package' };
				}
			} catch {
				// Keep walking upward.
			}
		}
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return { root: resolve(start, '..', '..'), layout: 'sdk-package' };
}

export function resolveTreeseedTestPath(testRoot: TreeseedTestRoot, relativePath: string): string | null {
	if (testRoot.layout === 'workspace') {
		const path = resolve(testRoot.root, relativePath);
		return existsSync(path) ? path : null;
	}
	if (relativePath.startsWith('packages/sdk/')) {
		const path = resolve(testRoot.root, relativePath.slice('packages/sdk/'.length));
		return existsSync(path) ? path : null;
	}
	return null;
}

export function readTreeseedTestSource(testRoot: TreeseedTestRoot, relativePath: string): string | null {
	const path = resolveTreeseedTestPath(testRoot, relativePath);
	return path ? readSourceModule(path) : null;
}

/** Reads a public module entrypoint together with its same-named implementation directory. */
export function readSourceModule(path: string | URL): string {
	const absolute = path instanceof URL ? fileURLToPath(path) : path;
	const source = readFileSync(absolute, 'utf8');
	const extension = extname(absolute);
	const implementationDir = resolve(dirname(absolute), basename(absolute, extension));
	const implementation = filesUnderIfExists(implementationDir)
		.sort()
		.map((file) => readFileSync(file, 'utf8'));
	return [source, ...implementation].join('\n');
}

/** Extracts a named function regardless of declaration order in a composed source module. */
export function sourceFunctionBody(source: string, functionName: string): string {
	const marker = new RegExp(`(?:async\\s+)?function\\s+${functionName}\\s*\\(`, 'u');
	const match = marker.exec(source);
	if (!match) return '';
	const start = match.index;
	const parametersStart = start + match[0].lastIndexOf('(');
	let parameterDepth = 0;
	let parametersEnd = -1;
	for (let index = parametersStart; index < source.length; index += 1) {
		if (source[index] === '(') parameterDepth += 1;
		if (source[index] === ')') {
			parameterDepth -= 1;
			if (parameterDepth === 0) {
				parametersEnd = index;
				break;
			}
		}
	}
	const open = parametersEnd < 0 ? -1 : source.indexOf('{', parametersEnd);
	if (open < 0) return '';
	let depth = 0;
	for (let index = open; index < source.length; index += 1) {
		if (source[index] === '{') depth += 1;
		if (source[index] === '}') {
			depth -= 1;
			if (depth === 0) return source.slice(start, index + 1);
		}
	}
	return '';
}

export function filesUnderIfExists(dir: string | null): string[] {
	if (!dir || !existsSync(dir)) return [];
	const entries: string[] = [];
	for (const entry of readdirSync(dir)) {
		const absolute = resolve(dir, entry);
		const stat = statSync(absolute);
		if (stat.isDirectory()) {
			entries.push(...filesUnderIfExists(absolute));
		} else if (/\.(?:ts|tsx|js|mjs)$/u.test(entry) && !isSideBySideBuildArtifact(absolute)) {
			entries.push(absolute);
		}
	}
	return entries;
}

function isSideBySideBuildArtifact(path: string): boolean {
	if (path.endsWith('.d.ts')) return true;
	if (!path.endsWith('.js')) return false;
	const sourcePath = path.replace(/\.js$/u, '.ts');
	return existsSync(sourcePath);
}

export function treeseedRelativePath(testRoot: TreeseedTestRoot, path: string): string {
	if (testRoot.layout === 'workspace') {
		return relative(testRoot.root, path).replaceAll('\\', '/');
	}
	return `packages/sdk/${relative(testRoot.root, path).replaceAll('\\', '/')}`;
}
