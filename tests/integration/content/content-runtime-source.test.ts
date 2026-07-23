import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
	contentRuntimeMetadataFromTarget,
	inspectTreeseedContentStructure,
	resolveTreeseedContentRuntimeSource,
} from '../../../src/platform/content-runtime-source.ts';
import type { SeedProjectArchitecture } from '../../../src/seeds/types.ts';

const baseArchitecture: SeedProjectArchitecture = {
	topology: 'single_repository_site',
	rootPath: '.',
	sitePath: 'docs',
	contentPath: 'docs/src/content',
	contentRuntimeSource: 'r2_published_manifest',
	localContentMaterialization: 'existing_path',
	contentPublishTarget: {
		kind: 'cloudflare_r2',
		bucket: 'treeseed-content',
		manifestPath: 'teams/treeseed/published/common.json',
	},
};

describe('project content runtime source planning', () => {
	it('prefers local content when preview/edit requested and the path is present', () => {
		const resolution = resolveTreeseedContentRuntimeSource({
			architecture: baseArchitecture,
			local: {
				requestedLocalContentMode: 'preview',
				materializationStatus: 'existing_path_ready',
				effectiveLocalPath: '/redacted/local/docs/src/content',
				localPathExists: true,
			},
			r2: { manifestKey: 'teams/treeseed/published/common.json', revision: 'rev-1' },
		});

		expect(resolution).toMatchObject({
			contentRuntimeSource: 'r2_published_manifest',
			effectiveContentSource: 'local_directory',
			mode: 'local',
			ready: true,
			manifestKey: 'teams/treeseed/published/common.json',
		});
		expect(resolution).not.toHaveProperty('localPath');
	});

	it('selects TreeDX snapshots for TreeDX-backed runtime content', () => {
		const resolution = resolveTreeseedContentRuntimeSource({
			architecture: {
				...baseArchitecture,
				contentRuntimeSource: 'treedx_snapshot',
				localContentMaterialization: 'none',
			},
			treeDx: { libraryId: 'lib_1', repositoryId: 'repo_1', snapshotId: 'snap_1' },
		});

		expect(resolution).toMatchObject({
			effectiveContentSource: 'treedx_snapshot',
			mode: 'treedx',
			ready: true,
			snapshotId: 'snap_1',
		});
	});

	it('selects R2 published manifests and preview overlays for hosted runtimes', () => {
		const published = resolveTreeseedContentRuntimeSource({
			architecture: baseArchitecture,
			r2: { revision: 'rev-1' },
		});
		expect(published).toMatchObject({
			effectiveContentSource: 'r2_published_manifest',
			mode: 'r2',
			ready: true,
			manifestKey: 'teams/treeseed/published/common.json',
			revision: 'rev-1',
		});

		const preview = resolveTreeseedContentRuntimeSource({
			architecture: {
				...baseArchitecture,
				contentRuntimeSource: 'r2_preview_overlay',
			},
			r2: {
				manifestKey: 'teams/treeseed/published/common.json',
				overlayKey: 'teams/treeseed/previews/preview-1/overlay.json',
				revision: 'rev-2',
			},
		});
		expect(preview).toMatchObject({
			effectiveContentSource: 'r2_preview_overlay',
			mode: 'r2',
			ready: true,
			manifestKey: 'teams/treeseed/published/common.json',
			overlayKey: 'teams/treeseed/previews/preview-1/overlay.json',
			revision: 'rev-2',
		});
	});

	it('reports local content structure readiness without failing unprepared package sites', () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-content-runtime-'));
		mkdirSync(join(root, 'docs', 'src', 'content'), { recursive: true });
		writeFileSync(join(root, 'docs', 'src', 'content', 'intro.mdx'), '# Intro\n', 'utf8');

		expect(inspectTreeseedContentStructure({
			projectRoot: root,
			architecture: baseArchitecture,
		})).toMatchObject({ status: 'ready', relativePath: 'docs/src/content' });

		const missingSiteRoot = mkdtempSync(join(tmpdir(), 'treeseed-content-runtime-missing-'));
		expect(inspectTreeseedContentStructure({
			projectRoot: missingSiteRoot,
			architecture: baseArchitecture,
		})).toMatchObject({ status: 'site_not_prepared', code: 'site_not_prepared' });

		const unsupportedRoot = mkdtempSync(join(tmpdir(), 'treeseed-content-runtime-unsupported-'));
		mkdirSync(join(unsupportedRoot, 'docs', 'src', 'content'), { recursive: true });
		writeFileSync(join(unsupportedRoot, 'docs', 'src', 'content', 'data.json'), '{}\n', 'utf8');
		expect(inspectTreeseedContentStructure({
			projectRoot: unsupportedRoot,
			architecture: baseArchitecture,
		})).toMatchObject({ status: 'unsupported_structure', code: 'unsupported_content_structure' });
	});

	it('extracts safe runtime metadata from TreeDX and R2 publish targets', () => {
		const metadata = contentRuntimeMetadataFromTarget({
			contentPublish: {
				provider: 'treedx',
				snapshotId: 'snap_2',
				r2: {
					manifestKey: 'teams/treeseed/published/common.json',
					revision: 'snap_2',
				},
			},
		});

		expect(metadata).toEqual({
			r2: {
				manifestKey: 'teams/treeseed/published/common.json',
				overlayKey: null,
				revision: 'snap_2',
			},
			treeDx: {
				libraryId: null,
				repositoryId: null,
				snapshotId: 'snap_2',
			},
		});
	});
});
