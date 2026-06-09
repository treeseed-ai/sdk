import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runTreeseedOperationsRunnerSmoke } from '../../src/operations/services/operations-runner-smoke.ts';

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
