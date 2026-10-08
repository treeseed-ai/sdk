import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { ControlPlaneClient } from '../../../../src/entrypoints/clients/control-plane-client.ts';
import { CONTROL_PLANE_OPERATIONS } from '../../../../src/operator-contracts/index.ts';

describe('native unresolved recovery transport', () => {
	it('native client retains unresolved recovery and exact version operation bytes through denial retry and local measurement rejection', async () => {
		const calls: Array<{ method: string | undefined; url: string | undefined; body: string; key: string | string[] | undefined }> = [];
		const result = { assignmentId: 'expired-original', usageStatus: 'unresolved', settled: false }; let status = 200;
		const server = createServer(async (request, response) => {
			let body = ''; for await (const chunk of request) body += String(chunk);
			calls.push({ method: request.method, url: request.url, body, key: request.headers['idempotency-key'] });
			response.writeHead(status, { 'content-type': 'application/json' });
			response.end(JSON.stringify(status === 200 ? { data: result } : { status, code: 'recovery_denied', title: 'Controlled owning response' }));
		});
		try {
			server.listen(0, '127.0.0.1'); await once(server, 'listening');
			const address = server.address(); if (!address || typeof address === 'string') throw new Error('Native allocated address required');
			const client = new ControlPlaneClient({ profile: { serverId: 'isolated', label: 'Isolated', baseUrl: `http://127.0.0.1:${address.port}` } });
			const input = { path: { teamId: 'team-original', assignmentId: 'expired-original' }, query: {}, body: { expectedStateVersion: 7, reason: 'Active measurement unavailable' } };
			const held = structuredClone(input), expected = { method: 'POST', url: '/v1/teams/team-original/capacity/assignments/expired-original/recover',
				body: JSON.stringify(input.body), key: 'original-recovery' };
			await expect(client.invoke(CONTROL_PLANE_OPERATIONS.assignments.recover, input, { idempotencyKey: 'original-recovery' })).resolves.toEqual({ data: result });
			for (const denial of [403, 409, 503]) {
				status = denial; await expect(client.invoke(CONTROL_PLANE_OPERATIONS.assignments.recover, input, { idempotencyKey: 'original-recovery' }))
					.rejects.toMatchObject({ status: denial, problem: { code: 'recovery_denied' } });
				status = 200; await expect(client.invoke(CONTROL_PLANE_OPERATIONS.assignments.recover, input, { idempotencyKey: 'original-recovery' })).resolves.toEqual({ data: result });
			}
			expect(calls).toEqual(Array(7).fill(expected));
			for (const field of ['activeSeconds', 'elapsedSeconds', 'actorId', 'leaseToken']) {
				const changed = { ...input, body: { ...input.body, [field]: 0 } };
				await expect(client.invoke(CONTROL_PLANE_OPERATIONS.assignments.recover, changed, { idempotencyKey: 'original-recovery' })).rejects.toThrow();
			}
			expect(calls).toHaveLength(7); expect(input).toEqual(held); expect(result).toEqual({ assignmentId: 'expired-original', usageStatus: 'unresolved', settled: false });
		} finally { server.closeAllConnections(); if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
		expect(server.listening).toBe(false);
	});
});
