import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLocalTreeDxReconciliationClient } from '../../../../src/reconcile/builtin-adapters/projects/knowledge/verify-local-tree-dx-project-content.ts';

function healthResponse() {
	return new Response(JSON.stringify({
		ok: true,
		status: 'ok',
		service: 'treedx-api',
	}), {
		status: 200,
		headers: { 'content-type': 'application/json' },
	});
}

describe('local TreeDX reconciliation transport', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('allows a cold repository operation to continue beyond the generic 30-second boundary', async () => {
		vi.useFakeTimers();
		let resolveRequest: ((response: Response) => void) | undefined;
		let aborted = false;
		const client = createLocalTreeDxReconciliationClient(
			'http://treedx.example.test',
			'token',
			((_, init) => new Promise<Response>((resolve, reject) => {
				resolveRequest = resolve;
				init?.signal?.addEventListener('abort', () => {
					aborted = true;
					reject(new DOMException('aborted', 'AbortError'));
				});
			})) as typeof fetch,
		);

		const request = client.health();
		await vi.advanceTimersByTimeAsync(30_001);

		expect(aborted).toBe(false);
		resolveRequest?.(healthResponse());
		await expect(request).resolves.toMatchObject({ status: 'ok' });
	});

	it('remains bounded when TreeDX never responds', async () => {
		vi.useFakeTimers();
		const client = createLocalTreeDxReconciliationClient(
			'http://treedx.example.test',
			'token',
			((_, init) => new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener('abort', () => {
					reject(new DOMException('aborted', 'AbortError'));
				});
			})) as typeof fetch,
		);

		const request = client.health();
		const expectation = expect(request).rejects.toMatchObject({
			code: 'timeout',
			status: 0,
			details: { timeoutMs: 120_000 },
		});
		await vi.advanceTimersByTimeAsync(120_000);
		await expectation;
	});
});
