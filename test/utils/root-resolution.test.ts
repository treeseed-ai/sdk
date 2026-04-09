import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runTreeseedCli, resolveTreeseedCommandCwd } from '../../src/treeseed/cli/runtime.ts';
import { findTreeseedOperation } from '../../src/operations.ts';

function makeTreeseedWorkspace() {
	const root = mkdtempSync(join(tmpdir(), 'treeseed-root-resolution-'));
	mkdirSync(resolve(root, 'src'), { recursive: true });
	writeFileSync(resolve(root, 'package.json'), JSON.stringify({
		name: 'treeseed-root-resolution',
		private: true,
		workspaces: ['packages/*'],
	}, null, 2));
	writeFileSync(resolve(root, 'treeseed.site.yaml'), `name: Test
slug: test
siteUrl: https://example.com
contactEmail: hello@example.com
cloudflare:
  accountId: account-123
providers:
  forms: store_only
  agents:
    execution: stub
    mutation: local_branch
    repository: stub
    verification: stub
    notification: stub
    research: stub
  deploy: cloudflare
  content:
    docs: default
  site: default
services:
  manager:
    enabled: true
    provider: railway
    railway:
      projectName: test
      serviceName: manager
`, 'utf8');
	writeFileSync(resolve(root, 'src', 'manifest.yaml'), `id: test
siteConfigPath: ./src/config.yaml
content:
  pages: ./src/content/pages
features:
  docs: true
`, 'utf8');
	writeFileSync(resolve(root, 'src', 'config.yaml'), 'site:\n  name: Test\n', 'utf8');
	mkdirSync(resolve(root, 'src', 'content'), { recursive: true });
	mkdirSync(resolve(root, 'packages', 'placeholder'), { recursive: true });
	writeFileSync(resolve(root, 'packages', 'placeholder', 'package.json'), JSON.stringify({
		name: '@test/placeholder',
		version: '0.0.1',
	}, null, 2));
	return root;
}

async function runCli(argv: string[], cwd: string) {
	const writes: Array<{ output: string; stream?: 'stdout' | 'stderr' }> = [];
	const exitCode = await runTreeseedCli(argv, {
		cwd,
		env: process.env,
		write: (output, stream) => writes.push({ output, stream }),
		spawn: vi.fn(() => ({ status: 0 })),
	});
	return { exitCode, writes };
}

describe('treeseed upward root resolution', () => {
	it('resolves handler commands to the nearest Treeseed root', async () => {
		const root = makeTreeseedWorkspace();
		const nested = resolve(root, 'src');

		const result = await runCli(['status', '--json'], nested);
		const payload = JSON.parse(result.writes[0]?.output ?? '{}');

		expect(result.exitCode).toBe(0);
		expect(payload.state.cwd).toBe(root);
		expect(payload.state.workspaceRoot).toBe(true);
	});

	it('resolves doctor from a nested content directory', async () => {
		const root = makeTreeseedWorkspace();
		const nested = resolve(root, 'src', 'content');

		const result = await runCli(['doctor', '--json'], nested);
		const payload = JSON.parse(result.writes[0]?.output ?? '{}');

		expect(payload.state.cwd).toBe(root);
		expect(payload.command).toBe('doctor');
	});

	it('runs workspace-only adapter commands from nested directories using the resolved root', async () => {
		const root = makeTreeseedWorkspace();
		const nested = resolve(root, 'src');
		const spawn = vi.fn(() => ({ status: 0 }));

		const exitCode = await runTreeseedCli(['test:unit'], {
			cwd: nested,
			env: process.env,
			write: vi.fn(),
			spawn,
		});

		expect(exitCode).toBe(0);
		expect(spawn).toHaveBeenCalledWith(
			process.execPath,
			expect.any(Array),
			expect.objectContaining({ cwd: root }),
		);
	});

	it('returns a clear error when no Treeseed ancestor exists', async () => {
		const outside = mkdtempSync(join(tmpdir(), 'treeseed-no-root-'));

		const result = await runCli(['status', '--json'], outside);
		const payload = JSON.parse(result.writes[0]?.output ?? '{}');

		expect(result.exitCode).toBe(1);
		expect(payload.error).toContain('No ancestor containing treeseed.site.yaml');
	});

	it('keeps init anchored to the actual current directory', () => {
		const outside = mkdtempSync(join(tmpdir(), 'treeseed-init-root-'));
		const spec = findTreeseedOperation('init');
		if (!spec) {
			throw new Error('Expected init operation spec.');
		}

		const resolved = resolveTreeseedCommandCwd(spec, outside);
		expect(resolved.cwd).toBe(outside);
		expect(resolved.resolvedProjectRoot).toBeNull();
	});
});
