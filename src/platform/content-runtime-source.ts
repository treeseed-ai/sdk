import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SeedContentRuntimeSource, SeedProjectArchitecture } from '../seeds/types.ts';

export type TreeseedEffectiveContentSource = SeedContentRuntimeSource | 'missing';
export type TreeseedContentRuntimeMode = 'local' | 'treedx' | 'r2' | 'missing';
export type TreeseedContentRuntimeDiagnosticStatus = 'ready' | 'missing' | 'site_not_prepared' | 'unsupported_structure';

export type TreeseedContentRuntimeDiagnostic = {
	code: string;
	status: TreeseedContentRuntimeDiagnosticStatus;
	source: TreeseedContentRuntimeMode;
	summary: string;
	relativePath?: string;
};

export type TreeseedLocalContentRuntimeSummary = {
	requestedLocalContentMode?: 'auto' | 'none' | 'preview' | 'edit' | string;
	materializationStatus?: string | null;
	effectiveLocalPath?: string | null;
	localPathExists?: boolean;
};

export type TreeseedR2ContentRuntimeMetadata = {
	manifestKey?: string | null;
	overlayKey?: string | null;
	revision?: string | null;
};

export type TreeseedTreeDxContentRuntimeMetadata = {
	libraryId?: string | null;
	repositoryId?: string | null;
	snapshotId?: string | null;
};

