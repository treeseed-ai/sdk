import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runTreeseedOperationsRunnerSmoke } from '../../../src/operations/services/operations-runner-smoke.ts';

let roots: string[] = [];

afterEach(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
	roots = [];
});

function root() {
	const path = mkdtempSync(resolve(tmpdir(), 'treeseed-runner-smoke-'));
	roots.push(path);
	return path;
}

function response(payload: unknown, status = 200) {
	return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

describe('operations runner smoke', () => {
	it('uses managed local dev defaults for local smoke', async () => {
		const headers: string[] = [];
		const report = await runTreeseedOperationsRunnerSmoke({
			tenantRoot: root(),
			environment: 'local',
			env: {},
			fetchImpl: (async (url: URL | RequestInfo, init?: RequestInit) => {
				const value = String(url);
				headers.push(String(new Headers(init?.headers).get('x-treeseed-service-secret') ?? ''));
				if (value.endsWith('/healthz') || value.endsWith('/healthz/deep')) return response({ ok: true });
				if (value.endsWith('/v1/platform/operations')) return response({ ok: true, operation: { id: 'op-local', status: 'queued' } }, 202);
				if (value.endsWith('/v1/platform/operations/op-local')) return response({ ok: true, operation: { id: 'op-local', status: 'completed', assignedRunnerId: 'runner-local' } });
				if (value.endsWith('/v1/platform/operations/op-local/events')) return response({ ok: true, events: [{ kind: 'runner.completed', createdAt: '2026-06-07T00:00:00.000Z' }] });
				return response({ error: 'not found' }, 404);
			}) as typeof fetch,
		});
		expect(report.ok).toBe(true);
		expect(report.environment).toBe('local');
		expect(report.baseUrl).toBe('http://127.0.0.1:3000');
		expect(headers).toContain('treeseed-web-service-dev-secret');
		expect(JSON.stringify(report)).not.toContain('treeseed-web-service-dev-secret');
	});

	it('creates and observes a completed diagnostic operation', async () => {
		const calls: string[] = [];
		const report = await runTreeseedOperationsRunnerSmoke({
			tenantRoot: root(),
			environment: 'staging',
			baseUrl: 'https://api.example.test',
			serviceId: 'web',
			serviceSecret: 'secret',
			fetchImpl: (async (url: URL | RequestInfo) => {
				const value = String(url);
				calls.push(value);
				if (value.endsWith('/healthz') || value.endsWith('/healthz/deep')) return response({ ok: true });
				if (value.endsWith('/v1/platform/operations')) return response({ ok: true, operation: { id: 'op-1', status: 'queued' } }, 202);
				if (value.endsWith('/v1/platform/operations/op-1')) return response({ ok: true, operation: { id: 'op-1', status: 'completed', assignedRunnerId: 'runner-1' } });
				if (value.endsWith('/v1/platform/operations/op-1/events')) return response({ ok: true, events: [{ kind: 'checkpoint', createdAt: '2026-06-07T00:00:00.000Z' }] });
				return response({ error: 'not found' }, 404);
			}) as typeof fetch,
		});
		expect(report.ok).toBe(true);
		expect(report.operationId).toBe('op-1');
		expect(report.runnerId).toBe('runner-1');
		expect(calls.some((call) => call.endsWith('/healthz/deep'))).toBe(true);
		expect(JSON.stringify(report)).not.toContain('secret');
	});

	it('uses package-local hosted API domains for production smoke', async () => {
		const tenantRoot = root();
		writeFileSync(resolve(tenantRoot, 'treeseed.site.yaml'), `
surfaces:
  api:
    environments:
      prod:
        domain: api.treeseed.dev
services:
  api:
    environments:
      local:
        baseUrl: http://127.0.0.1:3000
`.trimStart(), 'utf8');
		const calls: string[] = [];
		const report = await runTreeseedOperationsRunnerSmoke({
			tenantRoot,
			environment: 'prod',
			env: {
				TREESEED_API_BASE_URL: 'http://127.0.0.1:3000',
				TREESEED_WEB_SERVICE_SECRET: 'secret',
			},
			fetchImpl: (async (url: URL | RequestInfo) => {
				const value = String(url);
				calls.push(value);
				if (value.endsWith('/healthz') || value.endsWith('/healthz/deep')) return response({ ok: true });
				if (value.endsWith('/v1/platform/operations')) return response({ ok: true, operation: { id: 'op-prod', status: 'queued' } }, 202);
				if (value.endsWith('/v1/platform/operations/op-prod')) return response({ ok: true, operation: { id: 'op-prod', status: 'completed', assignedRunnerId: 'runner-prod' } });
				if (value.endsWith('/v1/platform/operations/op-prod/events')) return response({ ok: true, events: [{ kind: 'runner.completed', createdAt: '2026-06-07T00:00:00.000Z' }] });
				return response({ error: 'not found' }, 404);
			}) as typeof fetch,
		});

		expect(report.ok).toBe(true);
		expect(report.baseUrl).toBe('https://api.treeseed.dev');
		expect(calls.every((call) => call.startsWith('https://api.treeseed.dev/'))).toBe(true);
	});

	it('rejects explicit loopback base URLs for hosted smoke', async () => {
		const report = await runTreeseedOperationsRunnerSmoke({
			tenantRoot: root(),
			environment: 'prod',
			baseUrl: 'http://127.0.0.1:3000',
			serviceSecret: 'secret',
			fetchImpl: (async () => response({ ok: true })) as typeof fetch,
		});

		expect(report.ok).toBe(false);
		expect(report.issues.join(' ')).toContain('must target a live hosted API URL');
	});

	it('prefers the canonical web service secret over the legacy API-prefixed fallback', async () => {
		const serviceIds: string[] = [];
		const secrets: string[] = [];
		const report = await runTreeseedOperationsRunnerSmoke({
			tenantRoot: root(),
			environment: 'staging',
			baseUrl: 'https://api.example.test',
			env: {
				TREESEED_WEB_SERVICE_ID: 'canonical-web',
				TREESEED_API_WEB_SERVICE_ID: 'legacy-web',
				TREESEED_WEB_SERVICE_SECRET: 'canonical-secret',
				TREESEED_API_WEB_SERVICE_SECRET: 'legacy-secret',
			},
			fetchImpl: (async (url: URL | RequestInfo, init?: RequestInit) => {
				const value = String(url);
				const headers = new Headers(init?.headers);
				if (headers.has('x-treeseed-service-id')) {
					serviceIds.push(String(headers.get('x-treeseed-service-id')));
				}
				if (headers.has('x-treeseed-service-secret')) {
					secrets.push(String(headers.get('x-treeseed-service-secret')));
				}
				if (value.endsWith('/healthz') || value.endsWith('/healthz/deep')) return response({ ok: true });
				if (value.endsWith('/v1/platform/operations')) return response({ ok: true, operation: { id: 'op-1', status: 'queued' } }, 202);
				if (value.endsWith('/v1/platform/operations/op-1')) return response({ ok: true, operation: { id: 'op-1', status: 'completed', assignedRunnerId: 'runner-1' } });
				if (value.endsWith('/v1/platform/operations/op-1/events')) return response({ ok: true, events: [{ kind: 'runner.completed', createdAt: '2026-06-07T00:00:00.000Z' }] });
				return response({ error: 'not found' }, 404);
			}) as typeof fetch,
		});

		expect(report.ok).toBe(true);
		expect(serviceIds).toContain('canonical-web');
		expect(serviceIds).not.toContain('legacy-web');
		expect(secrets).toContain('canonical-secret');
		expect(secrets).not.toContain('legacy-secret');
	});

	it('accepts succeeded as a terminal success status', async () => {
		const report = await runTreeseedOperationsRunnerSmoke({
			tenantRoot: root(),
			environment: 'staging',
			baseUrl: 'https://api.example.test',
			serviceId: 'web',
			serviceSecret: 'secret',
			fetchImpl: (async (url: URL | RequestInfo) => {
				const value = String(url);
				if (value.endsWith('/healthz') || value.endsWith('/healthz/deep')) return response({ ok: true });
				if (value.endsWith('/v1/platform/operations')) return response({ ok: true, operation: { id: 'op-1', status: 'queued' } }, 202);
				if (value.endsWith('/v1/platform/operations/op-1')) return response({ ok: true, operation: { id: 'op-1', status: 'succeeded', assignedRunnerId: 'runner-1' } });
				if (value.endsWith('/v1/platform/operations/op-1/events')) return response({ ok: true, events: [{ kind: 'runner.completed', createdAt: '2026-06-07T00:00:00.000Z' }] });
				return response({ error: 'not found' }, 404);
			}) as typeof fetch,
		});
		expect(report.ok).toBe(true);
		expect(report.finalStatus).toBe('succeeded');
		expect(report.runnerId).toBe('runner-1');
	});

	it('fails fast when the operation stays queued', async () => {
		const report = await runTreeseedOperationsRunnerSmoke({
			tenantRoot: root(),
			environment: 'staging',
			baseUrl: 'https://api.example.test',
			serviceId: 'web',
			serviceSecret: 'secret',
			timeoutMs: 1,
			pollMs: 1,
			fetchImpl: (async (url: URL | RequestInfo) => {
				const value = String(url);
				if (value.endsWith('/healthz') || value.endsWith('/healthz/deep')) return response({ ok: true });
				if (value.endsWith('/v1/platform/operations')) return response({ ok: true, operation: { id: 'op-1', status: 'queued' } }, 202);
				return response({ ok: true, operation: { id: 'op-1', status: 'queued' } });
			}) as typeof fetch,
		});
		expect(report.ok).toBe(false);
		expect(report.issues.join(' ')).toContain('not completed');
	});
});
