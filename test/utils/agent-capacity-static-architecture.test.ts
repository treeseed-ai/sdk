import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const packageRoot = process.cwd();
const roots = [resolve(packageRoot, 'src/agent-capacity'), resolve(packageRoot, 'src/capacity-provider')];
const rootModules = [resolve(packageRoot, 'src/agent-capacity.ts'), resolve(packageRoot, 'src/capacity-provider.ts')];
const suppression = /@ts-(?:nocheck|ignore|expect-error)|eslint-disable|biome-ignore/gu;
const forbiddenImport = /from\s+['"]@treeseed\/(?:admin|agent|api|cli|core|ui)(?:\/[^'"]*)?['"]/gu;

function sourceFiles(root: string): string[] {
	return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
		const path = resolve(root, entry.name);
		return entry.isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : [];
	});
}

describe('portable agent-capacity static architecture', () => {
	it('keeps canonical modules focused, unsuppressed, and inside the SDK boundary', () => {
		const failures: Array<{ file: string; issue: string }> = [];
		for (const path of [...roots.flatMap(sourceFiles), ...rootModules]) {
			const source = readFileSync(path, 'utf8');
			const file = relative(packageRoot, path);
			const lines = source.split(/\r?\n/u).length;
			if (lines > 500) failures.push({ file, issue: `${lines} lines exceeds 500` });
			if (suppression.test(source)) failures.push({ file, issue: 'compiler or lint suppression' });
			suppression.lastIndex = 0;
			if (forbiddenImport.test(source)) failures.push({ file, issue: 'forbidden package-boundary import' });
			forbiddenImport.lastIndex = 0;
		}
		expect(failures).toEqual([]);
	});
});
