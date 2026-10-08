import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
	CONTROL_PLANE_OPERATION_SCHEMA_VERSION,
	CONTROL_PLANE_CATALOG,
	CONTROL_PLANE_OPERATION_LIST,
	CONTROL_PLANE_OPERATIONS,
	TREESEED_COMMAND_TREE_V1,
	buildMcpCatalog,
	buildMcpResources,
	buildMcpTools,
	validateControlPlaneCatalog,
	controlPlaneSchemaJson,
	type ControlPlaneCatalog,
	type ControlPlaneOperationDescriptor,
} from '../../../src/operator-contracts/index.ts';

function operation(overrides: Partial<ControlPlaneOperationDescriptor> = {}): ControlPlaneOperationDescriptor {
	return {
		schemaVersion: CONTROL_PLANE_OPERATION_SCHEMA_VERSION,
		operationId: 'projects.list',
		description: 'List visible projects.',
		rest: { method: 'GET', path: '/v1/projects' },
		schemas: { input: 'treeseed.projects.list.input/v1', output: 'treeseed.projects.list.output/v1', errors: 'treeseed.problem/v1' },
		capability: 'projects.read',
		authentication: 'oauth',
		oauthScopes: ['treeseed:read'],
		kind: 'read',
		riskClass: 'ordinary',
		confirmation: 'never',
		idempotency: { required: false, header: 'Idempotency-Key' },
		concurrency: { required: false, readHeader: 'ETag', writeHeader: 'If-Match' },
		surfaces: ['rest', 'cli', 'mcp_tool', 'mcp_resource'],
		cacheScope: 'principal',
		pagination: 'cursor',
		audited: true,
		receipt: false,
		redactedPaths: [],
		...overrides,
	};
}

function catalog(...operations: ControlPlaneOperationDescriptor[]): ControlPlaneCatalog {
	return { schemaVersion: 'treeseed.control-plane-catalog/v1', operations };
}

