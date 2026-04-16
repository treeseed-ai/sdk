import { describe, expect, it } from 'vitest';
import {
	createTeamScopedR2OverlayContentRuntimeProvider,
	parsePublishedContentManifest,
	resolvePublishedContentBucketBinding,
	resolvePublishedContentManifestKey,
	resolvePublishedContentPreviewRoot,
	resolveTeamScopedContentLocator,
} from '../../src/platform/published-content.ts';

class MemoryR2Object {
	constructor(private readonly value: unknown) {}

	async text() {
		return JSON.stringify(this.value);
	}

	async arrayBuffer() {
		return new TextEncoder().encode(JSON.stringify(this.value)).buffer;
	}

	async json<T = unknown>() {
		return this.value as T;
	}
}

class MemoryR2Bucket {
	private readonly objects = new Map<string, unknown>();

	set(key: string, value: unknown) {
		this.objects.set(key, value);
	}

	async get(key: string) {
		const value = this.objects.get(key);
		return value === undefined ? null : new MemoryR2Object(value);
	}

	async put(key: string, value: unknown) {
		this.objects.set(key, value);
	}
}

describe('published content runtime', () => {
	it('parses manifest payloads and resolves default manifest settings', () => {
		const manifest = parsePublishedContentManifest({
			schemaVersion: 2,
			siteSlug: 'market',
			teamId: 'team-market',
			revision: 'rev-1',
			generatedAt: '2026-04-15T00:00:00.000Z',
			entries: [],
		});

		expect(manifest.siteSlug).toBe('market');
		expect(manifest.teamId).toBe('team-market');
		expect(resolvePublishedContentManifestKey({
			slug: 'market',
			cloudflare: {},
		})).toBe('teams/market/published/common.json');
		expect(resolvePublishedContentPreviewRoot({
			slug: 'market',
			cloudflare: {},
		})).toBe('teams/market/previews');
		expect(resolvePublishedContentBucketBinding({
			cloudflare: {},
		})).toBe('TREESEED_CONTENT_BUCKET');
	});

	it('loads the team production manifest, overlay, indexes, and entries from R2', async () => {
		const bucket = new MemoryR2Bucket();
		bucket.set('teams/team-market/published/common.json', {
			schemaVersion: 2,
			siteSlug: 'market',
			teamId: 'team-market',
			revision: 'rev-2',
			generatedAt: '2026-04-15T00:00:00.000Z',
			collections: {
				books: {
					objectKey: 'teams/team-market/objects/books-index.json',
					sha256: 'books-index-sha',
				},
			},
			entries: [],
			artifacts: [
				{
					id: 'artifact-1',
					itemId: 'book-1',
					kind: 'book_export',
					version: '2026.04.15',
					publishedAt: '2026-04-15T00:00:00.000Z',
					content: {
						objectKey: 'teams/team-market/artifacts/book-1-v1.json',
						sha256: 'artifact-sha',
					},
				},
			],
		});
		bucket.set('teams/team-market/previews/preview-1/overlay.json', {
			schemaVersion: 2,
			siteSlug: 'market',
			teamId: 'team-market',
			previewId: 'preview-1',
			generatedAt: '2026-04-16T00:00:00.000Z',
			baseManifestKey: 'teams/team-market/published/common.json',
			entries: [
				{
					id: 'book-2',
					model: 'books',
					slug: 'playbooks',
					title: 'Playbooks',
					content: {
						objectKey: 'teams/team-market/objects/books/playbooks.json',
						sha256: 'playbooks-sha',
					},
				},
			],
		});
		bucket.set('teams/team-market/objects/books-index.json', {
			model: 'books',
			generatedAt: '2026-04-15T00:00:00.000Z',
			count: 1,
			entries: [
				{
					id: 'book-1',
					model: 'books',
					slug: 'operations',
					title: 'Operations',
					content: {
						objectKey: 'teams/team-market/objects/books/operations.json',
						sha256: 'entry-sha',
					},
				},
			],
		});
		bucket.set('teams/team-market/objects/books/operations.json', {
			id: 'book-1',
			body: '# Operations',
		});
		bucket.set('teams/team-market/objects/books/playbooks.json', {
			id: 'book-2',
			body: '# Playbooks',
		});

		const provider = createTeamScopedR2OverlayContentRuntimeProvider({
			bucket,
			locator: resolveTeamScopedContentLocator({
				slug: 'market',
				cloudflare: {},
			}, 'team-market', 'preview-1'),
		});

		const manifest = await provider.getManifest();
		const books = await provider.listCollection('books');
		const book = await provider.getEntry('books', 'operations');
		const previewBook = await provider.getEntry('books', 'playbooks');
		const artifact = await provider.getArtifactVersion('book-1');
		const payload = await provider.getObject<{ body: string }>('teams/team-market/objects/books/operations.json');

		expect(manifest.revision).toBe('rev-2');
		expect(manifest.mode).toBe('editorial_overlay');
		expect(books).toHaveLength(2);
		expect(book?.title).toBe('Operations');
		expect(previewBook?.title).toBe('Playbooks');
		expect(artifact?.kind).toBe('book_export');
		expect(payload?.body).toBe('# Operations');
	});
});
