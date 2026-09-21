import { describe, expect, it } from 'vitest';
import { validatePortableContentData } from '../../../src/content/validation/portable-content-data.ts';

const book = {
	schemaVersion: 'treeseed.book/v3', id: 'sdk-architecture', projectId: 'sdk', slug: 'architecture',
	revision: 1,
	title: 'SDK Architecture', summary: 'The governed SDK architecture.', status: 'published',
	visibility: 'team', order: 0, groupIds: ['architecture'], packPolicy: 'allowed',
};
const bookRef = { store: 'treedx', model: 'book', id: book.id, revision: 1,
	repository: 'treeseed-ai/sdk-library', path: 'books/architecture.md', commit: 'a'.repeat(40),
	digest: `sha256:${'b'.repeat(64)}` };
const page = { schemaVersion: 'treeseed.knowledge-page/v2', id: 'sdk.architecture.overview',
	projectId: 'sdk', bookRef, slug: 'overview', title: 'Overview', body: 'One governed architecture.',
	status: 'published', visibility: 'team', order: 0 };

describe('exact Book and Knowledge content cutover', () => {
	it('accepts one project-owned Book and a page pinned to its exact TreeDX version', () => {
		expect(validatePortableContentData('book', book).ok).toBe(true);
		expect(validatePortableContentData('knowledge', page).ok).toBe(true);
	});
	it('rejects retired shapes and missing exact references without aliases', () => {
		expect(validatePortableContentData('book', { ...book, schemaVersion: 'treeseed.book/v2' }).ok).toBe(false);
		expect(validatePortableContentData('knowledge', { ...page, schemaVersion: 'treeseed.knowledge-page/v1' }).ok).toBe(false);
		expect(validatePortableContentData('knowledge', { ...page, bookRef: undefined, bookId: book.id }).ok).toBe(false);
		expect(validatePortableContentData('knowledge', { ...page, bookRef: { ...bookRef, digest: undefined } }).ok).toBe(false);
		expect(validatePortableContentData('knowledge', { ...page, bookRef: { ...bookRef, path: undefined } }).ok).toBe(false);
		expect(validatePortableContentData('book', { ...book, slug: 'Not A Slug' }).ok).toBe(false);
		expect(validatePortableContentData('knowledge', { ...page, relatedRefs: [bookRef, bookRef] }).ok).toBe(false);
	});
});

describe('project objective cutover', () => {
	const objective = { schemaVersion: 'treeseed.objective/v1', id: 'sdk-core', projectId: 'sdk',
		title: 'SDK Core Objective', outcome: 'Maintain one typed public SDK.', status: 'active', evidenceRefs: [] };
	it('requires the canonical project-owned outcome', () => {
		expect(validatePortableContentData('objective', objective).ok).toBe(true);
		expect(validatePortableContentData('objective', { ...objective, projectId: undefined }).ok).toBe(false);
		expect(validatePortableContentData('objective', { ...objective, description: 'legacy copy' }).ok).toBe(false);
	});
});

describe('exact Discussion content cutover', () => {
	const subjectRef = { store: 'postgresql', model: 'project', id: 'sdk' };
	const discussion = { schemaVersion: 'treeseed.discussion/v1', id: 'sdk-chat', projectId: 'sdk',
		subjectRef, status: 'open', participantClasses: [], title: 'SDK chat', teamId: 'treeseed',
		createdAt: '2026-09-20T12:00:00.000Z' };
	const message = { schemaVersion: 'treeseed.discussion-message/v1', id: 'message-1',
		discussionRef: { store: 'treedx', model: 'discussion', id: discussion.id,
			path: 'discussions/sdk-chat.mdx', revision: 1, digest: `sha256:${'a'.repeat(64)}` },
		authorRef: { store: 'postgresql', model: 'user', id: 'user-1' }, body: 'A useful message.',
		createdAt: '2026-09-20T12:00:00.000Z' };
	it('accepts exact canonical discussion and message content, rejecting retired names', () => {
		expect(validatePortableContentData('discussion', discussion).ok).toBe(true);
		expect(validatePortableContentData('discussion_message', message).ok).toBe(true);
		expect(validatePortableContentData('discussion', { ...discussion, team_id: 'treeseed' }).ok).toBe(false);
		expect(validatePortableContentData('discussion_message', { ...message, discussionRef: undefined, discussion_id: discussion.id }).ok).toBe(false);
		expect(validatePortableContentData('discussion', { ...discussion, participantClasses: ['architect', 'architect'] }).ok).toBe(false);
	});
});
