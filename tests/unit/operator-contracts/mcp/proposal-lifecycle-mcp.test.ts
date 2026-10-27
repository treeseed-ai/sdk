import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { buildMcpCatalog, controlPlaneSchemaJson, CONTROL_PLANE_CATALOG, CONTROL_PLANE_OPERATIONS } from '../../../../src/operator-contracts/index.ts';
import { ControlPlaneClient } from '../../../../src/entrypoints/clients/control-plane-client.ts';

const operations = [
	['withdraw', CONTROL_PLANE_OPERATIONS.governance.withdraw],
	['supersede', CONTROL_PLANE_OPERATIONS.governance.supersede],
] as const;
const forbidden = ['now', 'actorId', 'actorType', 'agentIds', 'agentClass', 'assignmentIds', 'executionPlan', 'decisionId', 'readiness'];

describe('coordinator proposal retirement', () => {
	it.each(operations)('exposes %s through the same versioned operation and explicit fields', (name, binding) => {
		const tool = buildMcpCatalog(CONTROL_PLANE_CATALOG.operations).tools.find(item => item.name === binding.descriptor.operationId);
		expect(tool).toMatchObject({ operationId: `governance.proposals.${name}`, readOnlyHint: false,
			idempotentHint: true, destructiveHint: name === 'withdraw' });
		expect(binding.descriptor).toMatchObject({ capability: 'governance.write', authentication: 'oauth',
			oauthScopes: ['treeseed:governance:write'], concurrency: { required: true }, idempotency: { required: true },
			confirmation: name === 'withdraw' ? 'input_required' : 'never',
			rest: { method: 'POST', path: `/v1/projects/{projectId}/proposals/{proposalId}/${name}` } });
		const body = { reason: 'Replace the exhausted documentation cycle through governance.', expectedProposalVersion: 10,
			evidence: { reviewResultId: 'retained-review-result' }, ...(name === 'supersede' ? { successorProposalId: 'reviewed-successor' } : {}) };
		expect(binding.schema.body.parse(body)).toEqual(body);
		expect(binding.schema.body.parse({})).toEqual({});
		expect(controlPlaneSchemaJson(binding.schema.body)).toMatchObject({ type: 'object', additionalProperties: false,
			properties: { reason: { type: 'string', minLength: 1 }, expectedProposalVersion: { type: 'integer', minimum: 1 },
				evidence: { type: 'object' } } });
		const schema = controlPlaneSchemaJson(binding.schema.body) as { properties?: Record<string, unknown> };
		if (name === 'supersede') expect(schema.properties?.successorProposalId).toMatchObject({ type: 'string', minLength: 1 });
		else expect(schema.properties).not.toHaveProperty('successorProposalId');
		for (const invalid of [null, [], '', { reason: ' ' }, { reason: null }, { evidence: [] },
			{ expectedProposalVersion: 0 }, { expectedProposalVersion: -1 }, { expectedProposalVersion: 1.5 },
			{ expectedProposalVersion: '10' }, ...forbidden.map(field => ({ ...body, [field]: 'caller-override' })),
			...(name === 'supersede' ? [{ successorProposalId: '' }, { successorProposalId: ' ' }, { successorProposalId: null }]
				: [{ successorProposalId: 'unrelated-successor' }])])
			expect(binding.schema.body.safeParse(invalid).success, JSON.stringify(invalid)).toBe(false);
		for (const path of [{ projectId: '', proposalId: 'old' }, { projectId: 'agent' },
			{ projectId: 'agent', proposalId: 'old', agentIds: ['caller-selected'] }])
			expect(binding.schema.path.safeParse(path).success).toBe(false);
	});

	// Real owning SDK serialization and loopback HTTP; downstream responses are
	// controlled inputs, not proof of API authorization or a retired Decision.
	it.each(operations)('native SDK %s transport preserves version, identity and evidence across denial and exact retry', async (name, binding) => {
		const calls: Array<{ method?: string; path?: string; body: string; version?: string; key?: string }> = [];
		let status = 200;
		const server = createServer(async (request, response) => {
			let received = ''; for await (const chunk of request) received += String(chunk);
			calls.push({ method: request.method, path: request.url, body: received,
				version: request.headers['if-match'] as string, key: request.headers['idempotency-key'] as string });
			response.writeHead(status, { 'content-type': 'application/json' });
			response.end(JSON.stringify(status === 200 ? { data: { status: name === 'withdraw' ? 'withdrawn' : 'superseded' } }
				: { status, code: 'controlled-owner-denial', title: 'Controlled downstream response' }));
		});
		const body = { reason: 'Use the reviewed correction without resetting execution history.', expectedProposalVersion: 10,
			evidence: { reviewResultId: 'original-review-result' }, ...(name === 'supersede' ? { successorProposalId: 'approved-successor' } : {}) };
		const input = { path: { projectId: 'agent', proposalId: 'original proposal/retained' }, query: {}, body };
		const held = structuredClone(input), options = { ifMatch: '10', idempotencyKey: `original-${name}-request` };
		try {
			await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
			const address = server.address(); if (!address || typeof address === 'string') throw new Error('Native loopback address required');
			const client = new ControlPlaneClient({ profile: { serverId: 'isolated', label: 'Isolated', baseUrl: `http://127.0.0.1:${address.port}` } });
			const expected = { data: { status: name === 'withdraw' ? 'withdrawn' : 'superseded' } };
			expect(await client.invoke(binding, input, options)).toEqual(expected);
			for (const denied of [403, 409, 412, 500]) {
				status = denied; await expect(client.invoke(binding, input, options)).rejects.toMatchObject({ status: denied });
			}
			status = 200; expect(await client.invoke(binding, input, options)).toEqual(expected);
			for (const field of forbidden)
				await expect(client.invoke(binding, { ...input, body: { ...body, [field]: 'override' } }, options)).rejects.toThrow();
			expect(calls).toEqual(Array(6).fill({ method: 'POST', path: `/v1/projects/agent/proposals/original%20proposal%2Fretained/${name}`,
				body: JSON.stringify(body), version: options.ifMatch, key: options.idempotencyKey }));
		} finally {
			server.closeAllConnections();
			if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
		}
		expect(server.listening).toBe(false); expect(input).toEqual(held);
	});
});
