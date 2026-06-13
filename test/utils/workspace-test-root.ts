import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
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
	return path ? readFileSync(path, 'utf8') : null;
}

export function filesUnderIfExists(dir: string | null): string[] {
	if (!dir || !existsSync(dir)) return [];
	const entries: string[] = [];
	for (const entry of readdirSync(dir)) {
		const absolute = resolve(dir, entry);
		const stat = statSync(absolute);
		if (stat.isDirectory()) {
			entries.push(...filesUnderIfExists(absolute));
		} else if (/\.(?:ts|tsx|js|mjs)$/u.test(entry)) {
			entries.push(absolute);
		}
	}
	return entries;
}

export function treeseedRelativePath(testRoot: TreeseedTestRoot, path: string): string {
	if (testRoot.layout === 'workspace') {
		return relative(testRoot.root, path).replaceAll('\\', '/');
	}
	return `packages/sdk/${relative(testRoot.root, path).replaceAll('\\', '/')}`;
}
