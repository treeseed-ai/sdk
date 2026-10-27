import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { buildMcpCatalog, controlPlaneSchemaJson, CONTROL_PLANE_CATALOG, CONTROL_PLANE_OPERATIONS } from '../../../../src/operator-contracts/index.ts';
import { ControlPlaneClient } from '../../../../src/entrypoints/clients/control-plane-client.ts';

const binding = CONTROL_PLANE_OPERATIONS.governance.evaluate;
const body = { adminDecision: 'approved', expectedProposalVersion: 8, reason: 'All subscribed contributions are ready.' };

describe('coordinator proposal evaluation', () => {
	it('exposes the existing versioned evaluation with explicit coordinator inputs and no runtime overrides', () => {
		expect(buildMcpCatalog(CONTROL_PLANE_CATALOG.operations).tools.map(tool => tool.name)).toContain('governance.proposals.evaluate');
		expect(binding.descriptor).toMatchObject({ capability: 'governance.decide', oauthScopes: ['treeseed:governance:write'],
			concurrency: { required: true }, idempotency: { required: true } });
		expect(controlPlaneSchemaJson(binding.schema.body)).toMatchObject({ type: 'object', additionalProperties: false,
			properties: { adminDecision: { enum: ['approved', 'rejected', 'request_changes'] },
				expectedProposalVersion: { type: 'integer', minimum: 1 }, reason: { type: 'string', minLength: 1 } } });
		for (const adminDecision of ['approved', 'rejected', 'request_changes'])
			expect(binding.schema.body.parse({ ...body, adminDecision })).toEqual({ ...body, adminDecision });
		expect(binding.schema.body.parse({})).toEqual({}); // Existing voting-provider evaluation, with If-Match supplied separately.
		for (const invalid of [null, [], '', { adminDecision: 'accepted' }, { adminDecision: '' }, { reason: ' ' },
			{ expectedProposalVersion: 0 }, { expectedProposalVersion: -1 }, { expectedProposalVersion: 1.5 },
			{ expectedProposalVersion: '8' }, ...['now', 'actorId', 'actorType', 'simulation', 'assignmentIds',
				'agentIds', 'executionPlan', 'decisionId', 'readiness'].map(field => ({ ...body, [field]: 'caller-supplied' }))])
			expect(binding.schema.body.safeParse(invalid).success, JSON.stringify(invalid)).toBe(false);
	});

	it('native SDK evaluation transport retains exact input across denial and retry', async () => {
		const calls: Array<{ method?: string; path?: string; body: string; version?: string; key?: string }> = [];
		let status = 200;
		const server = createServer(async (request, response) => {
			let received = ''; for await (const chunk of request) received += String(chunk);
			calls.push({ method: request.method, path: request.url, body: received,
				version: request.headers['if-match'] as string, key: request.headers['idempotency-key'] as string });
			response.writeHead(status, { 'content-type': 'application/json' });
			response.end(JSON.stringify(status === 200 ? { data: { status: 'accepted', activeVersion: 8 } }
				: { status, code: status === 403 ? 'project_permission_denied' : 'proposal_version_conflict', title: 'Owner denial' }));
		});
		const input = { path: { projectId: 'treedx', proposalId: 'federation-repair' }, query: {}, body };
		const original = structuredClone(input), options = { ifMatch: '8', idempotencyKey: 'exact-evaluation-retry' };
		try {
			await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
			const address = server.address(); if (!address || typeof address === 'string') throw new Error('Native loopback address required');
			const client = new ControlPlaneClient({ profile: { serverId: 'isolated', label: 'Isolated', baseUrl: `http://127.0.0.1:${address.port}` } });
			expect(await client.invoke(binding, input, options)).toEqual({ data: { status: 'accepted', activeVersion: 8 } });
			for (const denied of [403, 409]) {
				status = denied;
				await expect(client.invoke(binding, input, options)).rejects.toMatchObject({ status: denied });
			}
			status = 200;
			expect(await client.invoke(binding, input, options)).toEqual({ data: { status: 'accepted', activeVersion: 8 } });
			for (const field of ['now', 'actorId', 'assignmentIds', 'agentIds', 'executionPlan'])
				await expect(client.invoke(binding, { ...input, body: { ...body, [field]: 'override' } }, options)).rejects.toThrow();
			expect(calls).toEqual(Array(4).fill({ method: 'POST', path: '/v1/projects/treedx/proposals/federation-repair/evaluate',
				body: JSON.stringify(body), version: '8', key: options.idempotencyKey }));
		} finally {
			server.closeAllConnections();
			if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
		}
		expect(server.listening).toBe(false);
		expect(input).toEqual(original);
	});
});