export type TreeseedContentRuntimeResolution = {
	contentRuntimeSource: SeedContentRuntimeSource;
	effectiveContentSource: TreeseedEffectiveContentSource;
	mode: TreeseedContentRuntimeMode;
	ready: boolean;
	manifestKey: string | null;
	overlayKey: string | null;
	revision: string | null;
	snapshotId: string | null;
	diagnostics: TreeseedContentRuntimeDiagnostic[];
	localPath?: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown, fallback = '') {
	return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function cleanRelativePath(value: unknown, fallback = '.') {
	const raw = text(value, fallback).replace(/\\/gu, '/').replace(/^\/+/u, '');
	const parts = raw.split('/').filter((part) => part && part !== '.');
	if (parts.some((part) => part === '..')) return fallback;
	return parts.length > 0 ? parts.join('/') : '.';
}

function contentRuntimeMode(source: TreeseedEffectiveContentSource): TreeseedContentRuntimeMode {
	if (source === 'local_directory') return 'local';
	if (source === 'treedx_snapshot') return 'treedx';
	if (source === 'r2_published_manifest' || source === 'r2_preview_overlay') return 'r2';
	return 'missing';
}

function localStatusReady(status: string | null | undefined) {
	return status === 'existing_path_ready' || status === 'managed_clone_ready' || status === 'submodule_ready';
}

function localContentRequested(architecture: Pick<SeedProjectArchitecture, 'contentRuntimeSource'>, local?: TreeseedLocalContentRuntimeSummary | null) {
	const mode = local?.requestedLocalContentMode;
	return architecture.contentRuntimeSource === 'local_directory' || mode === 'preview' || mode === 'edit';
}

function defaultManifestKey(architecture: Pick<SeedProjectArchitecture, 'contentPublishTarget'>) {
	const target = architecture.contentPublishTarget;
	return target?.kind === 'cloudflare_r2' && typeof target.manifestPath === 'string' && target.manifestPath.trim()
		? target.manifestPath.trim()
		: null;
}

export function resolveTreeseedContentRuntimeSource(input: {
	architecture: Pick<SeedProjectArchitecture, 'contentRuntimeSource' | 'contentPublishTarget'>;
	local?: TreeseedLocalContentRuntimeSummary | null;
	r2?: TreeseedR2ContentRuntimeMetadata | null;
	treeDx?: TreeseedTreeDxContentRuntimeMetadata | null;
	includeLocalPath?: boolean;
}): TreeseedContentRuntimeResolution {
	const diagnostics: TreeseedContentRuntimeDiagnostic[] = [];
	const localReady = input.local?.localPathExists === true || localStatusReady(input.local?.materializationStatus);
	const localSelected = localReady && localContentRequested(input.architecture, input.local);
	const source: TreeseedEffectiveContentSource = localSelected ? 'local_directory' : input.architecture.contentRuntimeSource ?? 'r2_published_manifest';
	const mode = contentRuntimeMode(source);
	const manifestKey = input.r2?.manifestKey ?? defaultManifestKey(input.architecture);
	const overlayKey = source === 'r2_preview_overlay' ? input.r2?.overlayKey ?? null : null;
	const snapshotId = source === 'treedx_snapshot' ? input.treeDx?.snapshotId ?? null : null;
	const revision = source === 'r2_published_manifest' || source === 'r2_preview_overlay' ? input.r2?.revision ?? null : null;

	if (source === 'local_directory') {
		diagnostics.push({
			code: localReady ? 'local_content_ready' : 'local_content_missing',
			status: localReady ? 'ready' : 'missing',
			source: 'local',
			summary: localReady ? 'Local content path is available for runtime preview.' : 'Local content path is not available.',
		});
	} else if (source === 'treedx_snapshot') {
		const ready = Boolean(snapshotId || input.treeDx?.libraryId || input.treeDx?.repositoryId);
		diagnostics.push({
			code: ready ? 'treedx_snapshot_ready' : 'treedx_snapshot_missing',
			status: ready ? 'ready' : 'missing',
			source: 'treedx',
			summary: ready ? 'TreeDX content snapshot metadata is available.' : 'TreeDX content snapshot metadata is missing.',
		});
	} else if (source === 'r2_published_manifest' || source === 'r2_preview_overlay') {
		const ready = Boolean(manifestKey);
		diagnostics.push({
			code: ready ? 'r2_manifest_ready' : 'r2_manifest_missing',
			status: ready ? 'ready' : 'missing',
			source: 'r2',
			summary: ready ? 'R2 published content manifest metadata is available.' : 'R2 published content manifest metadata is missing.',
		});
		if (source === 'r2_preview_overlay' && !overlayKey) {
			diagnostics.push({
				code: 'r2_preview_overlay_missing',
				status: 'missing',
				source: 'r2',
				summary: 'R2 preview overlay metadata is missing.',
			});
		}
	}

	return {
		contentRuntimeSource: input.architecture.contentRuntimeSource,
		effectiveContentSource: source,
		mode,
		ready: diagnostics.every((entry) => entry.status === 'ready'),
		manifestKey,
		overlayKey,
		revision,
		snapshotId,
		diagnostics,
		...(input.includeLocalPath ? { localPath: input.local?.effectiveLocalPath ?? null } : {}),
	};
}

function hasMarkdownFile(root: string): boolean {
	if (!existsSync(root)) return false;
	const stats = statSync(root);
	if (stats.isFile()) return root.endsWith('.md') || root.endsWith('.mdx');
	if (!stats.isDirectory()) return false;
	return readdirSync(root, { withFileTypes: true }).some((entry) => {
		const fullPath = resolve(root, entry.name);
		if (entry.isDirectory()) return hasMarkdownFile(fullPath);
		return entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.mdx'));
	});
}

export function inspectTreeseedContentStructure(input: {
	projectRoot: string;
	architecture: Pick<SeedProjectArchitecture, 'rootPath' | 'sitePath' | 'contentPath'>;
}): TreeseedContentRuntimeDiagnostic {
	const rootPath = cleanRelativePath(input.architecture.rootPath);
	const sitePath = cleanRelativePath(input.architecture.sitePath);
	const contentPath = input.architecture.contentPath ? cleanRelativePath(input.architecture.contentPath) : null;
	const siteRoot = resolve(input.projectRoot, rootPath === '.' ? '' : rootPath, sitePath === '.' ? '' : sitePath);
	if (!existsSync(siteRoot)) {
		return {
			code: 'site_not_prepared',
			status: 'site_not_prepared',
			source: 'local',
			summary: 'Site path is not prepared yet.',
			relativePath: sitePath,
		};
	}
	const candidatePaths = [
		contentPath,
		sitePath === '.' ? 'src/content' : `${sitePath}/src/content`,
		sitePath,
		'content',
	].filter((entry): entry is string => Boolean(entry));
	for (const candidate of [...new Set(candidatePaths)]) {
		const absolute = resolve(input.projectRoot, rootPath === '.' ? '' : rootPath, candidate === '.' ? '' : candidate);
		if (!existsSync(absolute)) continue;
		if (hasMarkdownFile(absolute)) {
			return {
				code: 'content_structure_ready',
				status: 'ready',
				source: 'local',
				summary: 'Content structure contains Markdown or MDX files.',
				relativePath: candidate,
			};
		}
		return {
			code: 'unsupported_content_structure',
			status: 'unsupported_structure',
			source: 'local',
			summary: 'Content path exists but does not contain Markdown or MDX files.',
			relativePath: candidate,
		};
	}
	return {
		code: 'content_structure_missing',
		status: 'missing',
		source: 'local',
		summary: 'No supported local content path was found.',
		relativePath: contentPath ?? 'src/content',
	};
}

export function contentRuntimeMetadataFromTarget(target: unknown): {
	r2: TreeseedR2ContentRuntimeMetadata;
	treeDx: TreeseedTreeDxContentRuntimeMetadata;
} {
	const record = isRecord(target) ? target : {};
	const contentRuntime = isRecord(record.contentRuntime) ? record.contentRuntime : {};
	const contentPublish = isRecord(record.contentPublish) ? record.contentPublish : {};
	const r2 = isRecord(contentRuntime.r2) ? contentRuntime.r2 : isRecord(contentPublish.r2) ? contentPublish.r2 : {};
	const treeDx = isRecord(contentRuntime.treeDx) ? contentRuntime.treeDx : contentPublish.provider === 'treedx' ? contentPublish : {};
	return {
		r2: {
			manifestKey: text(contentRuntime.manifestKey) || text(r2.manifestKey) || text(r2.manifestPath) || null,
			overlayKey: text(contentRuntime.overlayKey) || text(r2.overlayKey) || null,
			revision: text(contentRuntime.revision) || text(r2.revision) || null,
		},
		treeDx: {
			libraryId: text(treeDx.libraryId) || null,
			repositoryId: text(treeDx.repositoryId) || null,
			snapshotId: text(treeDx.snapshotId) || text(contentPublish.snapshotId) || null,
		},
	};
}
