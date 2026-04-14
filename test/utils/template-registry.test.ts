import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { scaffoldTemplateProject } from '../../src/operations/services/template-registry.ts';

function git(cwd: string, args: string[]) {
	const result = spawnSync('git', args, {
		cwd,
		stdio: 'pipe',
		encoding: 'utf8',
	});
	if (result.status !== 0) {
		throw new Error(result.stderr?.trim() || result.stdout?.trim() || `git ${args.join(' ')} failed`);
	}
}

describe('template registry fulfillment', () => {
	it('can scaffold a template from a remote git fulfillment source when no packaged artifact exists', async () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-template-registry-'));
		const repoRoot = resolve(root, 'template-repo');
		const targetRoot = resolve(root, 'generated-site');
		mkdirSync(resolve(repoRoot, 'templates', 'starter-remote', 'template', 'src'), { recursive: true });
		writeFileSync(resolve(repoRoot, 'templates', 'starter-remote', 'template.config.json'), JSON.stringify({
			id: 'starter-remote',
			displayName: 'Starter Remote',
			description: 'Remote starter',
			category: 'starter',
			tags: [],
			templateVersion: '1.0.0',
			templateApiVersion: 1,
			minCliVersion: '0.1.0',
			variables: [
				{ name: 'Name', token: '__SITE_NAME__', deriveFrom: 'name', required: true },
			],
			testing: {},
		}, null, 2), 'utf8');
		writeFileSync(resolve(repoRoot, 'templates', 'starter-remote', 'template', 'README.md'), '# __SITE_NAME__\n', 'utf8');
		git(repoRoot, ['init', '-b', 'main']);
		git(repoRoot, ['config', 'user.name', 'Treeseed Test']);
		git(repoRoot, ['config', 'user.email', 'treeseed@example.com']);
		git(repoRoot, ['add', '-A']);
		git(repoRoot, ['commit', '-m', 'init template']);

		const catalogPath = resolve(root, 'catalog.json');
		writeFileSync(catalogPath, JSON.stringify({
			items: [
				{
					id: 'starter-remote',
					displayName: 'Starter Remote',
					description: 'Remote starter',
					summary: 'Remote starter',
					status: 'live',
					category: 'starter',
					publisher: { id: 'treeseed', name: 'TreeSeed' },
					templateVersion: '1.0.0',
					templateApiVersion: 1,
					minCliVersion: '0.1.0',
					fulfillment: {
						mode: 'git',
						source: {
							repoUrl: repoRoot,
							directory: 'templates/starter-remote',
							ref: 'main',
						},
						hooksPolicy: 'builtin_only',
						supportsReconcile: true,
					},
				},
			],
		}), 'utf8');

		const definition = await scaffoldTemplateProject('starter-remote', targetRoot, {
			target: 'generated-site',
			name: 'Remote Site',
		}, {
			cwd: root,
			env: {
				TREESEED_TEMPLATE_CATALOG_URL: `file:${catalogPath}`,
			},
		});

		expect(definition.id).toBe('starter-remote');
		expect(readFileSync(resolve(targetRoot, 'README.md'), 'utf8')).toContain('Remote Site');
		expect(readFileSync(resolve(targetRoot, '.treeseed', 'template-state.json'), 'utf8')).toContain('starter-remote');
	});
});
