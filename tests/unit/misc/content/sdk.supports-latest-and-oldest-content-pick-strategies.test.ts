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
it('supports latest and oldest content pick strategies', async () => {
		const repoRoot = createTempContentSite();
		const sdk = new AgentSdk({
			contentRepository: { adapter: 'local' },
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

		expect(latest.payload.item?.slug).toBe('aliased');
		expect(oldest.payload.item?.slug).toBe('older');
	});

it('resolves legacy content field aliases during search', async () => {
		const repoRoot = createTempContentSite();
		const sdk = new AgentSdk({
			contentRepository: { adapter: 'local' },
			repoRoot,
			database: new MemoryAgentDatabase(),
		});

		const byCanonical = await sdk.search({
			model: 'page',
			filters: [{ field: 'updated_at', op: 'gte', value: '2026-04-09T00:00:00.000Z' }],
		});
		const byAlias = await sdk.search({
			model: 'page',
			filters: [{ field: 'updatedAt', op: 'gte', value: '2026-04-09T00:00:00.000Z' }],
		});

		expect(byCanonical.payload.map((item) => item.slug)).toContain('aliased');
		expect(byAlias.payload.map((item) => item.slug)).toContain('aliased');
	});

it('canonicalizes legacy content aliases on write', async () => {
		const repoRoot = createTempContentSite();
		const previousDisableGit = process.env.TREESEED_AGENT_DISABLE_GIT;
		process.env.TREESEED_AGENT_DISABLE_GIT = 'true';
		try {
			const sdk = new AgentSdk({
			contentRepository: { adapter: 'local' },
				repoRoot,
				database: new MemoryAgentDatabase(),
			});
			const updated = await sdk.update({
				model: 'page',
				slug: 'aliased',
				actor: 'tester',
				expectedVersion: '2026-04-09T00:00:00.000Z',
				data: { updatedAt: '2026-04-10T00:00:00.000Z' },
			});

			const written = readFileSync(resolve(updated.payload.git.worktreePath, 'src', 'content', 'pages', 'aliased.mdx'), 'utf8');
			expect(written).toContain('updated_at: 2026-04-10T00:00:00.000Z');
			expect(written).not.toContain('updatedAt:');
		} finally {
			if (previousDisableGit === undefined) {
				delete process.env.TREESEED_AGENT_DISABLE_GIT;
			} else {
				process.env.TREESEED_AGENT_DISABLE_GIT = previousDisableGit;
			}
		}
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
			contentRepository: { adapter: 'local' },
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
			contentRepository: { adapter: 'local' },
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
