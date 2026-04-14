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
import type { TreeseedBookDefinition, TreeseedTenantConfig } from './contracts.ts';
import { buildTenantBookRuntime } from './books-data.ts';
import { loadTreeseedManifest } from './tenant-config.ts';

const BOOK_EXPORT_PACKAGE_VERSION = 1;

export type TreeseedBookExportFileEntry = {
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

export type TreeseedBookExportMemberSummary = {
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

export type TreeseedBookExportManifest = {
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
	files: TreeseedBookExportFileEntry[];
	members?: TreeseedBookExportMemberSummary[];
};

export type TreeseedBookPackageResult = {
	manifest: TreeseedBookExportManifest;
	markdownPath: string;
	indexPath: string;
	sourceFileCount: number;
	includedRoots: string[];
};

export type TreeseedBookLibraryPackageResult = {
	manifest: TreeseedBookExportManifest;
	markdownPath: string;
	indexPath: string;
	memberPackages: TreeseedBookPackageResult[];
	sourceFileCount: number;
	includedRoots: string[];
};

function sha1(value: string) {
	return createHash('sha1').update(value).digest('hex');
}

function sortPaths(paths: string[]) {
	return [...paths].sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }));
}

function collectMarkdownFiles(rootPath: string): string[] {
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

function frontmatter(filePath: string) {
	const raw = readFileSync(filePath, 'utf8');
	const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	return match ? (parseYaml(match[1]) as Record<string, unknown>) : {};
}

function frontmatterOrder(filePath: string) {
	const order = frontmatter(filePath).order;
	return typeof order === 'number' && Number.isFinite(order) ? order : null;
}

function contentTypeFor(filePath: string): TreeseedBookExportFileEntry['sourceType'] {
	const extension = extname(filePath).toLowerCase();
	if (extension === '.md') return 'md';
	if (extension === '.mdx') return 'mdx';
	return 'text';
}

function inferExportRoots(book: TreeseedBookDefinition, tenantConfig: TreeseedTenantConfig) {
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

function resolveBookRoots(book: TreeseedBookDefinition, projectRoot: string, tenantConfig: TreeseedTenantConfig) {
	const configuredRoots = Array.isArray(book.exportRoots) && book.exportRoots.length > 0
		? book.exportRoots.map((entry) => resolve(projectRoot, entry))
		: inferExportRoots(book, tenantConfig).map((entry) => resolve(entry));
	return configuredRoots;
}

function rootKeyFor(book: TreeseedBookDefinition, rootPath: string, projectRoot: string, index: number, total: number) {
	if (total === 1) {
		return '';
	}
	const rel = relative(projectRoot, rootPath).replaceAll(path.sep, '/');
	const cleaned = rel.replaceAll(/[^a-zA-Z0-9/_-]+/g, '-').replaceAll(/-+/g, '-').replace(/^\/+|\/+$/g, '');
	return cleaned || `root-${String(index + 1).padStart(2, '0')}`;
}

function orderedBookFiles(book: TreeseedBookDefinition, tenantConfig: TreeseedTenantConfig, projectRoot: string) {
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
			} satisfies TreeseedBookExportFileEntry;
		}),
	};
}

function loadTenant(projectRoot = process.cwd()) {
	const manifestPath = resolve(projectRoot, 'src', 'manifest.yaml');
	const tenantConfig = loadTreeseedManifest(manifestPath);
	const runtime = buildTenantBookRuntime(tenantConfig, { projectRoot });
	return {
		projectRoot,
		tenantConfig,
		runtime,
	};
}

function findBookOrThrow(bookId: string, books: TreeseedBookDefinition[]) {
	const book = books.find((entry) => entry.id === bookId || entry.slug === bookId);
	if (!book) {
		throw new Error(`Unknown book export target: ${bookId}`);
	}
	return book;
}

