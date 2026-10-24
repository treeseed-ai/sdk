import { describe, expect, it } from 'vitest';
import { buildMcpCatalog, controlPlaneSchemaJson, CONTROL_PLANE_CATALOG, CONTROL_PLANE_OPERATIONS, CONTROL_PLANE_OPERATION_LIST } from '../../../../src/operator-contracts/index.ts';
import { z } from 'zod';
import { preserveInputOrder } from '../../../../src/content/validation/schema-constraints.ts';
import { createServer } from 'node:http';
import { ControlPlaneClient } from '../../../../src/entrypoints/clients/control-plane-client.ts';

describe('coordinator MCP boundary', () => {
	it('revises structured proposal work through the existing version-checked governance operation', () => {
		const binding = CONTROL_PLANE_OPERATIONS.governance.updateProposal;
		expect(buildMcpCatalog(CONTROL_PLANE_CATALOG.operations).tools.map(tool => tool.name)).toContain('governance.proposals.update');
		expect(binding.descriptor.oauthScopes).toEqual(['treeseed:governance:write']);
		expect(binding.descriptor.concurrency.required).toBe(true);
		expect(binding.descriptor.idempotency.required).toBe(true);
		expect(binding.schema.path.parse({projectId:'agent',proposalId:'real-proposal'}))
			.toEqual({projectId:'agent',proposalId:'real-proposal'});
	});
	it('opens an inspected proposal for discussion through the existing governance operation', () => {
		const binding = CONTROL_PLANE_OPERATIONS.governance.openProposal;
		expect(buildMcpCatalog(CONTROL_PLANE_CATALOG.operations).tools.map(tool => tool.name)).toContain('governance.proposals.open');
		expect(binding.descriptor.oauthScopes).toEqual(['treeseed:governance:write']);
		expect(binding.descriptor.concurrency.required).toBe(true);
		expect(binding.descriptor.idempotency.required).toBe(true);
	});
	it('offers governed team-profile authoring and publication without raw TreeDX custody', () => {
		const tools = buildMcpCatalog(CONTROL_PLANE_CATALOG.operations).tools.map(tool => tool.name);
		expect(tools).toEqual(expect.arrayContaining([
			'knowledge.workspaces.create', 'knowledge.workspaces.show', 'knowledge.workspaces.content.show',
			'knowledge.workspaces.content.update', 'knowledge.workspaces.diff', 'knowledge.workspaces.abandon',
			'knowledge.workspaces.submit', 'knowledge.reviews.list', 'knowledge.reviews.decide', 'knowledge.reviews.publish',
		]));
		for (const binding of [CONTROL_PLANE_OPERATIONS.knowledge.updateWorkspaceContent,
			CONTROL_PLANE_OPERATIONS.knowledge.submitWorkspace, CONTROL_PLANE_OPERATIONS.knowledge.decideReview,
			CONTROL_PLANE_OPERATIONS.knowledge.publishReview]) {
			expect(binding.descriptor.oauthScopes).toEqual(['treeseed:knowledge:write']);
			expect(binding.descriptor.concurrency.required).toBe(true);
			expect(binding.descriptor.idempotency.required).toBe(true);
		}
	});
	it('offers coordinator detail and audit reads to clients that consume tools', () => {
		const tools = buildMcpCatalog(CONTROL_PLANE_CATALOG.operations).tools.map(tool => tool.name);
		expect(tools).toEqual(expect.arrayContaining([
			'governance.proposals.show', 'governance.decisions.show', 'inbox.items.show',
			'assignments.show', 'workdays.show', 'workdays.events.list', 'capacity.audit',
			'workdays.profiles.list', 'workdays.profiles.show',
			'agents.classes.list', 'agents.classes.show',
		]));
		for (const binding of [CONTROL_PLANE_OPERATIONS.agents.classes, CONTROL_PLANE_OPERATIONS.agents.classShow]) {
			expect(binding.descriptor).toMatchObject({ kind: 'read', capability: 'agents.read', oauthScopes: ['treeseed:read'],
				confirmation: 'never', rest: { method: 'GET' }, idempotency: { required: false } });
		}
	});
	it('native coordinator class reads retain original inventory bytes through denial and exact retry without a generic MCP dispatcher', async () => {
		const calls: Array<{ method?: string; path?: string; body: string }> = [], original = { id: 'agent-project:retained-class', status: 'archived' };
		let status = 200;
		const server = createServer(async (request, response) => {
			let body = ''; for await (const chunk of request) body += String(chunk);
			calls.push({ method: request.method, path: request.url, body });
			response.writeHead(status, { 'content-type': 'application/json' });
			response.end(JSON.stringify(status === 200 ? { data: { items: [original], cursor: 'next-original' } }
				: { status, code: 'class_read_denied', title: 'Controlled owner denial' }));
		});
		try {
			await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
			const address = server.address(); if (!address || typeof address === 'string') throw new Error('Native loopback address required');
			const client = new ControlPlaneClient({ profile: { serverId: 'isolated', label: 'Isolated', baseUrl: `http://127.0.0.1:${address.port}` } });
			const catalog = buildMcpCatalog(CONTROL_PLANE_CATALOG.operations), bindings = [CONTROL_PLANE_OPERATIONS.agents.classes, CONTROL_PLANE_OPERATIONS.agents.classShow];
			for (const binding of bindings) {
				expect(catalog.tools.map(tool => tool.name)).toContain(binding.descriptor.operationId);
				const input = { path: { projectId: 'agent-project', ...(binding === bindings[1] ? { classId: original.id } : {}) },
					query: binding === bindings[0] ? { limit: 2, status: 'archived', cursor: 'next-original' } : {}, body: undefined };
				const held = structuredClone(input), expected = { data: { items: [original], cursor: 'next-original' } };
				expect(await client.invoke(binding, input)).toEqual(expected);
				status = 403; await expect(client.invoke(binding, input)).rejects.toMatchObject({ status: 403, problem: { code: 'class_read_denied' } });
				status = 200; expect(await client.invoke(binding, input)).toEqual(expected);
				for (const path of [{ ...input.path, projectId: '' }, { ...input.path, agentIds: ['caller-selected'] }])
					await expect(client.invoke(binding, { ...input, path })).rejects.toThrow();
				expect(input).toEqual(held);
			}
			expect(calls).toEqual([
				...Array(3).fill({ method: 'GET', path: '/v1/projects/agent-project/agent-classes?limit=2&status=archived&cursor=next-original', body: '' }),
				...Array(3).fill({ method: 'GET', path: '/v1/projects/agent-project/agent-classes/agent-project%3Aretained-class', body: '' }),
			]);
		} finally { server.closeAllConnections(); if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
		expect(server.listening).toBe(false); expect(original).toEqual({ id: 'agent-project:retained-class', status: 'archived' });
	});
	it('describes start as an exact preflight receipt and denies caller execution plans', () => {
		const binding = CONTROL_PLANE_OPERATIONS.workdays.start;
		expect(controlPlaneSchemaJson(binding.schema.body)).toMatchObject({ type: 'object', additionalProperties: false,
			properties: { preflightId: { type: 'string', minLength: 1 }, preflightDigest: { type: 'string', minLength: 1 } },
			required: ['preflightId', 'preflightDigest'] });
		const input = { preflightId: 'preflight-real', preflightDigest: `sha256:${'a'.repeat(64)}` };
		expect(binding.schema.body.parse(input)).toEqual(input);
		for (const invalid of [null, [], {}, { ...input, preflightId: '' }, { ...input, preflightDigest: '' },
			...['intent', 'assignmentIds', 'executionPlanId', 'agentIds', 'idempotencyKey'].map(field => ({ ...input, [field]: 'caller-derived' }))])
			expect(binding.schema.body.safeParse(invalid).success).toBe(false);
		expect(binding.descriptor.idempotency.required).toBe(true);
	});
	it('exports the same owning parser while preserving normalized request order, defaults and denial', () => {
		const parser = z.object({ first: z.string().trim(), second: z.number().positive(),
			added: z.boolean().default(false) }).strict();
		const schema = preserveInputOrder(parser, value => parser.parse(value));
		const input = { second: 2, first: ' value ' }, held = structuredClone(input);
		expect(JSON.stringify(schema.parse(input))).toBe('{"second":2,"first":"value","added":false}');
		expect(input).toEqual(held);
		for (const target of ['openApi3', 'jsonSchema7'] as const)
			expect(controlPlaneSchemaJson(schema, target)).toEqual(controlPlaneSchemaJson(parser, target));
		for (const invalid of [null, [], {}, { ...input, second: 0 }, { ...input, unexpected: true }])
			expect(schema.safeParse(invalid).success).toBe(false);
		const strippingParser = z.object({ first: z.string() });
		const stripsUnknown = preserveInputOrder(strippingParser, value => strippingParser.parse(value));
		expect(stripsUnknown.parse({ removed: true, first: 'value' })).toEqual({ first: 'value' });
	});
	it('describes actual workday planning fields instead of an opaque body', () => {
		expect(controlPlaneSchemaJson(CONTROL_PLANE_OPERATIONS.workdays.preflight.schema.body)).toMatchObject({
			type: 'object', additionalProperties: false,
			properties: { projects: expect.any(Object), proposalIds: expect.any(Object), decisionIds: expect.any(Object),
				groupIds: expect.any(Object), executionMode: expect.any(Object), startsAt: expect.any(Object),
				durationSeconds: expect.any(Object), allocation: expect.any(Object) },
			required: expect.arrayContaining(['profileId', 'projects', 'startsAt']),
		});
	});
	it('keeps storage, service, account and project administration off both MCP surfaces', () => {
		const excluded = CONTROL_PLANE_OPERATION_LIST.filter(({ descriptor: d }) =>
			d.operationId.startsWith('treedx.') || d.operationId.startsWith('services.')
			|| d.operationId.startsWith('research.') || d.operationId.startsWith('knowledge.shares.')
			|| d.operationId.startsWith('accounts.') || d.operationId === 'teams.create'
			|| d.operationId === 'teams.profile.show' || d.operationId === 'feedback.create'
			|| d.operationId.startsWith('discussions.')
			|| ['projects.create', 'projects.update', 'projects.archive', 'projects.restore'].includes(d.operationId));
		expect(excluded.length).toBeGreaterThan(80);
		for (const { descriptor } of excluded) {
			expect(descriptor.surfaces, descriptor.operationId).not.toContain('mcp_tool');
			expect(descriptor.surfaces, descriptor.operationId).not.toContain('mcp_resource');
			if (descriptor.rest) expect(descriptor.surfaces, descriptor.operationId).toContain('rest');
		}
	});

	it('retains governed team planning, communication, admission and evaluation', () => {
		const catalog = buildMcpCatalog(CONTROL_PLANE_CATALOG.operations);
		const tools = catalog.tools.map(tool => tool.name);
		expect(tools).toEqual(expect.arrayContaining([
			'agents.team.clone.plan', 'agents.team.clone.apply', 'communications.send',
			'communications.topics.timeline', 'governance.proposals.create',
			'workdays.plan', 'workdays.start', 'workdays.stop', 'execution.graph.show',
			'assignments.explain', 'assignments.recover', 'capacity.usage', 'providers.status',
		]));
		const exposed = CONTROL_PLANE_CATALOG.operations.filter(d => d.surfaces.includes('mcp_tool') || d.surfaces.includes('mcp_resource'));
		for (const descriptor of exposed) {
			expect(descriptor.authentication, descriptor.operationId).toBe('oauth');
			expect(descriptor.oauthScopes, descriptor.operationId).not.toContain('treeseed:admin');
		}
		// MCP is a projection of the same descriptors, never a generic dispatch API.
		expect(tools.some(name => /invoke|batch|provider.*lease|provider.*settle/u.test(name))).toBe(false);
	});
});
