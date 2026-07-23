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
import type { TreeseedBookDefinition, TreeseedTenantConfig } from '../contracts.ts';
import { buildTenantBookRuntime } from '../books-data.ts';
import { loadTreeseedManifest } from '../tenant-config.ts';
import { BOOK_EXPORT_PACKAGE_VERSION, loadTenant } from './book-export-package-version.ts';
import type {
	TreeseedBookExportManifest,
	TreeseedBookLibraryPackageResult,
	TreeseedBookPackageResult,
} from './book-export-package-version.ts';
import { booksOutputRoot, buildBookIndexPayload, exportBookPackage, renderLibraryMarkdown, sidecarIndexPath } from './stage-manifest.ts';

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