describe('control-plane operation catalog', () => {
	it('projects owning operation schemas into exact reference-free OpenAPI JSON without changing native validation', () => {
		const schema = z.object({ id: z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/u), priority: z.number().int(),
			mode: z.enum(['simulation', 'production']).optional(), subject: z.object({ id: z.string().min(1) }).strict() }).strict();
		const valid = { id: 'a'.repeat(200), priority: -7, subject: { id: 'native-subject' } }, held = structuredClone(valid);
		const expected = { type: 'object', properties: { id: { type: 'string', minLength: 1, maxLength: 200, pattern: '^[A-Za-z0-9_-]+$' },
			priority: { type: 'integer' }, mode: { type: 'string', enum: ['simulation', 'production'] },
			subject: { type: 'object', properties: { id: { type: 'string', minLength: 1 } }, required: ['id'], additionalProperties: false } },
			required: ['id', 'priority', 'subject'], additionalProperties: false };
		expect(controlPlaneSchemaJson(schema)).toEqual(expected);
		expect(schema.parse(valid)).toEqual(valid);
		for (const invalid of [null, {}, { ...valid, id: '' }, { ...valid, id: 'é' }, { ...valid, id: 'a'.repeat(201) },
			{ ...valid, priority: 0.5 }, { ...valid, mode: 'other' }, { ...valid, subject: {} }, { ...valid, callerAuthority: true }]) {
			const before = structuredClone(invalid);
			expect(schema.safeParse(invalid).success).toBe(false);
			expect(invalid).toEqual(before);
		}
		const changed = controlPlaneSchemaJson(schema); Object.assign(changed, { type: 'substituted' });
		expect(controlPlaneSchemaJson(schema)).toEqual(expected); expect(valid).toEqual(held);
	});
	it('preserves exact provider and workday schema bindings and semantic denials across repeated projection', () => {
		const bindings = [CONTROL_PLANE_OPERATIONS.providers.assignment, CONTROL_PLANE_OPERATIONS.workdays.preflight];
		const descriptors = bindings.map(binding => structuredClone(binding.descriptor));
		for (const binding of bindings) for (const schema of Object.values(binding.schema)) {
			const first = controlPlaneSchemaJson(schema);
			expect(controlPlaneSchemaJson(schema)).toEqual(first);
			expect(JSON.stringify(first)).not.toContain('"$ref"');
		}
		expect(controlPlaneSchemaJson(bindings[0]!.schema.path)).toEqual({ type: 'object',
			properties: { assignmentId: { type: 'string', minLength: 1 } }, required: ['assignmentId'], additionalProperties: false });
		expect(controlPlaneSchemaJson(bindings[1]!.schema.path)).toEqual({ type: 'object',
			properties: { teamId: { type: 'string', minLength: 1 } }, required: ['teamId'], additionalProperties: false });
		const intent = { profileId: 'arbitrary-profile', projects: ['sdk'], startsAt: '2026-10-06T00:00:00.000Z', durationSeconds: 60,
			decisionIds: ['exact-decision'], planningOnly: false }, held = structuredClone(intent);
		const schema = CONTROL_PLANE_OPERATIONS.workdays.preflight.schema.body;
		expect(schema.parse(intent)).toEqual(intent);
		for (const field of ['executionPlanId', 'capacityPlanId', 'executionInputId', 'demandSetId']) {
			const invalid = { ...intent, [field]: 'caller-derived' }, before = structuredClone(invalid);
			expect(schema.safeParse(invalid).success).toBe(false); expect(invalid).toEqual(before);
		}
		for (const decisionIds of [[], ['é'], ['a'.repeat(201)], ['exact-decision', 'exact-decision'], ['valid', null]])
			expect(schema.safeParse({ ...intent, decisionIds }).success).toBe(false);
		expect(schema.parse({ ...intent, decisionIds: ['a'.repeat(200)] })).toMatchObject({ decisionIds: ['a'.repeat(200)] });
		expect(bindings.map(binding => binding.descriptor)).toEqual(descriptors); expect(intent).toEqual(held);
	});
	it('derives exact workday read resources and rejects missing or mutation REST bindings without changing operation authority', () => {
		const base = CONTROL_PLANE_OPERATIONS.workdays.show.descriptor, held = structuredClone(base);
		expect(buildMcpResources([base])).toEqual([{ uriTemplate: 'treeseed://teams/{teamId}/workdays/{runId}',
			name: base.operationId, description: base.description, mimeType: 'application/json', operationId: base.operationId, subscribable: true }]);
		for (const patch of [{ rest: undefined }, { rest: null }, { kind: 'mutation' }, { rest: { method: 'POST', path: base.rest!.path } }]) {
			const invalid = Object.assign({}, base, patch), before = structuredClone(invalid);
			expect(() => buildMcpResources([invalid])).toThrow(`MCP resource operation ${base.operationId} must be a read-only GET operation.`);
			expect(invalid).toEqual(before);
		}
		expect(buildMcpResources([Object.assign({}, base, { rest: undefined, surfaces: ['cli'] })])).toEqual([]);
		expect(base).toEqual(held);
	});
	it('exposes usage pagination without losing exact workday filtering', () => {
		expect(CONTROL_PLANE_OPERATIONS.capacity.usage.descriptor.pagination).toBe('cursor');
		const capacity = TREESEED_COMMAND_TREE_V1.commands.find(node => node.segment === 'capacity');
		const usage = capacity?.nodeType === 'branch' ? capacity.children.find(node => node.segment === 'usage') : undefined;
		expect(usage?.nodeType).toBe('leaf');
		if (usage?.nodeType !== 'leaf') throw new Error('Missing capacity usage command');
		expect(usage.options).toEqual(expect.arrayContaining([
			expect.objectContaining({ name: '--workday' }), expect.objectContaining({ name: '--limit' }), expect.objectContaining({ name: '--cursor' }),
		]));
		expect(usage.execution).toMatchObject({ input: expect.arrayContaining([
			expect.objectContaining({ target: 'query', field: 'workDayId', name: 'workday' }),
			expect.objectContaining({ target: 'query', field: 'limit', name: 'limit' }),
			expect.objectContaining({ target: 'query', field: 'cursor', name: 'cursor' }),
		]) });
	});
	it('requires operator identity and versioned input for team policy replacement', () => {
		const binding = CONTROL_PLANE_OPERATIONS.workdays.profilesUpdate;
		expect(binding.descriptor).toMatchObject({ authentication: 'oauth', oauthScopes: ['treeseed:execution'],
			kind: 'mutation', confirmation: 'input_required', idempotency: { required: true } });
		expect(binding.descriptor.concurrency.required).toBe(true);
		expect(binding.schema.body.safeParse({}).success).toBe(false);
		expect(binding.schema.body.safeParse({ commit: 'a'.repeat(40), content: '{}' }).success).toBe(false);
	});
	it('accepts a fully described operation and derives MCP annotations', () => {
		expect(validateControlPlaneCatalog(catalog(operation()))).toEqual([]);
		expect(buildMcpTools([operation()])).toEqual([expect.objectContaining({
			name: 'projects.list',
			readOnlyHint: true,
			destructiveHint: false,
		})]);
	});

	it('publishes one valid catalog with unique REST bindings', () => {
		expect(validateControlPlaneCatalog(CONTROL_PLANE_CATALOG)).toEqual([]);
		expect(new Set(CONTROL_PLANE_OPERATION_LIST.map((entry) => entry.descriptor.operationId)).size).toBe(CONTROL_PLANE_OPERATION_LIST.length);
		const paths = CONTROL_PLANE_OPERATION_LIST.flatMap((entry) => entry.descriptor.rest?.path ?? []);
		expect(paths.some((path) => path.startsWith('/v1/operator/commands'))).toBe(false);
		expect(paths.some((path) => path.startsWith('/v1/ui/'))).toBe(false);
		expect(paths.some((path) => path.startsWith('/v1/jobs'))).toBe(false);
		expect(CONTROL_PLANE_OPERATIONS.health.ready.descriptor.oauthScopes).toEqual([]);
		expect(CONTROL_PLANE_OPERATIONS.health.deep.descriptor.oauthScopes).toEqual([]);
		for (const operation of [CONTROL_PLANE_OPERATIONS.providers.register, CONTROL_PLANE_OPERATIONS.providers.registration,
			CONTROL_PLANE_OPERATIONS.providers.exchangeCredential, CONTROL_PLANE_OPERATIONS.providers.issueAccessToken]) {
			expect(operation.descriptor).toMatchObject({ authentication: 'signed_request', oauthScopes: [] });
		}
		expect(CONTROL_PLANE_OPERATIONS.providers.assignment.descriptor).toMatchObject({ authentication: 'provider', oauthScopes: [] });
		expect(CONTROL_PLANE_OPERATIONS.feedback.create.descriptor).toMatchObject({ authentication: 'oauth', oauthScopes: [] });
		expect(CONTROL_PLANE_OPERATIONS.treedx.workspaces.create.descriptor).toMatchObject({ authentication: 'oauth_or_provider', oauthScopes: ['treeseed:projects:write'], upstream: { operationId: 'createWorkspace' } });
		expect(CONTROL_PLANE_OPERATIONS.services.putCredentials.descriptor.redactedPaths).toContain('body.values');
		expect(CONTROL_PLANE_OPERATIONS.services.disconnect.descriptor.confirmation).toBe('input_required');
		expect(CONTROL_PLANE_OPERATIONS.accounts.unlinkProvider.descriptor.riskClass).toBe('credential');
		expect(CONTROL_PLANE_OPERATIONS.accounts.publicProfile.descriptor).toMatchObject({ authentication: 'anonymous', cacheScope: 'public', oauthScopes: [] });
		expect(CONTROL_PLANE_OPERATIONS.teams.profile.descriptor).toMatchObject({ authentication: 'anonymous', cacheScope: 'public', oauthScopes: [] });
		expect(CONTROL_PLANE_OPERATIONS.teams.remove.descriptor).toMatchObject({ riskClass: 'irreversible', concurrency: { required: true } });
		expect(CONTROL_PLANE_OPERATIONS.governance.resolveProposalFeedback.descriptor).toMatchObject({
			operationId: 'governance.proposals.feedback.resolve', concurrency: { required: true }, surfaces: ['rest', 'cli'],
		});
		expect(CONTROL_PLANE_OPERATIONS.research.completeStage.descriptor.oauthScopes).toEqual(['treeseed:knowledge:write']);
		expect(CONTROL_PLANE_OPERATIONS.communications.cancelInvocation.descriptor).toMatchObject({ riskClass: 'destructive', confirmation: 'input_required' });
		expect(CONTROL_PLANE_OPERATIONS.communications.send.descriptor).toMatchObject({ authentication: 'oauth', surfaces: ['rest', 'cli', 'mcp_tool'] });
		expect(CONTROL_PLANE_OPERATIONS.providers.discussionResponse.descriptor).toMatchObject({ authentication: 'provider', surfaces: ['rest'] });
		expect(CONTROL_PLANE_OPERATIONS.providers.registrationCode.rotate.descriptor).toMatchObject({ riskClass: 'credential', redactedPaths: ['output.registrationCode'], concurrency: { required: true } });
		expect(CONTROL_PLANE_OPERATIONS.providers.environmentProfiles.publish.descriptor).toMatchObject({ authentication: 'provider', oauthScopes: [] });
		expect(CONTROL_PLANE_OPERATIONS.providers.environmentGrants.put.descriptor).toMatchObject({ authentication: 'oauth', riskClass: 'authority', concurrency: { required: true } });
	});

	it('coerces the projects list HTTP limit query parameter', () => {
		expect(CONTROL_PLANE_OPERATIONS.projects.list.schema.query.parse({ limit: '200' })).toEqual({ limit: 200 });
	});

	it('binds an optional proposal subject into communication sends', () => {
		expect(CONTROL_PLANE_OPERATIONS.communications.send.schema.body.parse({
			message: '@sdk/architect Review this proposal.', proposalId: 'proposal-one',
		})).toEqual({ message: '@sdk/architect Review this proposal.', proposalId: 'proposal-one' });
		const send = TREESEED_COMMAND_TREE_V1.commands.find((node) => node.nodeType === 'leaf' && node.segment === 'send');
		expect(send).toMatchObject({ options: expect.arrayContaining([expect.objectContaining({ name: '--proposal' })]),
			execution: { input: expect.arrayContaining([expect.objectContaining({ target: 'body', field: 'proposalId', name: 'proposal' })]) } });
	});

	it('exposes governed proposal retirement without a parallel cleanup surface', () => {
		const proposals = TREESEED_COMMAND_TREE_V1.commands.find((node) => node.nodeType === 'branch' && node.segment === 'proposals');
		const leaves = proposals?.nodeType === 'branch' ? proposals.children.filter((node) => node.nodeType === 'leaf').map((node) => node.segment) : [];
		expect(leaves).toEqual(expect.arrayContaining(['withdraw', 'supersede']));
		expect(CONTROL_PLANE_OPERATIONS.governance.withdraw.descriptor).toMatchObject({ concurrency: { required: true }, surfaces: ['rest', 'cli'] });
		expect(CONTROL_PLANE_OPERATIONS.governance.supersede.descriptor).toMatchObject({ concurrency: { required: true }, surfaces: ['rest', 'cli'] });
	});

	it('derives the complete stable MCP catalog from resource-declared operations', () => {
		const resources = buildMcpResources(CONTROL_PLANE_CATALOG.operations);
		expect(resources).toHaveLength(65);
		expect(new Set(resources.map(({ uriTemplate }) => uriTemplate)).size).toBe(resources.length);
		expect(resources).toEqual(expect.arrayContaining([
			expect.objectContaining({ operationId: 'status.show', uriTemplate: 'treeseed://status' }),
			expect.objectContaining({ operationId: 'accounts.current.show', uriTemplate: 'treeseed://accounts/current' }),
			expect.objectContaining({ operationId: 'accounts.profile.public.show', uriTemplate: 'treeseed://users/by-username/{username}/profile' }),
			expect.objectContaining({ operationId: 'projects.show', uriTemplate: 'treeseed://projects/{projectId}' }),
			expect.objectContaining({ operationId: 'operations.show', uriTemplate: 'treeseed://operations/{operationId}' }),
			expect.objectContaining({ operationId: 'treedx.service.contract', uriTemplate: 'treeseed://dx/projects/{projectId}/service-contract' }),
		]));
		const catalog = buildMcpCatalog(CONTROL_PLANE_CATALOG.operations);
		expect(catalog.tools).toHaveLength(139);
		expect(catalog.tools.filter(tool => tool.operationId === 'assignments.recover')).toHaveLength(1);
		expect(catalog.resources).toEqual(resources);
		expect(catalog.prompts.map(({ name }) => name)).toEqual(['operate', 'research', 'governance-review', 'workday-planning', 'project-agent-chat']);
	});

	it('rejects mixed authentication authority metadata', () => {
		const providerWithOAuth = operation({ authentication: 'provider', capability: 'providers.execute' });
		const codes = validateControlPlaneCatalog(catalog(providerWithOAuth)).map((entry) => entry.code);
		expect(codes).toContain('oauth_scope_forbidden');
	});

	it('rejects duplicate routes and parallel unsafe mutation metadata', () => {
		const unsafe = operation({
			operationId: 'projects.archive',
			kind: 'mutation',
			riskClass: 'destructive',
			confirmation: 'never',
			receipt: false,
			audited: false,
		});
		const codes = validateControlPlaneCatalog(catalog(operation(), unsafe)).map((entry) => entry.code);
		expect(codes).toContain('rest_binding_duplicate');
		expect(codes).toContain('confirmation_policy_invalid');
		expect(codes).toContain('mutation_audit_required');
		expect(codes).toContain('mutation_receipt_required');
	});

	it('requires a schema for REST path parameters', () => {
		const diagnostics = validateControlPlaneCatalog(catalog(operation({ rest: { method: 'GET', path: '/v1/projects/{projectId}' } })));
		expect(diagnostics.map((entry) => entry.code)).toContain('parameter_schema_required');
	});
});
