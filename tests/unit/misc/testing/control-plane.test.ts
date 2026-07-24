import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	createControlPlaneReporter,
	type ControlPlaneDeploymentReport,
} from '../../../../src/entrypoints/clients/control-plane.ts';

describe('control-plane reporter', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	});

	it('resolves a market http reporter for hosted projects', () => {
		vi.stubEnv('TREESEED_PROJECT_ID', 'project-1');
		vi.stubEnv('TREESEED_PROJECT_RUNNER_TOKEN', 'runner-secret');
		vi.stubEnv('TREESEED_API_BASE_URL', 'https://market.example.com');
		const reporter = createControlPlaneReporter({ hostingKind: 'hosted_project' });
		expect(reporter.kind).toBe('market_http');
		expect(reporter.enabled).toBe(true);
	});

	it('falls back to noop for self-hosted projects without registration', () => {
		const reporter = createControlPlaneReporter({ hostingKind: 'self_hosted_project', registration: 'none' });
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

	it('posts normalized deployment payloads through the runner reporter', async () => {
		const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
			status: 200,
			headers: { 'content-type': 'application/json' },
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

	it('times out runner reports instead of waiting indefinitely', async () => {
		const fetchMock = vi.fn((_url: URL | RequestInfo, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
			init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
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
});
