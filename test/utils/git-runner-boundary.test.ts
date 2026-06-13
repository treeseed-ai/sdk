import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

function filesUnder(dir: string): string[] {
	const entries: string[] = [];
	for (const entry of readdirSync(dir)) {
		const absolute = resolve(dir, entry);
		const stat = statSync(absolute);
		if (stat.isDirectory()) {
			entries.push(...filesUnder(absolute));
		} else if (/\.(?:ts|tsx|js|mjs)$/u.test(entry)) {
			entries.push(absolute);
		}
	}
	return entries;
}

function relativePath(path: string) {
	return path.slice(root.length + 1).replaceAll('\\', '/');
}

describe('GitRunner boundary', () => {
	it('keeps production raw git process calls inside GitRunner', () => {
		const offenders = [
			...filesUnder(resolve(root, 'packages', 'sdk', 'src')),
			...filesUnder(resolve(root, 'packages', 'cli', 'src')),
			...filesUnder(resolve(root, 'packages', 'core', 'src')),
		].flatMap((file) => {
			const path = relativePath(file);
			if (path === 'packages/sdk/src/operations/services/git-runner.ts') return [];
			const source = readFileSync(file, 'utf8');
			const matches = [
				/run\('git'/u,
				/run\(\['git'\]\[0\]/u,
				/spawnSync\('git'/u,
				/spawnSync\("git"/u,
				/execFileSync\('git'/u,
				/execFileSync\("git"/u,
			].filter((pattern) => pattern.test(source));
			return matches.length > 0 ? [path] : [];
		});
		expect(offenders).toEqual([]);
	});
});
