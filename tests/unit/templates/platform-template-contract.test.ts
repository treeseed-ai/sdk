import { mkdirSync,mkdtempSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe,expect,it } from 'vitest';
import { type ResolvedTemplateDefinition,type TemplateManifest,validateTemplateManifest } from '../../../src/operations/services/template-registry/template-categories.ts';
import { resolveVariableValue } from '../../../src/operations/services/template-registry/validate-template-placeholders.ts';

function definition(platform: TemplateManifest['platform'], assets = ['seeds/platform.yaml','scenes/portfolio.yaml']) {
	const root = mkdtempSync(resolve(tmpdir(),'platform-template-contract-'));
	const templateRoot = resolve(root,'template');
	for (const asset of assets) {
		mkdirSync(resolve(templateRoot,asset,'..'),{ recursive: true });
		writeFileSync(resolve(templateRoot,asset),'name: fixture\n','utf8');
	}
	const manifest: TemplateManifest = {
		id: 'platform-fixture', displayName: 'Platform fixture', description: 'Fixture', category: 'platform', tags: [],
		templateApiVersion: 2, minCliVersion: '0.12.0', variables: [], platform, testing: {},
	};
	return { manifest, manifestPath: resolve(root,'template.config.json'), templateRoot, product: {
		id: manifest.id, displayName: manifest.displayName, description: manifest.description, summary: manifest.description,
		category: 'platform' as const, tags: [], status: 'live' as const, templateVersion: '1.0.0', templateApiVersion: 2,
		minCliVersion: '0.12.0', fulfillment: { mode: 'git' as const, source: { kind: 'git' as const, repoUrl: 'https://github.com/treeseed-ai/platform.git', directory: 'templates/platform-fixture', ref: 'a'.repeat(40) } },
		contentPath: 'fixture', artifactRoot: root, artifactManifestPath: resolve(root,'template.config.json'), templateRoot, fulfillmentMode: 'git' as const,
	} } satisfies ResolvedTemplateDefinition;
}

const managed = {
	controlPlane: { mode: 'managed' as const }, processing: { mode: 'local' as const }, admin: { enabled: true },
	executionProvider: 'codex' as const, aiAppliance: false, services: ['api','treeseedDatabase','operationsRunner','treedx'],
	seeds: ['seeds/platform.yaml'], scenes: ['scenes/portfolio.yaml'],
};

describe('Platform template contract', () => {
	it('accepts a complete immutable configuration bundle', () => {
		expect(() => validateTemplateManifest(definition(managed))).not.toThrow();
	});

	it.each(['.treeseed/scenes/runs/run.yaml','scenes/screenshots/result.yaml','scenes/run.log','../secret.yaml'])(
		'rejects generated evidence or nonportable assets: %s',
		(path) => expect(() => validateTemplateManifest(definition({ ...managed, scenes: [path] }, ['seeds/platform.yaml',path]))).toThrow(/portable configuration asset|must be YAML/u),
	);

	it('requires complete managed control-plane services', () => {
		expect(() => validateTemplateManifest(definition({ ...managed, services: ['api'] }))).toThrow(/requires treeseedDatabase/u);
	});

	it('requires an explicit external control-plane binding', () => {
		expect(() => validateTemplateManifest(definition({ ...managed, controlPlane: { mode: 'external' } }))).toThrow(/external control-plane URL/u);
	});

	it('preserves declared per-run scene inputs until the scene generator resolves them', () => {
		const variable = { name: 'Runtime username', token: '__PORTFOLIO_USERNAME__', deriveFrom: 'runtime' };
		expect(resolveVariableValue(variable, { target: 'platform' })).toBe(variable.token);
	});
});
