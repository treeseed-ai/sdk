import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sdkRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const workspaceRoot = resolve(sdkRoot, '..', '..');

describe('root workflow bootstrap selection', () => {
	it('uses auto bootstrap mode in the root verify workflow', () => {
		const source = readFileSync(resolve(workspaceRoot, '.github', 'workflows', 'verify.yml'), 'utf8');

		expect(source).toContain('TREESEED_BOOTSTRAP_MODE: auto');
		expect(source).toContain('submodules: recursive');
	});

	it('uses auto bootstrap mode with recursive submodule checkout in deploy jobs', () => {
		const source = readFileSync(resolve(workspaceRoot, '.github', 'workflows', 'deploy.yml'), 'utf8');

		expect(source).toContain('TREESEED_BOOTSTRAP_MODE: auto');
		expect((source.match(/submodules: recursive/g) ?? []).length).toBeGreaterThanOrEqual(5);
	});
});
