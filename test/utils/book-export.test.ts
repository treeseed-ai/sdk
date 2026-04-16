import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildBookExportManifest, exportBookLibrary, exportBookPackage } from '../../src/platform/book-export.ts';

const tempRoots: string[] = [];

function writeBookDefinition(filePath: string, content: string) {
	writeFileSync(filePath, `${content}\nBook definition body.\n`, 'utf8');
}

function createBookFixture() {
	const root = mkdtempSync(join(tmpdir(), 'treeseed-book-export-'));
	tempRoots.push(root);

	mkdirSync(resolve(root, 'src', 'content', 'books'), { recursive: true });
	mkdirSync(resolve(root, 'src', 'content', 'knowledge', 'alpha'), { recursive: true });
	mkdirSync(resolve(root, 'src', 'content', 'knowledge', 'beta'), { recursive: true });

	writeFileSync(resolve(root, 'src', 'manifest.yaml'), `id: test-site
siteConfigPath: ./src/config.yaml
content:
  pages: ./src/content/pages
  notes: ./src/content/notes
  questions: ./src/content/questions
  objectives: ./src/content/objectives
  people: ./src/content/people
  agents: ./src/content/agents
  books: ./src/content/books
  docs: ./src/content/knowledge
features:
  docs: true
  books: true
`, 'utf8');
	writeFileSync(resolve(root, 'src', 'config.yaml'), 'title: Test Site\n', 'utf8');

	writeBookDefinition(resolve(root, 'src', 'content', 'books', 'alpha-book.md'), `---
order: 1
slug: alpha-book
title: Alpha Book
description: Alpha description
summary: Alpha summary
sectionLabel: Alpha
basePath: /knowledge/alpha/
landingPath: /knowledge/alpha/
downloadFileName: alpha-book.md
downloadHref: /books/alpha-book.md
downloadTitle: Alpha Book Package
exportRoots:
  - ./src/content/knowledge/alpha
sidebarItems: []
---`);
	writeBookDefinition(resolve(root, 'src', 'content', 'books', 'beta-book.md'), `---
order: 2
slug: beta-book
title: Beta Book
description: Beta description
summary: Beta summary
sectionLabel: Beta
basePath: /knowledge/beta/
landingPath: /knowledge/beta/
downloadFileName: beta-book.md
downloadHref: /books/beta-book.md
downloadTitle: Beta Book Package
sidebarItems: []
---`);

	writeFileSync(resolve(root, 'src', 'content', 'knowledge', 'alpha', '02-next.mdx'), `---
order: 2
---

# Next

export const alpha = true;
`, 'utf8');
	writeFileSync(resolve(root, 'src', 'content', 'knowledge', 'alpha', '01-intro.md'), `---
order: 1
---

# Intro

Alpha intro.
`, 'utf8');
	writeFileSync(resolve(root, 'src', 'content', 'knowledge', 'beta', '01-overview.md'), `---
order: 1
---

# Beta

Beta overview.
`, 'utf8');

	return root;
}

afterEach(() => {
	for (const root of tempRoots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

describe('book export runtime', () => {
	it('builds ordered manifests from book definitions and export roots', () => {
		const root = createBookFixture();
		const manifest = buildBookExportManifest('alpha-book', { projectRoot: root });

		expect(manifest.packageKind).toBe('book');
		expect(manifest.book.slug).toBe('alpha-book');
		expect(manifest.book.resolvedRoots).toEqual(['src/content/knowledge/alpha']);
		expect(manifest.files.map((file) => file.projectRelativePath)).toEqual([
			'src/content/knowledge/alpha/01-intro.md',
			'src/content/knowledge/alpha/02-next.mdx',
		]);
		expect(manifest.files.map((file) => file.ordinal)).toEqual([1, 2]);
		expect(manifest.files[0]?.sourceType).toBe('md');
		expect(manifest.files[1]?.sourceType).toBe('mdx');
	});

	it('exports a per-book markdown package and json sidecar', async () => {
		const root = createBookFixture();
		const result = await exportBookPackage('alpha-book', { projectRoot: root });

		expect(result.markdownPath).toBe(resolve(root, 'public', 'books', 'alpha-book.md'));
		expect(result.indexPath).toBe(resolve(root, 'public', 'books', 'alpha-book.json'));

		const markdown = readFileSync(result.markdownPath, 'utf8');
		const indexJson = JSON.parse(readFileSync(result.indexPath, 'utf8'));
		expect(markdown).toContain('<!-- TRESEED_PACKAGE_MANIFEST_BEGIN -->');
		expect(markdown).toContain('<!-- TRESEED_PACKAGE_CONTENT_BEGIN -->');
		expect(markdown).toContain('## File: manifest/book.json');
		expect(markdown).toContain('## File: content/0001/01-intro.md');
		expect(indexJson.packageKind).toBe('book');
		expect(indexJson.files[0].projectRelativePath).toBe('src/content/knowledge/alpha/01-intro.md');
		expect(indexJson.files[0].relations.book).toBe('alpha-book');
	}, 15000);

	it('exports an aggregate library package with ordered member packages', async () => {
		const root = createBookFixture();
		const result = await exportBookLibrary({ projectRoot: root });

		expect(result.markdownPath).toBe(resolve(root, 'public', 'books', 'treeseed-knowledge.md'));
		expect(result.memberPackages.map((entry) => entry.manifest.book.slug)).toEqual(['alpha-book', 'beta-book']);
		const markdown = readFileSync(result.markdownPath, 'utf8');
		const indexJson = JSON.parse(readFileSync(result.indexPath, 'utf8'));
		expect(markdown).toContain('<!-- TRESEED_AGGREGATE_MEMBER_BEGIN alpha-book -->');
		expect(markdown).toContain('<!-- TRESEED_AGGREGATE_MEMBER_BEGIN beta-book -->');
		expect(indexJson.packageKind).toBe('library');
		expect(indexJson.members.map((entry: { slug: string }) => entry.slug)).toEqual(['alpha-book', 'beta-book']);
		expect(indexJson.files.some((entry: { memberBookId: string }) => entry.memberBookId === 'beta-book')).toBe(true);
	}, 30000);
});
