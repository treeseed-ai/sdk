import { describe, expect, it } from 'vitest';
import { buildMcpCatalog, controlPlaneSchemaJson, CONTROL_PLANE_CATALOG, CONTROL_PLANE_OPERATIONS, CONTROL_PLANE_OPERATION_LIST } from '../../../../src/operator-contracts/index.ts';
import { z } from 'zod';
import { preserveInputOrder } from '../../../../src/content/validation/schema-constraints.ts';

describe('coordinator MCP boundary', () => {
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
		]));
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
		const schema = preserveInputOrder(parser);
		const input = { second: 2, first: ' value ' }, held = structuredClone(input);
		expect(JSON.stringify(schema.parse(input))).toBe('{"second":2,"first":"value","added":false}');
		expect(input).toEqual(held);
		for (const target of ['openApi3', 'jsonSchema7'] as const)
			expect(controlPlaneSchemaJson(schema, target)).toEqual(controlPlaneSchemaJson(parser, target));
		for (const invalid of [null, [], {}, { ...input, second: 0 }, { ...input, unexpected: true }])
			expect(schema.safeParse(invalid).success).toBe(false);
		const stripsUnknown = preserveInputOrder(z.object({ first: z.string() }));
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
