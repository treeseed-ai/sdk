import { createHash } from 'node:crypto';
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import path, { dirname, extname, relative, resolve } from 'node:path';
import { runDefaultAction, setLogLevel, type CliOptions, type PackResult } from 'repomix';
import { parse as parseYaml } from 'yaml';
import type { BookDefinition, TenantConfig } from '../support/contracts.ts';
import { buildTenantBookRuntime } from '../content/books-data.ts';
import { loadManifest } from '../configuration/tenant-config.ts';


export const BOOK_EXPORT_PACKAGE_VERSION = 1;

export type BookExportFileEntry = {
	fileId: string;
	bookId: string;
	memberBookId: string;
	absolutePath: string;
	projectRelativePath: string;
	bookRelativePath: string;
	rootRelativePath: string;
	rootPath: string;
	ordinal: number;
	frontmatterOrder: number | null;
	sourceType: 'md' | 'mdx' | 'text';
	chunkId: string;
	markerId: string;
};

export type BookExportMemberSummary = {
	bookId: string;
	slug: string;
	title: string;
	order: number;
	downloadFileName: string;
	downloadHref: string;
	sourceFileCount: number;
	markdownPath?: string;
	indexPath?: string;
};

export type BookExportManifest = {
	packageKind: 'book' | 'library';
	packageVersion: number;
	packageId: string;
	generatedAt: string;
	tenantRoot: string;
	tenantId: string;
	book: {
		id: string;
		slug: string;
		title: string;
		order: number;
		basePath: string;
		downloadFileName: string;
		downloadHref: string;
		downloadTitle: string;
		resolvedRoots: string[];
	};
	files: BookExportFileEntry[];
	members?: BookExportMemberSummary[];
};

export type BookPackageResult = {
	manifest: BookExportManifest;
	markdownPath: string;
	indexPath: string;
	sourceFileCount: number;
	includedRoots: string[];
};

export type BookLibraryPackageResult = {
	manifest: BookExportManifest;
	markdownPath: string;
	indexPath: string;
	memberPackages: BookPackageResult[];
	sourceFileCount: number;
	includedRoots: string[];
};

export function sha1(value: string) {
	return createHash('sha1').update(value).digest('hex');
}

export function sortPaths(paths: string[]) {
	return [...paths].sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }));
}

