import { describe, expect, it } from 'vitest';

import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { tmpdir } from 'node:os';

import { join, resolve } from 'node:path';

import { CloudflareD1AgentDatabase, MemoryAgentDatabase } from '../../../../src/persistence/d1-store.ts';

import { NodeSqliteD1Database, resolveSqlitePath } from '../../../../src/db/node-sqlite.ts';

import { AgentSdk } from '../../../../src/entrypoints/models/sdk.ts';

import { sdkFixtureRoot } from '../../../support/test-fixture.ts';

function createTempContentSite() {
	const root = mkdtempSync(join(tmpdir(), 'treeseed-sdk-site-'));
	const pagesRoot = resolve(root, 'src', 'content', 'pages');
	const templatesRoot = resolve(root, 'src', 'content', 'templates');
	mkdirSync(pagesRoot, { recursive: true });
	mkdirSync(templatesRoot, { recursive: true });
	writeFileSync(
		resolve(pagesRoot, 'older.mdx'),
		`---
title: Older
slug: older
updated: 2026-04-07T00:00:00.000Z
---
Older body
`,
		'utf8',
	);
	writeFileSync(
		resolve(pagesRoot, 'newer.mdx'),
		`---
title: Newer
slug: newer
updated: 2026-04-08T00:00:00.000Z
---
Newer body
`,
		'utf8',
	);
	writeFileSync(
		resolve(pagesRoot, 'aliased.mdx'),
		`---
title: Aliased
slug: aliased
updatedAt: 2026-04-09T00:00:00.000Z
---
Aliased body
`,
		'utf8',
	);
	writeFileSync(
		resolve(templatesRoot, 'fixture-template.mdx'),
		`---
title: Fixture Template
slug: fixture-template
status: active
category: starter
tags:
  - fixture
templateVersion: 1.0.0
updatedAt: 2026-04-10T00:00:00.000Z
---
Fixture template body
`,
		'utf8',
	);
	return root;
}
describe('agent sdk', () => {
it('reads content-backed models through the public knowledge alias', async () => {
		const sdk = new AgentSdk({
			contentRepository: { adapter: 'local' },
			repoRoot: sdkFixtureRoot,
			database: new MemoryAgentDatabase(),
		});
		const response = await sdk.search({
			model: 'knowledge',
			limit: 3,
			filters: [{ field: 'title', op: 'contains', value: 'TreeSeed' }],
		});

		expect(response.ok).toBe(true);
		expect(response.model).toBe('knowledge');
		expect(response.payload.length).toBeGreaterThan(0);
		expect(response.payload[0]).toHaveProperty('body');
	});

it('supports read as a public alias for get', async () => {
		const sdk = new AgentSdk({
			contentRepository: { adapter: 'local' },
			repoRoot: sdkFixtureRoot,
			database: new MemoryAgentDatabase(),
		});
		const response = await sdk.read({
			model: 'knowledge',
			slug: 'research/inquiry/questions-as-records',
		});

		expect(response.ok).toBe(true);
		expect(response.operation).toBe('read');
		expect(response.payload).toHaveProperty('slug');
	});

it('claims the highest-priority pending message exactly once', async () => {
		const database = new MemoryAgentDatabase({
			messages: [
				{
					id: 1,
					type: 'task_complete',
					status: 'pending',
					payloadJson: '{"ok":true}',
					relatedModel: null,
					relatedId: null,
					priority: 5,
					availableAt: new Date(Date.now() - 1000).toISOString(),
					claimedBy: null,
					claimedAt: null,
					leaseExpiresAt: null,
					attempts: 0,
					maxAttempts: 3,
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
				},
			],
		});
		const sdk = new AgentSdk({
			contentRepository: { adapter: 'local' },
			repoRoot: sdkFixtureRoot,
			database,
		});

		const first = await sdk.pick({
			model: 'message',
			leaseSeconds: 60,
			workerId: 'reviewer-1',
		});
		const second = await sdk.pick({
			model: 'message',
			leaseSeconds: 60,
			workerId: 'reviewer-2',
		});

		expect(first.payload.item).not.toBeNull();
		expect((first.payload.item as { claimedBy?: string } | null)?.claimedBy).toBe('reviewer-1');
		expect(second.payload.item).toBeNull();
	});

it('resolves the expanded public model set', async () => {
		const sdk = new AgentSdk({
			contentRepository: { adapter: 'local' },
			repoRoot: sdkFixtureRoot,
			database: new MemoryAgentDatabase(),
		});

		const response = await sdk.search({
			model: 'person',
			limit: 1,
		});

		expect(response.model).toBe('person');
		expect(Array.isArray(response.payload)).toBe(true);
	});

it('searches representative page and note content from the fixture site', async () => {
		const sdk = new AgentSdk({
			contentRepository: { adapter: 'local' },
			repoRoot: sdkFixtureRoot,
			database: new MemoryAgentDatabase(),
		});

		const pageResponse = await sdk.search({
			model: 'page',
			limit: 1,
			filters: [{ field: 'title', op: 'contains', value: 'Vision' }],
		});
		const noteResponse = await sdk.search({
			model: 'note',
			limit: 1,
			filters: [{ field: 'title', op: 'contains', value: 'fixture' }],
		});

		expect(pageResponse.model).toBe('page');
		expect(pageResponse.payload.length).toBeGreaterThan(0);
		expect(noteResponse.model).toBe('note');
		expect(noteResponse.payload.length).toBeGreaterThan(0);
	});

it('finds canonical activity-profile agent entries in the fixture site', async () => {
		const sdk = new AgentSdk({
			contentRepository: { adapter: 'local' },
			repoRoot: sdkFixtureRoot,
			database: new MemoryAgentDatabase(),
		});

		const response = await sdk.search({
			model: 'agent',
			limit: 1,
			filters: [{ field: 'name', op: 'contains', value: 'Researcher' }],
		});

		expect(response.model).toBe('agent');
		expect(response.payload.length).toBeGreaterThan(0);
		expect(response.payload[0]).toHaveProperty('frontmatter');
		expect(response.payload[0]?.frontmatter).toMatchObject({
			slug: 'researcher',
			activityProfiles: expect.objectContaining({
				planning: expect.objectContaining({ activityType: 'planning' }),
				estimating: expect.objectContaining({ activityType: 'estimating' }),
			}),
		});
	});

it('supports site-registered content models like template', async () => {
		const repoRoot = createTempContentSite();
		const sdk = new AgentSdk({
			contentRepository: { adapter: 'local' },
			repoRoot,
			database: new MemoryAgentDatabase(),
			models: [
				{
					name: 'template',
					aliases: ['templates'],
					storage: 'content',
					operations: ['get', 'read', 'search', 'follow', 'pick', 'create', 'update'],
					fields: {
						slug: { key: 'slug', filterable: true, contentKeys: ['slug'], writeContentKey: 'slug' },
						title: { key: 'title', filterable: true, sortable: true, contentKeys: ['title'], writeContentKey: 'title' },
						status: { key: 'status', filterable: true, contentKeys: ['status'], writeContentKey: 'status' },
						category: { key: 'category', filterable: true, contentKeys: ['category'], writeContentKey: 'category' },
						tags: { key: 'tags', filterable: true, contentKeys: ['tags'], writeContentKey: 'tags' },
						template_version: { key: 'template_version', aliases: ['templateVersion'], filterable: true, sortable: true, contentKeys: ['template_version', 'templateVersion'], writeContentKey: 'template_version' },
						updated_at: { key: 'updated_at', aliases: ['updated', 'updatedAt'], filterable: true, sortable: true, contentKeys: ['updated_at', 'updated', 'updatedAt'], writeContentKey: 'updated_at' },
					},
					filterableFields: ['slug', 'title', 'status', 'category', 'tags', 'template_version', 'updated_at'],
					sortableFields: ['title', 'updated_at', 'template_version'],
					pickField: 'updated_at',
					contentCollection: 'templates',
					contentDir: resolve(repoRoot, 'src', 'content', 'templates'),
				},
			],
		});

		const response = await sdk.search({
			model: 'template',
			limit: 1,
			filters: [{ field: 'title', op: 'contains', value: 'Fixture' }],
		});

		expect(response.ok).toBe(true);
		expect(response.model).toBe('template');
		expect(response.payload.length).toBeGreaterThan(0);
		expect(response.payload[0]?.slug).toBe('fixture-template');
	});

it('enforces expectedVersion for content-backed updates', async () => {
		const repoRoot = createTempContentSite();
		const previousDisableGit = process.env.TREESEED_AGENT_DISABLE_GIT;
		process.env.TREESEED_AGENT_DISABLE_GIT = 'true';
		try {
			const sdk = new AgentSdk({
			contentRepository: { adapter: 'local' },
				repoRoot,
				database: new MemoryAgentDatabase(),
			});
			const current = await sdk.get({ model: 'page', slug: 'newer' });
			expect(current.payload?.updatedAt).toBe('2026-04-08T00:00:00.000Z');

			await expect(
				sdk.update({
					model: 'page',
					slug: 'newer',
					actor: 'tester',
					expectedVersion: '2026-04-07T00:00:00.000Z',
					data: { title: 'Mismatch' },
				}),
			).rejects.toThrow(/version mismatch/i);

			const updated = await sdk.update({
				model: 'page',
				slug: 'newer',
				actor: 'tester',
				expectedVersion: '2026-04-08T00:00:00.000Z',
				data: { title: 'Updated title' },
			});

			expect(updated.payload.item.title).toBe('Updated title');
		} finally {
			if (previousDisableGit === undefined) {
				delete process.env.TREESEED_AGENT_DISABLE_GIT;
			} else {
				process.env.TREESEED_AGENT_DISABLE_GIT = previousDisableGit;
			}
		}
	});
});
