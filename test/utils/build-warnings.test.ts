import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];
const scriptPath = resolve(process.cwd(), 'scripts/check-build-warnings.ts');

function makeLog(contents: string) {
	const root = mkdtempSync(join(tmpdir(), 'treeseed-build-warnings-'));
	roots.push(root);
	const logPath = join(root, 'verify.log');
	writeFileSync(logPath, contents, 'utf8');
	return logPath;
}

describe('build warning scanner', () => {
	afterEach(() => {
		for (const root of roots.splice(0)) {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('allows SDK-owned known provider warnings by default', () => {
		const logPath = makeLog('[WARN] [vite] [plugin vite:resolve] Module "url" has been externalized for browser compatibility, imported by "/workspace/node_modules/libsodium-sumo/dist/modules-sumo-esm/libsodium-sumo.mjs".\n');

		const output = execFileSync('tsx', [scriptPath, logPath], { encoding: 'utf8' });

		expect(output).toContain('Allowed build warnings: 1');
		expect(output).toContain('vite-browser-external-libsodium-url: 1');
		expect(output).toContain('No unexpected build warnings detected.');
	});

	it('allows ANSI-styled newer Vite provider warnings by default', () => {
		const logPath = makeLog('\u001b[33m\u001b[1m07:01:16\u001b[22m [WARN] [vite]\u001b[39m \u001b[33m[plugin vite:resolve] Automatically externalized node built-in module "url" imported from "node_modules/libsodium-sumo/dist/modules-sumo-esm/libsodium-sumo.mjs". Consider adding it to environments.ssr.external if it is intended.\u001b[39m\n');

		const output = execFileSync('tsx', [scriptPath, logPath], { encoding: 'utf8' });

		expect(output).toContain('Allowed build warnings: 1');
		expect(output).toContain('vite-browser-external-libsodium-url: 1');
		expect(output).toContain('No unexpected build warnings detected.');
	});

	it('can disable the default warning policy for strict debugging', () => {
		const logPath = makeLog('[WARN] [vite] [plugin vite:resolve] Module "url" has been externalized for browser compatibility, imported by "/workspace/node_modules/libsodium-sumo/dist/modules-sumo-esm/libsodium-sumo.mjs".\n');

		const result = spawnSync('tsx', [scriptPath, logPath, '--no-default-policy'], { encoding: 'utf8' });

		expect(result.status).toBe(1);
		expect(result.stderr).toContain('Unexpected build warnings detected');
		expect(result.stdout).not.toContain('Allowed build warnings');
	});

	it('still fails unexpected warnings', () => {
		const logPath = makeLog('[WARN] unexpected warning\n');

		const result = spawnSync('tsx', [scriptPath, logPath], { encoding: 'utf8' });

		expect(result.status).toBe(1);
		expect(result.stderr).toContain('unexpected warning');
	});
});
