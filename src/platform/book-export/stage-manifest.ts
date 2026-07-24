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
import { buildBookExportManifest } from './book-export-package-version.ts';
import type {
	BookExportManifest,
	BookPackageResult,
} from './book-export-package-version.ts';

export function stageManifest(manifest: BookExportManifest, stageRoot: string) {
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

export async function withCleanNodeExecArgv<T>(action: () => Promise<T>) {
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

export async function renderRepomixMarkdown(stageRoot: string, outputPath: string) {
	const options: CliOptions = {
		output: outputPath,
		style: 'markdown',
		ignore: '',
		gitignore: false,
		dotIgnore: false,
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

export function normalizePackResultOutputFiles(packResult: PackResult, outputPath: string) {
	return packResult.outputFiles && packResult.outputFiles.length > 0
		? packResult.outputFiles
		: [outputPath];
}

export function jsonFence(value: unknown) {
	return ['```json', JSON.stringify(value, null, 2), '```'].join('\n');
}

export function renderBookPackageMarkdown(manifest: BookExportManifest, repomixMarkdown: string) {
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

export function buildBookIndexPayload(manifest: BookExportManifest, markdownPath: string) {
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

export function booksOutputRoot(projectRoot: string) {
	return resolve(projectRoot, 'public', 'books');
}

export function sidecarIndexPath(markdownPath: string) {
	return markdownPath.replace(/\.md$/u, '.json');
}

export async function exportManifestPackage(manifest: BookExportManifest, markdownPath: string, indexPath: string) {
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

export async function exportBookPackage(bookId: string, options: { projectRoot?: string } = {}): Promise<BookPackageResult> {
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

export function renderLibraryMarkdown(manifest: BookExportManifest, memberPackages: BookPackageResult[]) {
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
