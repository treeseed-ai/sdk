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
		vi.stubEnv('TREESEED_MARKET_API_BASE_URL', 'https://market.example.com');

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
				sourceRepoWorkflowPath: '.github/workflows/deploy.yml',
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
			sourceRepoWorkflowPath: '.github/workflows/deploy.yml',
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
});