function buildBookManifestFromBook(book: TreeseedBookDefinition, tenantConfig: TreeseedTenantConfig, projectRoot: string): TreeseedBookExportManifest {
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

function stageManifest(manifest: TreeseedBookExportManifest, stageRoot: string) {
	rmSync(stageRoot, { recursive: true, force: true });
	mkdirSync(resolve(stageRoot, 'manifest'), { recursive: true });
	mkdirSync(resolve(stageRoot, 'content'), { recursive: true });

	writeFileSync(resolve(stageRoot, 'manifest', 'book.json'), `${JSON.stringify({
		packageKind: manifest.packageKind,
		packageVersion: manifest.packageVersion,
		packageId: manifest.packageId,
		generatedAt: manifest.generatedAt,
		book: manifest.book,
		members: manifest.members ?? [],
	}, null, 2)}\n`, 'utf8');
	writeFileSync(resolve(stageRoot, 'manifest', 'files.json'), `${JSON.stringify(manifest.files, null, 2)}\n`, 'utf8');

	for (const file of manifest.files) {
		const stagedPath = resolve(
			stageRoot,
			'content',
			String(file.ordinal).padStart(4, '0'),
			file.bookRelativePath,
		);
		mkdirSync(dirname(stagedPath), { recursive: true });
		copyFileSync(file.absolutePath, stagedPath);
	}
}

async function withCleanNodeExecArgv<T>(action: () => Promise<T>) {
	const previousExecArgv = [...process.execArgv];
	process.execArgv = previousExecArgv.filter((arg) =>
		!arg.startsWith('--test')
		&& !arg.startsWith('--input-type')
		&& !arg.startsWith('--experimental-test')
		&& !arg.startsWith('--watch'),
	);
	try {
		return await action();
	} finally {
		process.execArgv = previousExecArgv;
	}
}

async function renderRepomixMarkdown(stageRoot: string, outputPath: string) {
	const options: CliOptions = {
		output: outputPath,
		style: 'markdown',
		ignore: '',
		quiet: true,
		skipLocalConfig: true,
		copy: false,
		stdout: false,
	};
	setLogLevel(0 as never);
	const result = await withCleanNodeExecArgv(() => runDefaultAction(['.'], stageRoot, options));
	return {
		markdown: readFileSync(outputPath, 'utf8'),
		packResult: result.packResult,
	};
}

function normalizePackResultOutputFiles(packResult: PackResult, outputPath: string) {
	return packResult.outputFiles && packResult.outputFiles.length > 0
		? packResult.outputFiles
		: [outputPath];
}

function jsonFence(value: unknown) {
	return ['```json', JSON.stringify(value, null, 2), '```'].join('\n');
}

function renderBookPackageMarkdown(manifest: TreeseedBookExportManifest, repomixMarkdown: string) {
	const header = {
		packageKind: manifest.packageKind,
		packageVersion: manifest.packageVersion,
		packageId: manifest.packageId,
		book: manifest.book,
		sourceFileCount: manifest.files.length,
	};
	const fileIndex = manifest.files.map((file) => ({
		fileId: file.fileId,
		ordinal: file.ordinal,
		projectRelativePath: file.projectRelativePath,
		bookRelativePath: file.bookRelativePath,
		sourceType: file.sourceType,
		chunkId: file.chunkId,
		markerId: file.markerId,
	}));

	return [
		`# ${manifest.book.downloadTitle}`,
		'',
		'> Auto-generated Treeseed AI package. Treeseed owns the manifest and file ordering; Repomix owns the content serialization payload.',
		'',
		'<!-- TRESEED_PACKAGE_HEADER_BEGIN -->',
		jsonFence(header),
		'<!-- TRESEED_PACKAGE_HEADER_END -->',
		'',
		'<!-- TRESEED_PACKAGE_MANIFEST_BEGIN -->',
		jsonFence(manifest),
		'<!-- TRESEED_PACKAGE_MANIFEST_END -->',
		'',
		'<!-- TRESEED_PACKAGE_FILE_INDEX_BEGIN -->',
		jsonFence(fileIndex),
		'<!-- TRESEED_PACKAGE_FILE_INDEX_END -->',
		'',
		'<!-- TRESEED_PACKAGE_CONTENT_BEGIN -->',
		repomixMarkdown.trim(),
		'<!-- TRESEED_PACKAGE_CONTENT_END -->',
		'',
	].join('\n');
}

function buildBookIndexPayload(manifest: TreeseedBookExportManifest, markdownPath: string) {
	return {
		packageKind: manifest.packageKind,
		packageVersion: manifest.packageVersion,
		packageId: manifest.packageId,
		markdownPath,
		book: manifest.book,
		files: manifest.files.map((file) => ({
			fileId: file.fileId,
			memberBookId: file.memberBookId,
			ordinal: file.ordinal,
			projectRelativePath: file.projectRelativePath,
			bookRelativePath: file.bookRelativePath,
			rootRelativePath: file.rootRelativePath,
			sourceType: file.sourceType,
			chunkId: file.chunkId,
			markerId: file.markerId,
			relations: {
				book: manifest.book.id,
				nextFileId: manifest.files.find((candidate) => candidate.ordinal === file.ordinal + 1)?.fileId ?? null,
			},
		})),
	};
}

function booksOutputRoot(projectRoot: string) {
	return resolve(projectRoot, 'public', 'books');
}

function sidecarIndexPath(markdownPath: string) {
	return markdownPath.replace(/\.md$/u, '.json');
}

async function exportManifestPackage(manifest: TreeseedBookExportManifest, markdownPath: string, indexPath: string) {
	const tempRoot = resolve(manifest.tenantRoot, '.treeseed', 'tmp', 'book-exports', manifest.packageId.replaceAll(':', '-'));
	const repomixOutputPath = resolve(tempRoot, '..', `${manifest.packageId.replaceAll(':', '-')}.repomix.md`);
	stageManifest(manifest, tempRoot);
	const { markdown: repomixMarkdown, packResult } = await renderRepomixMarkdown(tempRoot, repomixOutputPath);
	const wrappedMarkdown = renderBookPackageMarkdown(manifest, repomixMarkdown);

	mkdirSync(dirname(markdownPath), { recursive: true });
	writeFileSync(markdownPath, wrappedMarkdown, 'utf8');
	writeFileSync(indexPath, `${JSON.stringify({
		...buildBookIndexPayload(manifest, markdownPath),
		repomixSummary: {
			totalFiles: packResult.totalFiles,
			totalCharacters: packResult.totalCharacters,
			totalTokens: packResult.totalTokens,
			outputFiles: normalizePackResultOutputFiles(packResult, repomixOutputPath),
		},
	}, null, 2)}\n`, 'utf8');
	rmSync(tempRoot, { recursive: true, force: true });
	rmSync(repomixOutputPath, { force: true });
}

export async function exportBookPackage(bookId: string, options: { projectRoot?: string } = {}): Promise<TreeseedBookPackageResult> {
	const manifest = buildBookExportManifest(bookId, options);
	const markdownPath = resolve(booksOutputRoot(manifest.tenantRoot), manifest.book.downloadFileName);
	const indexPath = sidecarIndexPath(markdownPath);
	await exportManifestPackage(manifest, markdownPath, indexPath);
	return {
		manifest,
		markdownPath,
		indexPath,
		sourceFileCount: manifest.files.length,
		includedRoots: manifest.book.resolvedRoots,
	};
}

function renderLibraryMarkdown(manifest: TreeseedBookExportManifest, memberPackages: TreeseedBookPackageResult[]) {
	return [
		`# ${manifest.book.downloadTitle}`,
		'',
		'> Auto-generated Treeseed AI library package. Each member section embeds a reconstructable per-book package.',
		'',
		'<!-- TRESEED_LIBRARY_HEADER_BEGIN -->',
		jsonFence({
			packageKind: manifest.packageKind,
			packageVersion: manifest.packageVersion,
			packageId: manifest.packageId,
			book: manifest.book,
			memberCount: memberPackages.length,
		}),
		'<!-- TRESEED_LIBRARY_HEADER_END -->',
		'',
		'<!-- TRESEED_LIBRARY_MANIFEST_BEGIN -->',
		jsonFence(manifest),
		'<!-- TRESEED_LIBRARY_MANIFEST_END -->',
		'',
		...memberPackages.flatMap((member) => [
			`<!-- TRESEED_AGGREGATE_MEMBER_BEGIN ${member.manifest.book.id} -->`,
			readFileSync(member.markdownPath, 'utf8').trim(),
			`<!-- TRESEED_AGGREGATE_MEMBER_END ${member.manifest.book.id} -->`,
			'',
		]),
	].join('\n');
}

export async function exportBookLibrary(options: { projectRoot?: string } = {}): Promise<TreeseedBookLibraryPackageResult> {
	const { projectRoot, tenantConfig, runtime } = loadTenant(resolve(options.projectRoot ?? process.cwd()));
	const memberPackages: TreeseedBookPackageResult[] = [];
	for (const book of runtime.BOOKS) {
		memberPackages.push(await exportBookPackage(book.id ?? book.slug, { projectRoot }));
	}

	const files = memberPackages.flatMap((entry) => entry.manifest.files);
	const manifest: TreeseedBookExportManifest = {
		packageKind: 'library',
		packageVersion: BOOK_EXPORT_PACKAGE_VERSION,
		packageId: 'library:books',
		generatedAt: new Date().toISOString(),
		tenantRoot: projectRoot,
		tenantId: tenantConfig.id,
		book: {
			id: 'library',
			slug: 'library',
			title: runtime.TREESEED_LIBRARY_DOWNLOAD.downloadTitle,
			order: 0,
			basePath: '/books/',
			downloadFileName: runtime.TREESEED_LIBRARY_DOWNLOAD.downloadFileName,
			downloadHref: runtime.TREESEED_LIBRARY_DOWNLOAD.downloadHref,
			downloadTitle: runtime.TREESEED_LIBRARY_DOWNLOAD.downloadTitle,
			resolvedRoots: Array.from(new Set(memberPackages.flatMap((entry) => entry.includedRoots))).sort((left, right) => left.localeCompare(right)),
		},
		files,
		members: memberPackages.map((entry) => ({
			bookId: entry.manifest.book.id,
			slug: entry.manifest.book.slug,
			title: entry.manifest.book.title,
			order: entry.manifest.book.order,
			downloadFileName: entry.manifest.book.downloadFileName,
			downloadHref: entry.manifest.book.downloadHref,
			sourceFileCount: entry.sourceFileCount,
			markdownPath: entry.markdownPath,
			indexPath: entry.indexPath,
		})),
	};

	const markdownPath = resolve(booksOutputRoot(projectRoot), runtime.TREESEED_LIBRARY_DOWNLOAD.downloadFileName);
	const indexPath = sidecarIndexPath(markdownPath);
	mkdirSync(dirname(markdownPath), { recursive: true });
	writeFileSync(markdownPath, renderLibraryMarkdown(manifest, memberPackages), 'utf8');
	writeFileSync(indexPath, `${JSON.stringify({
		packageKind: manifest.packageKind,
		packageVersion: manifest.packageVersion,
		packageId: manifest.packageId,
		markdownPath,
		book: manifest.book,
		members: manifest.members,
		files: buildBookIndexPayload(manifest, markdownPath).files,
	}, null, 2)}\n`, 'utf8');

	return {
		manifest,
		markdownPath,
		indexPath,
		memberPackages,
		sourceFileCount: files.length,
		includedRoots: manifest.book.resolvedRoots,
	};
}

export async function exportTenantBookPackages(options: { projectRoot?: string } = {}) {
	const { projectRoot } = loadTenant(resolve(options.projectRoot ?? process.cwd()));
	const libraryPackage = await exportBookLibrary({ projectRoot });
	const legacyOutputFile = resolve(projectRoot, 'public', 'book.md');
	if (existsSync(legacyOutputFile)) {
		rmSync(legacyOutputFile, { force: true });
	}
	return {
		projectRoot,
		bookPackages: libraryPackage.memberPackages,
		libraryPackage,
	};
}
