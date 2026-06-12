import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CloudflareD1AgentDatabase, MemoryAgentDatabase } from '../../src/d1-store.ts';
import { NodeSqliteD1Database, resolveTreeseedSqlitePath } from '../../src/db/node-sqlite.ts';
import { AgentSdk } from '../../src/sdk.ts';
import { sdkFixtureRoot } from '../test-fixture.ts';

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

describe('Node SQLite D1 path resolution', () => {
	it('preserves SQLite in-memory database paths without creating a repository directory', () => {
		const database = new NodeSqliteD1Database(':memory:');
		try {
			expect(database.path).toBe(':memory:');
			expect(resolveTreeseedSqlitePath(':memory:')).toBe(':memory:');
			expect(existsSync(resolve(process.cwd(), ':memory:'))).toBe(false);
		} finally {
			database.close();
		}
	});

	it('prefers Wrangler Miniflare SQLite files when a D1 state directory is provided', () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-sdk-d1-state-'));
		const d1Root = resolve(root, 'v3', 'd1');
		const miniflareRoot = resolve(d1Root, 'miniflare-D1DatabaseObject');
		mkdirSync(miniflareRoot, { recursive: true });
		writeFileSync(resolve(d1Root, 'site-data.sqlite'), 'small');
		writeFileSync(resolve(miniflareRoot, 'metadata.sqlite'), 'metadata');
		writeFileSync(resolve(miniflareRoot, 'local.sqlite'), 'larger local database');

		expect(resolveTreeseedSqlitePath(d1Root)).toBe(resolve(miniflareRoot, 'local.sqlite'));
	});
});

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

	it('finds at least one generic agent entry in the fixture site', async () => {
		const sdk = new AgentSdk({
			contentRepository: { adapter: 'local' },
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

	it('persists agent runtime state through the in-memory runtime store', async () => {
		const sdk = new AgentSdk({
			contentRepository: { adapter: 'local' },
			repoRoot: sdkFixtureRoot,
			database: new MemoryAgentDatabase(),
		});

		const message = await sdk.createMessage({
			type: 'agent.trigger',
			payload: { task: 'scan_codebase_documentation_surface' },
			relatedModel: 'work_day',
			relatedId: 'local-docs-1',
			priority: 9,
			maxAttempts: 2,
			actor: 'test',
		});
		expect(message.payload).toMatchObject({
			type: 'agent.trigger',
			status: 'pending',
			priority: 9,
		});

		const claimed = await sdk.claimMessage({
			messageTypes: ['agent.trigger'],
			workerId: 'worker-1',
			leaseSeconds: 60,
		});
		expect(claimed.payload).toMatchObject({
			type: 'agent.trigger',
			status: 'claimed',
			claimedBy: 'worker-1',
		});
		await sdk.ackMessage({ id: Number(claimed.payload?.id), status: 'completed' });
		const completedMessage = await sdk.read({ model: 'message', id: String(claimed.payload?.id) });
		expect(completedMessage.payload).toMatchObject({ status: 'completed' });

		const run = await sdk.recordRun({
			run: {
				runId: 'run-1',
				agentSlug: 'planner-agent',
				triggerSource: 'workday:local-docs-1',
				status: 'running',
				selectedItemKey: null,
				selectedMessageId: null,
				branchName: null,
				prUrl: null,
				summary: null,
				error: null,
				startedAt: '2026-05-17T12:00:00.000Z',
				finishedAt: null,
			},
		});
		expect(run.payload).toMatchObject({
			runId: 'run-1',
			agentSlug: 'planner-agent',
			status: 'running',
		});

		await sdk.upsertCursor({
			agentSlug: 'planner-agent',
			cursorKey: 'last_run_at',
			cursorValue: '2026-05-17T12:00:00.000Z',
		});
		const cursor = await sdk.getCursor({
			agentSlug: 'planner-agent',
			cursorKey: 'last_run_at',
		});
		expect(cursor.payload).toBe('2026-05-17T12:00:00.000Z');

		const lease = await sdk.create({
			model: 'content_lease',
			actor: 'test',
			data: {
				model: 'knowledge',
				itemKey: 'docs/runtime-loop',
				claimedBy: 'worker-1',
			},
		});
		expect(lease.payload).toMatchObject({
			model: 'knowledge',
			itemKey: 'docs/runtime-loop',
			claimedBy: 'worker-1',
		});

		await sdk.releaseLease({ model: 'knowledge', itemKey: 'docs/runtime-loop' });
		const leases = await sdk.search({
			model: 'content_lease',
			filters: [{ field: 'model', op: 'eq', value: 'knowledge' }],
		});
		expect(leases.payload).toEqual([]);
	});

	it('supports work-day and task lifecycle operations', async () => {
		const databases = [
			new MemoryAgentDatabase(),
		];
		for (const database of databases) {
			const sdk = new AgentSdk({
			contentRepository: { adapter: 'local' },
				repoRoot: sdkFixtureRoot,
				database,
			});

				const workDay = await sdk.startWorkDay({
					projectId: 'treeseed-market',
					capacityBudget: 50,
					actor: 'test',
				});
				expect(workDay.payload?.projectId).toBe('treeseed-market');

				const graphRun = await sdk.create({
					model: 'graph_run',
					actor: 'test',
					data: {
						id: 'graph-run:test',
						workDayId: String(workDay.payload?.id),
						corpusHash: 'corpus:test',
						graphVersion: 'graph:test',
					},
				});
				expect(graphRun.payload).toMatchObject({
					id: 'graph-run:test',
					workDayId: String(workDay.payload?.id),
				});

				const task = await sdk.createTask({
					workDayId: String(workDay.payload?.id),
					agentId: 'market-curator',
					type: 'agent_root',
					idempotencyKey: `${workDay.payload?.id}:market-curator`,
					payload: { hello: 'world' },
					actor: 'test',
				});
				expect(task.payload?.agentId).toBe('market-curator');

				const claimed = await sdk.claimTask({
					id: String(task.payload?.id),
					workerId: 'worker-1',
					leaseSeconds: 60,
					actor: 'test',
				});
				expect(claimed.payload?.state).toBe('claimed');

				await sdk.recordTaskProgress({
					id: String(task.payload?.id),
					state: 'running',
					appendEvent: { kind: 'worker_started', data: { workerId: 'worker-1' } },
					actor: 'test',
				});
				const taskEvents = await sdk.search({
					model: 'task_event',
					filters: [{ field: 'task_id', op: 'in', value: [String(task.payload?.id)] }],
					limit: 10,
				});
				expect(taskEvents.payload).toEqual([
					expect.objectContaining({
						taskId: String(task.payload?.id),
						kind: 'worker_started',
					}),
				]);

				const completed = await sdk.completeTask({
					id: String(task.payload?.id),
					output: { ok: true },
					summary: { status: 'done' },
					actor: 'test',
				});
				expect(completed.payload?.state).toBe('completed');

				const taskOutputs = await sdk.search({
					model: 'task_output',
					filters: [{ field: 'task_id', op: 'in', value: [String(task.payload?.id)] }],
					limit: 10,
				});
				expect(taskOutputs.payload).toEqual([
					expect.objectContaining({
						taskId: String(task.payload?.id),
						outputJson: JSON.stringify({ ok: true }),
					}),
				]);

				const report = await sdk.createReport({
					workDayId: String(workDay.payload?.id),
					kind: 'workday_summary',
					body: { totalTasks: 1 },
					actor: 'test',
				});
				expect(report.payload?.kind).toBe('workday_summary');

				const context = await sdk.getManagerContext(String(task.payload?.id));
				expect(context.payload.task?.id).toBe(task.payload?.id);
				expect(context.payload.workDay?.id).toBe(workDay.payload?.id);
		}
	});

	it('persists manager leases and worker runner heartbeats in memory and sqlite stores', async () => {
		const sqlitePath = join(mkdtempSync(join(tmpdir(), 'treeseed-sdk-runner-')), 'site-data.sqlite');
		const sqliteD1 = new NodeSqliteD1Database(sqlitePath);
		const databases = [
			new MemoryAgentDatabase(),
			new CloudflareD1AgentDatabase(sqliteD1),
		];
		for (const database of databases) {
			const sdk = new AgentSdk({
			contentRepository: { adapter: 'local' },
				repoRoot: sdkFixtureRoot,
				database,
			});
			const first = await sdk.claimWorkdayManagerLease({
				projectId: 'project-1',
				environment: 'local',
				workDayId: 'workday-1',
				managerId: 'manager-a',
				ttlSeconds: 60,
				staleAfterSeconds: 120,
				now: '2026-05-14T12:00:00.000Z',
				metadata: { mode: 'reconcile' },
			});
			expect(first.payload).toMatchObject({ managerId: 'manager-a', state: 'active' });

			const blocked = await sdk.claimWorkdayManagerLease({
				projectId: 'project-1',
				environment: 'local',
				workDayId: 'workday-1',
				managerId: 'manager-b',
				ttlSeconds: 60,
				staleAfterSeconds: 120,
				now: '2026-05-14T12:01:00.000Z',
			});
			expect(blocked.payload).toBeNull();

			const takeover = await sdk.claimWorkdayManagerLease({
				projectId: 'project-1',
				environment: 'local',
				workDayId: 'workday-1',
				managerId: 'manager-b',
				ttlSeconds: 60,
				staleAfterSeconds: 120,
				now: '2026-05-14T12:03:30.000Z',
			});
			expect(takeover.payload).toMatchObject({ managerId: 'manager-b', state: 'active' });
			const leases = await sdk.listWorkdayManagerLeases('project-1', 'local');
			expect(leases.payload?.[0]).toMatchObject({ managerId: 'manager-b' });

			await sdk.recordWorkerRunner({
				projectId: 'project-1',
				environment: 'local',
				runnerId: 'runner-1',
				runnerServiceName: 'worker-runner-1',
				volumeIdentity: 'volume-1',
				state: 'idle',
				maxLocalWorkers: 4,
				activeLocalWorkers: 0,
				metadata: { phase: 'idle' },
			});
			const runners = await sdk.listWorkerRunners('project-1', 'local');
			expect(runners.payload).toEqual([expect.objectContaining({
				runnerId: 'runner-1',
				state: 'idle',
				availableCapacity: 4,
			})]);
		}
	});

	it('persists approval requests, decisions, and inbox items in memory and sqlite stores', async () => {
		const sqlitePath = join(mkdtempSync(join(tmpdir(), 'treeseed-sdk-approval-')), 'site-data.sqlite');
		const sqliteD1 = new NodeSqliteD1Database(sqlitePath);
		const databases = [
			new MemoryAgentDatabase(),
			new CloudflareD1AgentDatabase(sqliteD1),
		];
		try {
			for (const database of databases) {
				const sdk = new AgentSdk({
			contentRepository: { adapter: 'local' },
					repoRoot: sdkFixtureRoot,
					database,
				});
				const created = await sdk.createApprovalRequest({
					id: 'approval:test',
					teamId: 'team-1',
					projectId: 'project-1',
					workDayId: 'workday-1',
					taskId: 'task-1',
					kind: 'promote_knowledge_draft',
					title: 'Promote Runtime Knowledge',
					summary: 'Review generated runtime knowledge.',
					options: [{ id: 'approve_as_book_content' }],
					recommendation: { action: 'approve', totalScore: 29 },
					policySnapshot: { approvalPolicy: 'manual' },
					metadata: { draftId: 'knowledge:runtime' },
				});
				expect(created.payload).toMatchObject({
					id: 'approval:test',
					state: 'pending',
					metadata: { draftId: 'knowledge:runtime' },
				});

				const listed = await sdk.listApprovalRequests({ projectId: 'project-1' });
				expect(listed.payload).toEqual([expect.objectContaining({ id: 'approval:test' })]);

				const decided = await sdk.decideApprovalRequest('approval:test', {
					state: 'changes_requested',
					optionId: 'request_more_research',
					note: 'Needs another source-map pass.',
					decision: { decision: 'request_more_research' },
					decidedByType: 'user',
					decidedById: 'user-1',
				});
				expect(decided.payload).toMatchObject({
					id: 'approval:test',
					state: 'changes_requested',
					decidedById: 'user-1',
					decision: expect.objectContaining({
						decision: 'request_more_research',
						optionId: 'request_more_research',
					}),
				});

				const inbox = await sdk.upsertTeamInboxItem({
					id: 'approval:approval:test',
					teamId: 'team-1',
					projectId: 'project-1',
					kind: 'approval_required',
					state: 'waiting_for_approval',
					title: 'Approval required',
					summary: 'Generated knowledge is waiting.',
					href: '/app/governance/approval%3Atest',
					itemKey: 'approval:approval:test',
					metadata: { approvalId: 'approval:test' },
				});
				expect(inbox.payload).toMatchObject({
					id: 'approval:approval:test',
					state: 'waiting_for_approval',
					metadata: { approvalId: 'approval:test' },
				});
			}
		} finally {
			sqliteD1.close();
		}
	});
});
