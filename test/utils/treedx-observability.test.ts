import { describe, expect, it, vi } from 'vitest';
import { TreeDxApiError, TreeDxClient } from '../../src/treedx/index.ts';

function json(payload: unknown, status = 200) {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

describe('TreeDX observability client methods', () => {
	it('calls readiness, health, and metrics endpoints', async () => {
		const calls: string[] = [];
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			calls.push(url);
			if (url.endsWith('/ready')) {
				return json({ ok: true, readiness: { status: 'ready', checks: [], checkedAt: '2026-06-03T12:00:00Z' } });
			}
			if (url.endsWith('/admin/health/deep') || url.endsWith('/health/deep')) {
				return json({ ok: true, health: { status: 'healthy', checks: [], checkedAt: '2026-06-03T12:00:00Z' } });
			}
			if (url.endsWith('/api/v1/metrics')) {
				return json({ ok: true, metrics: { counters: [], histograms: [], gauges: [] } });
			}
			if (url.endsWith('/metrics')) {
				return new Response('treedx_http_requests_total 1\n', {
					status: 200,
					headers: { 'content-type': 'text/plain' },
				});
			}
			return json({ ok: true });
		});

		const client = new TreeDxClient({
			baseUrl: 'https://treedx.example.test',
			token: 'token',
			fetch: fetchMock as typeof fetch,
		});

		await expect(client.ready()).resolves.toMatchObject({ status: 'ready' });
		await expect(client.deepHealth()).resolves.toMatchObject({ status: 'healthy' });
		await expect(client.deepHealth({ admin: true })).resolves.toMatchObject({ status: 'healthy' });
		await expect(client.metrics()).resolves.toMatchObject({ counters: [], histograms: [], gauges: [] });
		await expect(client.prometheusMetrics()).resolves.toContain('treedx_http_requests_total');

		expect(calls).toEqual([
			'https://treedx.example.test/api/v1/ready',
			'https://treedx.example.test/api/v1/health/deep',
			'https://treedx.example.test/api/v1/admin/health/deep',
			'https://treedx.example.test/api/v1/metrics',
			'https://treedx.example.test/metrics',
		]);
	});

	it('preserves service unavailable errors', async () => {
		const client = new TreeDxClient({
			baseUrl: 'https://treedx.example.test',
			fetch: (async () => json({
				ok: false,
				error: {
					code: 'service_unavailable',
					message: 'Service is not ready.',
					details: { readiness: { status: 'not_ready' } },
				},
			}, 503)) as typeof fetch,
		});

		await expect(client.ready()).rejects.toMatchObject({
			name: 'TreeDxApiError',
			code: 'service_unavailable',
			status: 503,
			details: { readiness: { status: 'not_ready' } },
		} satisfies Partial<TreeDxApiError>);
	});
});
