import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { managedWorkspaceMatches, managedWorkspacePaths, missingApplicationBootstrapFiles, staleManagedWorkspacePaths } from '../../../src/seeds/workspaces/managed-workspace-overlay.ts';
import { marketApiWorkspaceFiles } from '../../../src/seeds/workspaces/market-api-workspace.ts';

const expected = [
	['artifacts/admin.json', '{"routes":[]}\n'],
	['singleton.manifest.json', '{"managed":true}\n'],
] as const;

describe('private singleton managed workspace overlay', () => {
	it('accepts application-owned files outside the declared overlay', () => {
		const observed = new Map([
			['artifacts/admin.json', '{"routes":[]}'],
			['singleton.manifest.json', '{"managed":true}'],
			['src/market/private-commerce.ts', 'private implementation'],
		]);
		expect(managedWorkspaceMatches({ expected, observed, declaredManagedPaths: managedWorkspacePaths(expected) })).toBe(true);
	});

	it('rejects managed drift and unexpected ownership declarations', () => {
		const observed = new Map([
			['artifacts/admin.json', '{"routes":["drift"]}'],
			['singleton.manifest.json', '{"managed":true}'],
		]);
		expect(managedWorkspaceMatches({ expected, observed, declaredManagedPaths: managedWorkspacePaths(expected) })).toBe(false);
		expect(managedWorkspaceMatches({ expected, observed: new Map(expected.map(([path, content]) => [path, content.trimEnd()])), declaredManagedPaths: ['src/private.ts'] })).toBe(false);
	});

	it('requires exact trees only while adopting the legacy generated workspace', () => {
		const observed = new Map(expected.map(([path, content]) => [path, content.trimEnd()]));
		expect(managedWorkspaceMatches({ expected, observed, legacyObservedPaths: managedWorkspacePaths(expected) })).toBe(true);
		expect(managedWorkspaceMatches({ expected, observed, legacyObservedPaths: [...managedWorkspacePaths(expected), 'src/private.ts'] })).toBe(false);
	});

	it('removes only paths released by the previous managed manifest', () => {
		expect(staleManagedWorkspacePaths(['generated/old.ts', 'generated/current.ts'], ['generated/current.ts'])).toEqual(['generated/old.ts']);
	});

	it('bootstraps an application extension once without reclaiming it', () => {
		const bootstrap = [['src/market/app.ts', 'initial']] as const;
		expect(missingApplicationBootstrapFiles([], bootstrap)).toEqual(bootstrap);
		expect(missingApplicationBootstrapFiles(['src/market/app.ts'], bootstrap)).toEqual([]);
	});

	it('generates a standalone CLI workspace with hosted deployment disabled', () => {
		const root = mkdtempSync(resolve(tmpdir(), 'market-api-workspace-test-'));
		try {
			mkdirSync(resolve(root, 'packages/api/dist'), { recursive: true });
			writeFileSync(resolve(root, 'packages/api/dist/admin-api-descriptor.json'), JSON.stringify({ digest: 'sha256:fixture', sourceRef: null, routes: [] }));
			const generated = new Map(marketApiWorkspaceFiles(root, 'a'.repeat(40), 'b'.repeat(40)).files);
			expect(generated.get('package.json')).toContain('"workspaces": [');
			expect(generated.get('package.json')).toContain('"test": "vitest run"');
			expect(generated.get('treeseed.site.yaml')).toContain('kind: market-singleton');
			expect(generated.get('treeseed.package.yaml')).toContain('deploy: false');
			expect(generated.get('treeseed.package.yaml')).toContain('repository: treeseed-ai/market-api');
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
