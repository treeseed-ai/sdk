import { afterEach, describe, expect, it, vi } from 'vitest';
import { ControlPlaneClient } from '../../src/control-plane-client.ts';
import {
	createControlPlaneReporter,
	type ControlPlaneDeploymentReport,
} from '../../src/control-plane.ts';

describe('control-plane reporter', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	});

	it('resolves a market http reporter for hosted projects', () => {
		vi.stubEnv('TREESEED_PROJECT_ID', 'project-1');
		vi.stubEnv('TREESEED_PROJECT_RUNNER_TOKEN', 'runner-secret');
		vi.stubEnv('TREESEED_API_BASE_URL', 'https://market.example.com');

		const reporter = createControlPlaneReporter({
			hostingKind: 'hosted_project',
		});

		expect(reporter.kind).toBe('market_http');
		expect(reporter.enabled).toBe(true);
	});

	it('falls back to noop for self-hosted projects without registration', () => {
		const reporter = createControlPlaneReporter({
			hostingKind: 'self_hosted_project',
			registration: 'none',
		});

		expect(reporter.kind).toBe('noop');
		expect(reporter.enabled).toBe(false);
	});

	it('treats explicit runtime.none as a noop reporter even when legacy hosting is present', () => {
		const reporter = createControlPlaneReporter({
			deployConfig: {
				hosting: { kind: 'hosted_project', registration: 'optional' },
				runtime: { mode: 'none', registration: 'none' },
			},
		});

		expect(reporter.kind).toBe('noop');
		expect(reporter.enabled).toBe(false);
	});

	it('posts normalized deployment payloads through the http adapter', async () => {
		const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
			status: 200,
			headers: {
				'content-type': 'application/json',
			},
		}));
		const reporter = createControlPlaneReporter({
			kind: 'market_http',
			projectId: 'project-1',
			baseUrl: 'https://market.example.com',
			runnerToken: 'runner-secret',
			fetchImpl: fetchMock,
		});

		await reporter.reportDeployment({
			environment: 'staging',
			deploymentKind: 'content',
			status: 'success',
			sourceRef: 'staging',
			commitSha: 'abc123',
		} satisfies ControlPlaneDeploymentReport);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [, init] = fetchMock.mock.calls[0] ?? [];
		expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/v1/projects/project-1/runner/deployments');
			expect(JSON.parse(String(init?.body))).toMatchObject({
				environment: 'staging',
				deploymentKind: 'content',
				status: 'succeeded',
				commitSha: 'abc123',
			});
		});

	it('times out control-plane requests instead of waiting indefinitely', async () => {
		const fetchMock = vi.fn((_url: URL | RequestInfo, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
			init?.signal?.addEventListener('abort', () => {
				reject(new DOMException('aborted', 'AbortError'));
			});
		}));
		const reporter = createControlPlaneReporter({
			kind: 'market_http',
			projectId: 'project-1',
			baseUrl: 'https://market.example.com',
			runnerToken: 'runner-secret',
			fetchImpl: fetchMock,
			requestTimeoutMs: 5,
		});

		await expect(reporter.reportDeployment({
			environment: 'staging',
			deploymentKind: 'code',
			status: 'running',
		} satisfies ControlPlaneDeploymentReport)).rejects.toThrow(/timed out/u);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('lists catalog items through the typed control-plane client', async () => {
		const fetchMock = vi.fn(async () => new Response(JSON.stringify({
			ok: true,
			payload: [
				{
					id: 'catalog-1',
					teamId: 'team-1',
					kind: 'template',
					slug: 'starter',
					title: 'Starter',
					summary: 'Starter summary',
					visibility: 'public',
					listingEnabled: true,
					offerMode: 'free',
					manifestKey: null,
					artifactKey: null,
					searchText: 'starter',
					metadata: {},
					createdAt: '2026-04-16T00:00:00.000Z',
					updatedAt: '2026-04-16T00:00:00.000Z',
				},
			],
		}), {
			status: 200,
			headers: {
				'content-type': 'application/json',
			},
		}));
		const client = new ControlPlaneClient({
			baseUrl: 'https://market.example.com',
			accessToken: 'secret-token',
			fetchImpl: fetchMock,
		});

		const items = await client.listCatalogItems({ kind: 'template', teamId: 'team-1' });

		expect(items[0]).toMatchObject({
			id: 'catalog-1',
			slug: 'starter',
			kind: 'template',
		});
		expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/v1/catalog?kind=template&teamId=team-1');
	});

	it('posts project hosting updates through the typed control-plane client', async () => {
		const fetchMock = vi.fn(async () => new Response(JSON.stringify({
			ok: true,
			payload: {
				id: 'hosting-1',
				projectId: 'project-1',
				kind: 'hosted_project',
				registration: 'optional',
				marketBaseUrl: 'https://market.example.com',
				sourceRepoOwner: 'treeseed-ai',
				sourceRepoName: 'market',
				sourceRepoUrl: 'https://github.com/treeseed-ai/market',
				sourceRepoWorkflowPath: '.github/workflows/deploy-web.yml',
				metadata: {},
				createdAt: '2026-04-16T00:00:00.000Z',
				updatedAt: '2026-04-16T00:00:00.000Z',
			},
		}), {
			status: 200,
			headers: {
				'content-type': 'application/json',
			},
		}));
		const client = new ControlPlaneClient({
			baseUrl: 'https://market.example.com',
			accessToken: 'secret-token',
			fetchImpl: fetchMock,
		});

		const hosting = await client.upsertProjectHosting('project-1', {
			kind: 'hosted_project',
			registration: 'optional',
			marketBaseUrl: 'https://market.example.com',
			sourceRepoOwner: 'treeseed-ai',
			sourceRepoName: 'market',
			sourceRepoUrl: 'https://github.com/treeseed-ai/market',
			sourceRepoWorkflowPath: '.github/workflows/deploy-web.yml',
		});

		expect(hosting).toMatchObject({
			projectId: 'project-1',
			kind: 'hosted_project',
		});
		const [, init] = fetchMock.mock.calls[0] ?? [];
		expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/v1/projects/project-1/hosting');
		expect(JSON.parse(String(init?.body))).toMatchObject({
			kind: 'hosted_project',
			registration: 'optional',
		});
	});

	it('calls hosted runner task and manager lease routes through the typed client', async () => {
		const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
			const pathname = new URL(String(url)).pathname;
			const body = init?.body ? JSON.parse(String(init.body)) : {};
			if (pathname.endsWith('/runner/tasks') && init?.method === 'POST') {
				return new Response(JSON.stringify({
					ok: true,
					payload: {
						id: 'task-1',
						workDayId: body.workDayId,
						agentId: body.agentId,
						type: body.type,
						state: 'pending',
						priority: 0,
						idempotencyKey: body.idempotencyKey,
						payloadJson: JSON.stringify(body.payload ?? {}),
						payloadHash: null,
						attemptCount: 0,
						maxAttempts: 3,
						claimedBy: null,
						leaseExpiresAt: null,
						availableAt: '2026-05-14T00:00:00.000Z',
						lastErrorCode: null,
						lastErrorMessage: null,
						graphVersion: null,
						parentTaskId: null,
						createdAt: '2026-05-14T00:00:00.000Z',
						startedAt: null,
						completedAt: null,
						updatedAt: '2026-05-14T00:00:00.000Z',
					},
				}), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			if (pathname.endsWith('/runner/manager-leases/claim')) {
				return new Response(JSON.stringify({
					ok: true,
					payload: {
						id: 'lease-1',
						projectId: 'project-1',
						environment: body.environment,
						workDayId: body.workDayId,
						managerId: body.managerId,
						state: 'active',
						heartbeatAt: body.now,
						expiresAt: '2026-05-14T00:01:00.000Z',
						metadata: {},
						createdAt: body.now,
						updatedAt: body.now,
					},
				}), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			return new Response(JSON.stringify({ ok: true, payload: [] }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			});
		});
		const client = new ControlPlaneClient({
			baseUrl: 'https://market.example.com',
			accessToken: 'runner-token',
			fetchImpl: fetchMock as typeof fetch,
		});

		const task = await client.createRunnerTask('project-1', {
			workDayId: 'workday-1',
			agentId: 'system',
			type: 'refresh_project_graph',
			idempotencyKey: 'workday-1:refresh_project_graph',
			payload: {},
			actor: 'manager',
		});
		const lease = await client.claimRunnerManagerLease('project-1', {
			projectId: 'project-1',
			environment: 'staging',
			workDayId: 'workday-1',
			managerId: 'manager-1',
			ttlSeconds: 60,
			now: '2026-05-14T00:00:00.000Z',
		});

		expect(task).toMatchObject({ id: 'task-1', type: 'refresh_project_graph' });
		expect(lease).toMatchObject({ id: 'lease-1', managerId: 'manager-1' });
		expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/v1/projects/project-1/runner/tasks');
		expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/v1/projects/project-1/runner/manager-leases/claim');
	});

	it('calls hosted artifact, approval, and capacity runner routes through the typed client', async () => {
		const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
			const pathname = new URL(String(url)).pathname;
			const body = init?.body ? JSON.parse(String(init.body)) : {};
			if (pathname.endsWith('/runner/artifacts')) {
				return new Response(JSON.stringify({
					ok: true,
					payload: {
						artifactStorage: 'r2',
						storageMode: 'local_r2_emulation',
						outputRef: 'r2:agent-artifacts/body.json',
						objectKey: body.objectKey,
						contentType: body.contentType,
						sizeBytes: 42,
						sha256: body.sha256,
						teamId: 'team-1',
						projectId: 'project-1',
						createdAt: '2026-05-14T00:00:00.000Z',
					},
				}), { status: 201, headers: { 'content-type': 'application/json' } });
			}
			if (pathname.endsWith('/runner/approval-requests')) {
				return new Response(JSON.stringify({
					ok: true,
					payload: {
						id: body.id,
						teamId: 'team-1',
						projectId: 'project-1',
						workDayId: body.workDayId ?? null,
						taskId: body.taskId ?? null,
						kind: body.kind,
						state: 'pending',
						severity: body.severity ?? 'medium',
						title: body.title,
						summary: body.summary,
						options: body.options ?? [],
						recommendation: body.recommendation ?? null,
						policySnapshot: body.policySnapshot ?? {},
						metadata: body.metadata ?? {},
						decision: null,
						requestedByType: 'worker',
						requestedById: null,
						expiresAt: null,
						createdAt: '2026-05-14T00:00:00.000Z',
						updatedAt: '2026-05-14T00:00:00.000Z',
					},
				}), { status: 201, headers: { 'content-type': 'application/json' } });
			}
			if (pathname.endsWith('/runner/capacity/usage')) {
				return new Response(JSON.stringify({
					ok: true,
					payload: {
						entry: {
							id: 'usage-1',
							capacityProviderId: body.capacityProviderId,
							projectId: 'project-1',
							credits: body.credits,
						},
					},
				}), { status: 201, headers: { 'content-type': 'application/json' } });
			}
			return new Response(JSON.stringify({ ok: false }), { status: 404 });
		});
		const client = new ControlPlaneClient({
			baseUrl: 'https://market.example.com',
			accessToken: 'runner-token',
			fetchImpl: fetchMock as typeof fetch,
		});

		const artifact = await client.storeRunnerArtifact('project-1', {
			objectKey: 'agent-artifacts/body.json',
			content: '{"ok":true}',
			contentType: 'application/json',
			sha256: 'checksum',
		});
		const approval = await client.createRunnerApprovalRequest('project-1', {
			id: 'approval-1',
			teamId: 'team-1',
			projectId: 'project-1',
			workDayId: 'workday-1',
			kind: 'promote_knowledge_draft',
			title: 'Approve docs',
			summary: 'Approve generated docs.',
		});
		const usage = await client.reportRunnerCapacityUsage('project-1', {
			capacityProviderId: 'provider-1',
			teamId: 'team-1',
			projectId: 'project-1',
			workDayId: 'workday-1',
			phase: 'consume',
			credits: 2,
		});

		expect(artifact.outputRef).toBe('r2:agent-artifacts/body.json');
		expect(approval).toMatchObject({ id: 'approval-1', kind: 'promote_knowledge_draft' });
		expect(usage.entry).toMatchObject({ id: 'usage-1', credits: 2 });
		expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/v1/projects/project-1/runner/artifacts');
		expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/v1/projects/project-1/runner/approval-requests');
		expect(String(fetchMock.mock.calls[2]?.[0])).toContain('/v1/projects/project-1/runner/capacity/usage');
	});
});