export function collectMarkdownFiles(rootPath: string): string[] {
	if (!existsSync(rootPath)) {
		throw new Error(`Book export root not found: ${rootPath}`);
	}
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

export function frontmatter(filePath: string) {
	const raw = readFileSync(filePath, 'utf8');
	const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	return match ? (parseYaml(match[1]) as Record<string, unknown>) : {};
}

export function frontmatterOrder(filePath: string) {
	const order = frontmatter(filePath).order;
	return typeof order === 'number' && Number.isFinite(order) ? order : null;
}

export function contentTypeFor(filePath: string): BookExportFileEntry['sourceType'] {
	const extension = extname(filePath).toLowerCase();
	if (extension === '.md') return 'md';
	if (extension === '.mdx') return 'mdx';
	return 'text';
}

export function inferExportRoots(book: BookDefinition, tenantConfig: TenantConfig) {
	const knowledgePrefix = '/knowledge/';
	const normalizedBasePath = String(book.basePath || '').trim();
	if (!normalizedBasePath.startsWith(knowledgePrefix)) {
		throw new Error(`Book basePath must start with "${knowledgePrefix}" to infer exports: ${book.basePath}`);
	}
	const relativeKnowledgePath = normalizedBasePath.slice(knowledgePrefix.length).replace(/^\/+|\/+$/g, '');
	if (!relativeKnowledgePath) {
		throw new Error(`Book basePath must identify a knowledge directory: ${book.basePath}`);
	}
	return [path.join(tenantConfig.content.docs, relativeKnowledgePath)];
}

export function resolveBookRoots(book: BookDefinition, projectRoot: string, tenantConfig: TenantConfig) {
	const configuredRoots = Array.isArray(book.exportRoots) && book.exportRoots.length > 0
		? book.exportRoots.map((entry) => resolve(projectRoot, entry))
		: inferExportRoots(book, tenantConfig).map((entry) => resolve(entry));
	return configuredRoots;
}

export function rootKeyFor(book: BookDefinition, rootPath: string, projectRoot: string, index: number, total: number) {
	if (total === 1) {
		return '';
	}
	const rel = relative(projectRoot, rootPath).replaceAll(path.sep, '/');
	const cleaned = rel.replaceAll(/[^a-zA-Z0-9/_-]+/g, '-').replaceAll(/-+/g, '-').replace(/^\/+|\/+$/g, '');
	return cleaned || `root-${String(index + 1).padStart(2, '0')}`;
}

export function orderedBookFiles(book: BookDefinition, tenantConfig: TenantConfig, projectRoot: string) {
	const resolvedRoots = resolveBookRoots(book, projectRoot, tenantConfig);
	const seen = new Set<string>();
	const files = resolvedRoots.flatMap((rootPath, rootIndex) =>
		collectMarkdownFiles(rootPath)
			.sort((left, right) => {
				const orderDelta = (frontmatterOrder(left) ?? Number.POSITIVE_INFINITY) - (frontmatterOrder(right) ?? Number.POSITIVE_INFINITY);
				if (orderDelta !== 0) {
					return orderDelta;
				}
				return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
			})
			.map((absolutePath) => {
				if (seen.has(absolutePath)) {
					return null;
				}
				seen.add(absolutePath);
				const rootRelativePath = relative(rootPath, absolutePath).replaceAll(path.sep, '/');
				const rootKey = rootKeyFor(book, rootPath, projectRoot, rootIndex, resolvedRoots.length);
				const bookRelativePath = rootKey ? `${rootKey}/${rootRelativePath}` : rootRelativePath;
				return {
					absolutePath,
					rootPath,
					rootRelativePath,
					bookRelativePath,
				};
			})
			.filter(Boolean) as Array<{ absolutePath: string; rootPath: string; rootRelativePath: string; bookRelativePath: string }>,
	);

	return {
		resolvedRoots,
		files: files.map((file, index) => {
			const projectRelativePath = relative(projectRoot, file.absolutePath).replaceAll(path.sep, '/');
			const markerId = `marker:${book.id}:${String(index + 1).padStart(4, '0')}`;
			return {
				fileId: sha1(`${book.id}:${projectRelativePath}`),
				bookId: book.id ?? book.slug,
				memberBookId: book.id ?? book.slug,
				absolutePath: file.absolutePath,
				projectRelativePath,
				bookRelativePath: file.bookRelativePath,
				rootRelativePath: file.rootRelativePath,
				rootPath: file.rootPath,
				ordinal: index + 1,
				frontmatterOrder: frontmatterOrder(file.absolutePath),
				sourceType: contentTypeFor(file.absolutePath),
				chunkId: sha1(`chunk:${book.id}:${projectRelativePath}:${index + 1}`),
				markerId,
			} satisfies BookExportFileEntry;
		}),
	};
}

export function loadTenant(projectRoot = process.cwd()) {
	const manifestPath = resolve(projectRoot, 'src', 'manifest.yaml');
	const tenantConfig = loadManifest(manifestPath);
	const runtime = buildTenantBookRuntime(tenantConfig, { projectRoot });
	return {
		projectRoot,
		tenantConfig,
		runtime,
	};
}

export function findBookOrThrow(bookId: string, books: BookDefinition[]) {
	const book = books.find((entry) => entry.id === bookId || entry.slug === bookId);
	if (!book) {
		throw new Error(`Unknown book export target: ${bookId}`);
	}
	return book;
}

export function buildBookManifestFromBook(book: BookDefinition, tenantConfig: TenantConfig, projectRoot: string): BookExportManifest {
	const ordered = orderedBookFiles(book, tenantConfig, projectRoot);
	return {
		packageKind: 'book',
		packageVersion: BOOK_EXPORT_PACKAGE_VERSION,
		packageId: `book:${book.id}`,
		generatedAt: new Date().toISOString(),
		tenantRoot: projectRoot,
		tenantId: tenantConfig.id,
		book: {
			id: book.id ?? book.slug,
			slug: book.slug,
			title: book.title,
			order: book.order,
			basePath: book.basePath,
			downloadFileName: book.downloadFileName,
			downloadHref: book.downloadHref,
			downloadTitle: book.downloadTitle,
			resolvedRoots: ordered.resolvedRoots.map((entry) => relative(projectRoot, entry).replaceAll(path.sep, '/')),
		},
		files: ordered.files,
	};
}

export function buildBookExportManifest(bookId: string, options: { projectRoot?: string } = {}) {
	const { projectRoot, tenantConfig, runtime } = loadTenant(resolve(options.projectRoot ?? process.cwd()));
	const book = findBookOrThrow(bookId, runtime.BOOKS);
	return buildBookManifestFromBook(book, tenantConfig, projectRoot);
}
