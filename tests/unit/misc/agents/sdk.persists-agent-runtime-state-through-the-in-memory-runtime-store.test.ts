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
it('persists agent runtime state through the in-memory runtime store', async () => {
		const sdk = new AgentSdk({
			contentRepository: { adapter: 'local' },
			repoRoot: sdkFixtureRoot,
			database: new MemoryAgentDatabase(),
		});

		const message = await sdk.createMessage({
			type: 'agent.trigger',
			payload: { task: 'scan_codebase_documentation_surface' },
			relatedModel: 'objective',
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
				agentSlug: 'architect',
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
			agentSlug: 'architect',
			status: 'running',
		});

		await sdk.upsertCursor({
			agentSlug: 'architect',
			cursorKey: 'last_run_at',
			cursorValue: '2026-05-17T12:00:00.000Z',
		});
		const cursor = await sdk.getCursor({
			agentSlug: 'architect',
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
