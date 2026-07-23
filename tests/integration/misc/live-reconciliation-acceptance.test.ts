import { describe, expect, it, vi } from 'vitest';
import {
	runTreeseedLiveReconcileTests,
	treeseedLiveReconcileResourcePrefix,
} from '../../../src/reconcile/index.ts';

describe('live reconciliation acceptance harness', () => {
	it('keeps smoke mode read-only and canonical', async () => {
		const result = await runTreeseedLiveReconcileTests({
			cwd: process.cwd(),
			environment: 'staging',
			mode: 'smoke',
			providers: ['local'],
			now: new Date('2026-06-08T12:00:00Z'),
		});

		expect(result.ok).toBe(true);
		expect(result.mode).toBe('smoke');
		expect(result.providers[0]?.report.actions.every((action) => action.kind === 'noop')).toBe(true);
		expect(result.providers[0]?.report.blockedDrift).toEqual([]);
	});

	it('blocks Railway acceptance before mutation when disposable domain config is missing', async () => {
		const result = await runTreeseedLiveReconcileTests({
			cwd: process.cwd(),
			environment: 'staging',
			mode: 'acceptance',
			providers: ['railway'],
			env: {
				TREESEED_RAILWAY_API_TOKEN: 'token',
			},
			now: new Date('2026-06-08T12:00:00Z'),
		});

		expect(result.ok).toBe(false);
		const railway = result.providers[0];
		expect(railway?.provider).toBe('railway');
		expect(railway?.createdResources).toEqual([]);
		expect(railway?.report.blockedDrift.map((entry) => entry.reason).join(' ')).toMatch(/TREESEED_LIVE_TEST_DOMAIN/u);
	});

	it('uses one deterministic Railway project identity for the provider run', async () => {
		const runId = '20260608120000';
		const prefix = treeseedLiveReconcileResourcePrefix('staging', 'railway', runId);
		const result = await runTreeseedLiveReconcileTests({
			cwd: process.cwd(),
			environment: 'staging',
			mode: 'acceptance',
			providers: ['railway'],
			env: {
				TREESEED_RAILWAY_API_TOKEN: 'token',
			},
			runId,
		});
		const railway = result.providers[0];
		const projectNodes = railway?.report.desiredGraph.filter((node) => node.provider === 'railway' && node.type === 'project') ?? [];

		expect(prefix).toBe('trsd-rail-20260608120000');
		expect(railway?.resourcePrefix).toBe(prefix);
		expect(projectNodes).toHaveLength(1);
		expect(railway?.scenarioResults.map((entry) => entry.capability)).toContain('project');
	});

	it('runs local capacity assignment proof through the public market clients when configured', async () => {
		const runId = '20260608120000';
		const prefix = treeseedLiveReconcileResourcePrefix('local', 'local', runId);
		const assignmentId = `${prefix}-assignment`;
		const calls: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
		const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = new URL(String(input));
			const method = init?.method ?? 'GET';
			const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
			calls.push({ method, path: url.pathname, body });
			if (method === 'GET' && url.pathname === '/v1/projects') {
				return Response.json({ ok: true, payload: [{ id: 'project_123', slug: 'market', teamId: 'team_123' }] });
			}
			if (method === 'GET' && url.pathname === '/v1/projects/project_123/treedx-library') {
				return Response.json({ ok: true, payload: { projectId: 'project_123', repositoryId: 'repo_123' } });
			}
			if (method === 'POST' && url.pathname === '/v1/provider/availability-sessions') {
				return Response.json({ ok: true, payload: { id: `${prefix}-session`, membershipId: 'membership_123', teamId: 'team_123', providerId: 'provider_123', status: 'open', sequence: 1, snapshot: { sequence: 1, availableFrom: '2026-06-08T12:00:00.000Z', pressure: 'idle', maxConcurrentAssignments: 1, activeAssignmentIds: [], executionProviders: [], capabilities: [] }, openedAt: '2026-06-08T12:00:00.000Z', refreshedAt: '2026-06-08T12:00:00.000Z', expiresAt: '2026-06-08T12:01:30.000Z' } });
			}
			if (method === 'PUT' && url.pathname === `/v1/provider/availability-sessions/${prefix}-session`) {
				return Response.json({ ok: true, payload: { id: `${prefix}-session`, membershipId: 'membership_123', teamId: 'team_123', providerId: 'provider_123', status: 'open', sequence: 2, snapshot: { sequence: 2, availableFrom: '2026-06-08T12:00:00.000Z', pressure: 'idle', maxConcurrentAssignments: 1, activeAssignmentIds: [], executionProviders: [], capabilities: [] }, openedAt: '2026-06-08T12:00:00.000Z', refreshedAt: '2026-06-08T12:00:01.000Z', expiresAt: '2026-06-08T12:01:31.000Z' } });
			}
			if (method === 'POST' && url.pathname === `/v1/provider/availability-sessions/${prefix}-session/close`) {
				return Response.json({ ok: true, payload: { id: `${prefix}-session`, membershipId: 'membership_123', teamId: 'team_123', providerId: 'provider_123', status: 'closed', sequence: 3, snapshot: { sequence: 3, availableFrom: '2026-06-08T12:00:00.000Z', pressure: 'idle', maxConcurrentAssignments: 1, activeAssignmentIds: [], executionProviders: [], capabilities: [] }, openedAt: '2026-06-08T12:00:00.000Z', refreshedAt: '2026-06-08T12:00:02.000Z', expiresAt: '2026-06-08T12:01:32.000Z' } });
			}
			if (method === 'GET' && url.pathname === '/v1/projects/project_123/agent-classes') {
				return Response.json({ ok: true, payload: { items: [{ id: 'agent_class_123', slug: 'agent_class_123', status: 'active' }], page: { hasMore: false, nextCursor: null } } });
			}
			if (method === 'GET' && url.pathname === '/v1/teams/team_123/capacity-grants') {
				return Response.json({
					ok: true,
					payload: { items: [{
						id: 'grant_123',
						teamId: 'team_123',
						projectId: 'project_123',
						providerId: 'provider_123',
						membershipId: 'membership_123',
						status: 'active',
						environment: 'local',
					}], page: { hasMore: false, nextCursor: null } },
				});
			}
			if (method === 'GET' && url.pathname === '/v1/teams/team_123/capacity-grants/grant_123') {
				return Response.json({ ok: true, payload: {
					id: 'grant_123', teamId: 'team_123', projectId: 'project_123', providerId: 'provider_123',
					membershipId: 'membership_123', status: 'active', environment: 'local',
				} });
			}
			if (method === 'GET' && url.pathname === '/v1/teams/team_123/capacity/allocation-sets') {
				return Response.json({ ok: true, payload: { items: [
					{ id: 'allocation_expired', status: 'active', effectiveFrom: '2025-01-01T00:00:00.000Z', effectiveUntil: '2025-02-01T00:00:00.000Z' },
					{ id: 'allocation_123', status: 'active', effectiveFrom: '2026-01-01T00:00:00.000Z', effectiveUntil: '2099-01-01T00:00:00.000Z' },
				], page: { hasMore: false, nextCursor: null } } });
			}
			if (method === 'GET' && url.pathname === '/v1/teams/team_123/capacity/allocation-sets/allocation_123') {
				return Response.json({ ok: true, payload: {
					id: 'allocation_123', status: 'active', effectiveFrom: '2026-01-01T00:00:00.000Z', effectiveUntil: '2099-01-01T00:00:00.000Z',
				} });
			}
			if (method === 'POST' && url.pathname === '/v1/workdays') {
				return Response.json({ ok: true, payload: { id: body.id, status: 'active' } }, { status: 201 });
			}
			if (method === 'POST' && url.pathname === `/v1/workdays/${prefix}-workday/complete`) {
				return Response.json({ ok: true, payload: { id: `${prefix}-workday`, status: 'completed' } });
			}
			if (method === 'POST' && url.pathname === '/v1/teams/team_123/capacity/admissions') {
				return Response.json({ ok: true, payload: { replayed: false, reservation: { id: body.reservationId }, assignment: { id: assignmentId, status: 'pending' } } }, { status: 201 });
			}
			if (method === 'POST' && url.pathname === '/v1/provider/assignments/next') {
				return Response.json({ ok: true, payload: { id: assignmentId, status: 'leased', leaseState: 'leased' }, leaseToken: 'lease_123' });
			}
			if (method === 'POST' && url.pathname === `/v1/provider/assignments/${assignmentId}/mode-runs`) {
				return Response.json({ ok: true, payload: { id: 'mode_run_123', providerAssignmentId: assignmentId, status: 'succeeded' } }, { status: 201 });
			}
			if (method === 'POST' && url.pathname === `/v1/provider/assignments/${assignmentId}/complete`) {
				return Response.json({ ok: true, payload: { id: assignmentId, status: 'completed', leaseState: 'released' } });
			}
			if (method === 'GET' && url.pathname === `/v1/teams/team_123/capacity/assignments/${assignmentId}`) {
				return Response.json({ ok: true, payload: {
					id: assignmentId,
					status: 'completed',
					workDayId: `${prefix}-workday`,
					treedxProxyHandle: { id: 'handle_123', status: 'revoked', revokedAt: '2026-06-08T12:01:00.000Z' },
					capabilityHandles: { repository: [{ id: 'repository_123', status: 'revoked' }], treeDx: [{ id: 'treedx_123', status: 'revoked' }] },
					lifecycleOutput: { artifactManifest: {
						assignmentId,
						contentReferences: [{ model: 'note', contentPath: 'src/content/notes/acceptance.mdx', receiptId: 'receipt_123', toolEventId: 'tool_create', ref: 'refs/heads/acceptance', commitSha: 'abc123' }],
						toolEvents: [
							{ id: 'tool_create', toolId: 'treeseed.content.create', status: 'completed', derivedEventTypes: ['content_created'] },
							{ id: 'tool_commit', toolId: 'treedx.commit_workspace', status: 'completed', derivedEventTypes: ['content_committed'] },
						],
					} },
				} });
			}
			if (method === 'POST' && url.pathname === '/v1/dx/projects/project_123/repos/repo_123/files/read') {
				return Response.json({ ok: true, payload: { files: [{ path: 'src/content/notes/acceptance.mdx', content: '---\ntitle: Acceptance\n---' }] } });
			}
			if (method === 'GET' && url.pathname === '/v1/teams/team_123/capacity/reservations') {
				return Response.json({ ok: true, payload: { items: [{ assignmentId, state: 'consumed' }], page: { hasMore: false, nextCursor: null } } });
			}
			if (method === 'GET' && url.pathname === '/v1/teams/team_123/capacity/usage') {
				return Response.json({ ok: true, payload: { items: [{ assignmentId, accountingMode: 'aggregate' }, { assignmentId, accountingMode: 'informational' }], page: { hasMore: false, nextCursor: null } } });
			}
			if (method === 'GET' && url.pathname === '/v1/teams/team_123/capacity/ledger') {
				return Response.json({ ok: true, payload: { items: [{ assignmentId, settlementKey: 'settlement_123' }], page: { hasMore: false, nextCursor: null } } });
			}
			if (method === 'POST' && url.pathname === `/v1/provider/assignments/${assignmentId}/settle`) {
				return Response.json({ ok: true, payload: { replayed: false, entry: { settlement_key: 'settlement_123' } } }, { status: 201 });
			}
			if (method === 'GET' && url.pathname === '/v1/projects/project_123/agent-mode-runs') {
				expect(url.searchParams.get('assignmentId')).toBe(assignmentId);
				return Response.json({ ok: true, payload: { items: [{ id: 'mode_run_123', providerAssignmentId: assignmentId, status: 'succeeded' }], page: { hasMore: false, nextCursor: null } } });
			}
			if (method === 'POST' && url.pathname === `/v1/dx/projects/project_123/repos/capacity-proof-${runId}/files/read`) {
				return Response.json({ error: 'forbidden' }, { status: 403 });
			}
			return Response.json({ error: `Unexpected request: ${method} ${url.pathname}` }, { status: 404 });
		}) as unknown as typeof fetch;

		const result = await runTreeseedLiveReconcileTests({
			cwd: process.cwd(),
			environment: 'local',
			mode: 'acceptance',
			providers: ['local'],
			env: {
				TREESEED_CAPACITY_ACCEPTANCE_API_URL: 'https://market.example.test',
				TREESEED_CAPACITY_ACCEPTANCE_ADMIN_TOKEN: 'admin-token',
				TREESEED_CAPACITY_ACCEPTANCE_TEAM_ID: 'team_123',
				TREESEED_CAPACITY_ACCEPTANCE_PROJECT_ID: 'project_123',
				TREESEED_CAPACITY_ACCEPTANCE_PROVIDER_ID: 'provider_123',
				TREESEED_CAPACITY_ACCEPTANCE_MEMBERSHIP_ID: 'membership_123',
				TREESEED_CAPACITY_ACCEPTANCE_AGENT_CLASS_ID: 'agent_class_123',
				TREESEED_CAPACITY_ACCEPTANCE_PROVIDER_ACCESS_TOKEN: 'provider-access-token',
			},
			runId,
			fetchImpl,
		});
		const local = result.providers[0];
		const proof = local?.scenarioResults.find((entry) => entry.capability === 'capacity-provider-assignment-proof');

		expect(proof?.ok, JSON.stringify(proof)).toBe(true);
		expect(proof?.retainedResources[0]).toMatchObject({
			id: assignmentId,
			type: 'capacity-runtime-proof',
			state: {
				sessionId: `${prefix}-session`,
				modeRunId: 'mode_run_123',
				finalStatus: 'completed',
			},
		});
		expect(calls.map((call) => `${call.method} ${call.path}`)).toContain('POST /v1/provider/assignments/next');
		expect(calls.find((call) => call.method === 'POST' && call.path === '/v1/workdays')?.body.allocationSetId).toBe('allocation_123');
		expect(result.ok).toBe(true);
	});

	it('cleans stale Cloudflare live-test Pages projects without deleting the static project', async () => {
		const deleted: string[] = [];
		const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			const method = init?.method ?? 'GET';
			if (url.includes('/workers/services')) return Response.json({ success: true, result: [] });
			if (url.includes('/pages/projects?')) {
				return Response.json({
					success: true,
					result: [
						{ name: 'treeseed-market' },
						{ name: 'trsd-live-staging-cloudflare-20260609010218' },
						{ name: 'trsd-live-prod-cloudflare-20260609010218' },
					],
				});
			}
			if (method === 'DELETE' && url.includes('/pages/projects/')) {
				deleted.push(decodeURIComponent(url.split('/pages/projects/')[1] ?? ''));
				return Response.json({ success: true, result: null });
			}
			if (url.includes('/r2/buckets')) return Response.json({ success: true, result: { buckets: [] } });
			if (url.includes('/storage/kv/namespaces')) return Response.json({ success: true, result: [] });
			if (url.includes('/d1/database')) return Response.json({ success: true, result: [] });
			if (url.includes('/queues')) return Response.json({ success: true, result: { queues: [] } });
			if (url.includes('/challenges/widgets')) return Response.json({ success: true, result: [] });
			if (url.includes('/dns_records')) return Response.json({ success: true, result: [] });
			throw new Error(`Unexpected Cloudflare request: ${method} ${url}`);
		}) as unknown as typeof fetch;

		const result = await runTreeseedLiveReconcileTests({
			cwd: process.cwd(),
			environment: 'staging',
			mode: 'cleanup',
			providers: ['cloudflare'],
			env: {
				TREESEED_CLOUDFLARE_ACCOUNT_ID: 'account-id',
				TREESEED_CLOUDFLARE_API_TOKEN: 'token',
				CLOUDFLARE_ZONE_ID: 'zone-id',
				TREESEED_LIVE_TEST_DOMAIN: 'example.com',
			},
			runId: '20260609120000',
			fetchImpl,
		});

		expect(result.ok).toBe(true);
		expect(deleted).toEqual(['trsd-live-staging-cloudflare-20260609010218']);
		expect(result.providers[0]?.destroyedResources.map((entry) => entry.id)).toContain('trsd-live-staging-cloudflare-20260609010218');
	});
});
