import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { MemoryAgentDatabase } from '../../src/d1-store.ts';
import { AgentSdk } from '../../src/sdk.ts';
import { sdkFixtureRoot } from '../test-fixture.ts';

function createTempContentSite() {
	const root = mkdtempSync(join(tmpdir(), 'treeseed-sdk-site-'));
	const pagesRoot = resolve(root, 'src', 'content', 'pages');
	mkdirSync(pagesRoot, { recursive: true });
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
	return root;
}

describe('agent sdk', () => {
	it('reads content-backed models through the public knowledge alias', async () => {
		const sdk = new AgentSdk({
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

	it('finds at least one generic agent entry in the fixture site', async () => {
		const sdk = new AgentSdk({
			repoRoot: sdkFixtureRoot,
			database: new MemoryAgentDatabase(),
		});

		const response = await sdk.search({
			model: 'agent',
			limit: 1,
			filters: [{ field: 'name', op: 'contains', value: 'Planner' }],
		});

		expect(response.model).toBe('agent');
		expect(response.payload.length).toBeGreaterThan(0);
		expect(response.payload[0]).toHaveProperty('frontmatter');
	});

	it('supports site-registered content models like template', async () => {
		const marketRoot = resolve(process.cwd(), '..', '..');
		const sdk = new AgentSdk({
			repoRoot: marketRoot,
			database: new MemoryAgentDatabase(),
			models: [
				{
					name: 'template',
					aliases: ['templates'],
					storage: 'content',
					operations: ['get', 'read', 'search', 'follow', 'pick', 'create', 'update'],
					filterableFields: ['slug', 'title', 'status', 'category', 'tags', 'templateVersion', 'updated'],
					sortableFields: ['title', 'updated', 'templateVersion'],
					pickField: 'updated',
					contentCollection: 'templates',
					contentDir: resolve(marketRoot, 'src', 'content', 'templates'),
				},
			],
		});

		const response = await sdk.search({
			model: 'template',
			limit: 1,
			filters: [{ field: 'title', op: 'contains', value: 'Basic' }],
		});

		expect(response.ok).toBe(true);
		expect(response.model).toBe('template');
		expect(response.payload.length).toBeGreaterThan(0);
		expect(response.payload[0]?.slug).toBe('starter-basic');
	});

	it('enforces expectedVersion for content-backed updates', async () => {
		const repoRoot = createTempContentSite();
		const previousDisableGit = process.env.TREESEED_AGENT_DISABLE_GIT;
		process.env.TREESEED_AGENT_DISABLE_GIT = 'true';
		try {
			const sdk = new AgentSdk({
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

	it('supports latest and oldest content pick strategies', async () => {
		const repoRoot = createTempContentSite();
		const sdk = new AgentSdk({
			repoRoot,
			database: new MemoryAgentDatabase(),
		});

		const latest = await sdk.pick({
			model: 'page',
			workerId: 'worker-latest',
			leaseSeconds: 60,
			strategy: 'latest',
		});
		const oldest = await sdk.pick({
			model: 'page',
			workerId: 'worker-oldest',
			leaseSeconds: 60,
			strategy: 'oldest',
		});

		expect(latest.payload.item?.slug).toBe('newer');
		expect(oldest.payload.item?.slug).toBe('older');
	});

	it('enforces expectedVersion for D1-backed updates', async () => {
		const database = new MemoryAgentDatabase({
			subscriptions: [
				{
					id: 1,
					email: 'person@example.com',
					status: 'active',
					updated_at: '2026-04-08T00:00:00.000Z',
				},
			],
		});
		const sdk = new AgentSdk({
			repoRoot: sdkFixtureRoot,
			database,
		});

		await expect(
			sdk.update({
				model: 'subscription',
				id: '1',
				actor: 'tester',
				expectedVersion: '2026-04-07T00:00:00.000Z',
				data: { status: 'paused' },
			}),
		).rejects.toThrow(/version mismatch/i);

		const updated = await sdk.update({
			model: 'subscription',
			id: '1',
			actor: 'tester',
			expectedVersion: '2026-04-08T00:00:00.000Z',
			data: { status: 'paused' },
		});

		expect(updated.payload?.status).toBe('paused');
	});

	it('supports D1 pick strategies for messages', async () => {
		const database = new MemoryAgentDatabase({
			messages: [
				{
					id: 1,
					type: 'task',
					status: 'pending',
					payloadJson: '{}',
					relatedModel: null,
					relatedId: null,
					priority: 1,
					availableAt: '2026-04-07T00:00:00.000Z',
					claimedBy: null,
					claimedAt: null,
					leaseExpiresAt: null,
					attempts: 0,
					maxAttempts: 3,
					createdAt: '2026-04-07T00:00:00.000Z',
					updatedAt: '2026-04-07T00:00:00.000Z',
				},
				{
					id: 2,
					type: 'task',
					status: 'pending',
					payloadJson: '{}',
					relatedModel: null,
					relatedId: null,
					priority: 10,
					availableAt: '2026-04-08T00:00:00.000Z',
					claimedBy: null,
					claimedAt: null,
					leaseExpiresAt: null,
					attempts: 0,
					maxAttempts: 3,
					createdAt: '2026-04-08T00:00:00.000Z',
					updatedAt: '2026-04-08T00:00:00.000Z',
				},
				{
					id: 3,
					type: 'task',
					status: 'pending',
					payloadJson: '{}',
					relatedModel: null,
					relatedId: null,
					priority: 5,
					availableAt: '2026-04-09T00:00:00.000Z',
					claimedBy: null,
					claimedAt: null,
					leaseExpiresAt: null,
					attempts: 0,
					maxAttempts: 3,
					createdAt: '2026-04-09T00:00:00.000Z',
					updatedAt: '2026-04-09T00:00:00.000Z',
				},
			],
		});
		const sdk = new AgentSdk({
			repoRoot: sdkFixtureRoot,
			database,
		});

		const highestPriority = await sdk.pick({
			model: 'message',
			workerId: 'worker-priority',
			leaseSeconds: 60,
			strategy: 'highest_priority',
		});
		const latest = await sdk.pick({
			model: 'message',
			workerId: 'worker-latest',
			leaseSeconds: 60,
			strategy: 'latest',
		});
		const oldest = await sdk.pick({
			model: 'message',
			workerId: 'worker-oldest',
			leaseSeconds: 60,
			strategy: 'oldest',
		});

		expect(highestPriority.payload.item?.id).toBe(2);
		expect(latest.payload.item?.id).toBe(3);
		expect(oldest.payload.item?.id).toBe(1);
	});
});
