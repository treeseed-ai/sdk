import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { TreeseedBookDefinition, TreeseedTenantConfig } from '../contracts.ts';
import { getTenantContentRoot } from '../tenant/config.ts';
import { RUNTIME_PROJECT_ROOT, RUNTIME_TENANT } from '../tenant/runtime-config.ts';

interface DocsLibraryDownload {
	downloadFileName: string;
	downloadHref: string;
	downloadTitle: string;
}

interface TenantBookRuntime {
	BOOKS: TreeseedBookDefinition[];
	BOOKS_LINK: {
		label: string;
		link: string;
	};
	TREESEED_LINKS: {
		home: string;
	};
	TREESEED_LIBRARY_DOWNLOAD: DocsLibraryDownload;
}

function sortPaths(paths: string[]) {
	return [...paths].sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }));
}

function collectMarkdownFiles(rootPath: string): string[] {
	const stats = statSync(rootPath);
	if (stats.isFile()) {
		return [rootPath];
	}

	return sortPaths(
		readdirSync(rootPath, { withFileTypes: true }).flatMap((entry) => {
			const fullPath = path.join(rootPath, entry.name);
			if (entry.isDirectory()) {
				return collectMarkdownFiles(fullPath);
			}

			if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.mdx'))) {
				return [fullPath];
			}

			return [];
		}),
	);
}

function parseFrontmatter(filePath: string) {
	const raw = readFileSync(filePath, 'utf8');
	const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) {
		throw new Error(`Book content entry is missing frontmatter: ${filePath}`);
	}

	return parseYaml(match[1]) as Record<string, unknown>;
}

function inferDocsLibraryDownload(book?: { slug?: string; title?: string }): DocsLibraryDownload {
	const title = book?.title ? `${book.title} Library` : 'Knowledge Library';
	return {
		downloadFileName: 'treeseed-knowledge.md',
		downloadHref: '/books/treeseed-knowledge.md',
		downloadTitle: title,
	};
}

export function buildTenantBookRuntime(
	tenantConfig: Pick<TreeseedTenantConfig, 'content'>,
	options: {
		projectRoot?: string;
		docsHomePath?: string;
		docsLibraryDownload?: DocsLibraryDownload;
	} = {},
): TenantBookRuntime {
	const projectRoot = options.projectRoot ?? process.cwd();
	const booksContentRoot = path.resolve(projectRoot, getTenantContentRoot(tenantConfig, 'books'));
	const books = collectMarkdownFiles(booksContentRoot)
		.map((filePath) => {
			const frontmatter = parseFrontmatter(filePath);
			return {
				...(frontmatter as TreeseedBookDefinition),
				id: path.basename(filePath, path.extname(filePath)),
			};
		})
		.sort((left, right) => left.order - right.order);

	const docsHomePath = options.docsHomePath ?? '/knowledge/';
	const docsLibraryDownload = options.docsLibraryDownload ?? inferDocsLibraryDownload(tenantConfig);

	return {
		BOOKS: books,
		BOOKS_LINK: {
			label: 'Books',
			link: docsHomePath,
		},
		TREESEED_LINKS: {
			home: docsHomePath,
		},
		TREESEED_LIBRARY_DOWNLOAD: docsLibraryDownload,
	};
}

const runtime = buildTenantBookRuntime(RUNTIME_TENANT, {
	projectRoot: RUNTIME_PROJECT_ROOT,
	docsLibraryDownload: {
		downloadFileName: 'treeseed-knowledge.md',
		downloadHref: '/books/treeseed-knowledge.md',
		downloadTitle: 'TreeSeed Knowledge Library',
	},
});

export const { BOOKS, BOOKS_LINK, TREESEED_LINKS, TREESEED_LIBRARY_DOWNLOAD } = runtime;
