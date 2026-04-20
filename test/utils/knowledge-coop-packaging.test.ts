import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	buildKnowledgeCoopKnowledgePackPackage,
	buildKnowledgeCoopTemplatePackage,
	importKnowledgeCoopKnowledgePack,
} from '../../src/operations/services/knowledge-coop-packaging.ts';

function createProjectRoot() {
	const root = mkdtempSync(join(tmpdir(), 'treeseed-knowledge-coop-packaging-'));
	mkdirSync(resolve(root, 'src', 'content', 'objectives'), { recursive: true });
	mkdirSync(resolve(root, 'src', 'content', 'questions'), { recursive: true });
	mkdirSync(resolve(root, 'src', 'content', 'notes'), { recursive: true });
	mkdirSync(resolve(root, 'src', 'content', 'knowledge'), { recursive: true });
	mkdirSync(resolve(root, 'src', 'content', 'pages'), { recursive: true });
	mkdirSync(resolve(root, 'public'), { recursive: true });
	writeFileSync(resolve(root, 'package.json'), `${JSON.stringify({ name: 'knowledge-coop-project', version: '1.2.3' }, null, 2)}\n`, 'utf8');
	writeFileSync(resolve(root, 'treeseed.site.yaml'), 'name: Knowledge Coop Project\nslug: knowledge-coop-project\n', 'utf8');
	writeFileSync(resolve(root, 'src', 'content', 'objectives', 'launch.mdx'), '# Launch\n', 'utf8');
	writeFileSync(resolve(root, 'src', 'content', 'questions', 'first-release.mdx'), '# First release\n', 'utf8');
	writeFileSync(resolve(root, 'src', 'content', 'notes', 'operating-model.mdx'), '# Operating model\n', 'utf8');
	writeFileSync(resolve(root, 'src', 'content', 'knowledge', 'index.mdx'), '# Handbook\n', 'utf8');
	writeFileSync(resolve(root, 'src', 'content', 'pages', 'welcome.mdx'), '# Welcome\n', 'utf8');
	writeFileSync(resolve(root, 'public', 'robots.txt'), 'User-agent: *\nAllow: /\n', 'utf8');
	return root;
}

describe('knowledge coop packaging', () => {
	it('builds a template package with manifest metadata and payload files', () => {
		const root = createProjectRoot();
		const result = buildKnowledgeCoopTemplatePackage(root, {
			projectSlug: 'knowledge-coop-project',
			title: 'Knowledge Coop template',
			summary: 'Starter template',
		});

		expect(result.manifest.kind).toBe('template');
		expect(result.manifest.version).toBe('1.2.3');
		expect(result.files).toContain('package.json');
		expect(result.files).toContain('treeseed.site.yaml');
		expect(existsSync(resolve(result.payloadRoot, 'package.json'))).toBe(true);
		expect(existsSync(result.manifestPath)).toBe(true);
	});

	it('builds and imports a knowledge pack package into another project root', () => {
		const sourceRoot = createProjectRoot();
		const targetRoot = createProjectRoot();
		const packageResult = buildKnowledgeCoopKnowledgePackPackage(sourceRoot, {
			projectSlug: 'knowledge-coop-project',
			title: 'Knowledge Coop pack',
			summary: 'Reusable knowledge content',
		});

		const imported = importKnowledgeCoopKnowledgePack(targetRoot, packageResult.outputRoot);
		expect(imported.manifest.kind).toBe('knowledge_pack');
		expect(imported.importedPaths).toContain('src/content/objectives/launch.mdx');
		expect(readFileSync(resolve(targetRoot, 'src', 'content', 'objectives', 'launch.mdx'), 'utf8')).toContain('# Launch');
	});
});
