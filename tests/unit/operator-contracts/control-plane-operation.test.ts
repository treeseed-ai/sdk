import { describe, expect, it } from 'vitest';
import {
	CONTROL_PLANE_OPERATION_SCHEMA_VERSION,
	CONTROL_PLANE_CATALOG,
	CONTROL_PLANE_OPERATION_LIST,
	CONTROL_PLANE_OPERATIONS,
	buildMcpTools,
	validateControlPlaneCatalog,
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
		expect(CONTROL_PLANE_OPERATION_LIST).toHaveLength(230);
		expect(new Set(CONTROL_PLANE_OPERATION_LIST.map((entry) => entry.descriptor.operationId)).size).toBe(CONTROL_PLANE_OPERATION_LIST.length);
		const paths = CONTROL_PLANE_OPERATION_LIST.flatMap((entry) => entry.descriptor.rest?.path ?? []);
		expect(paths.some((path) => path.startsWith('/v1/operator/commands'))).toBe(false);
		expect(paths.some((path) => path.startsWith('/v1/ui/'))).toBe(false);
		expect(paths.some((path) => path.startsWith('/v1/jobs'))).toBe(false);
		expect(CONTROL_PLANE_OPERATIONS.health.ready.descriptor.oauthScopes).toEqual([]);
		expect(CONTROL_PLANE_OPERATIONS.health.deep.descriptor.oauthScopes).toEqual([]);
		expect(CONTROL_PLANE_OPERATIONS.providers.register.descriptor).toMatchObject({ authentication: 'provider', oauthScopes: [] });
		expect(CONTROL_PLANE_OPERATIONS.providers.assignment.descriptor).toMatchObject({ authentication: 'provider', oauthScopes: [] });
		expect(CONTROL_PLANE_OPERATIONS.feedback.create.descriptor).toMatchObject({ authentication: 'oauth', oauthScopes: [] });
		expect(CONTROL_PLANE_OPERATIONS.treedx.createWorkspace.descriptor).toMatchObject({ authentication: 'oauth_or_provider', oauthScopes: ['treeseed:projects:write'] });
		expect(CONTROL_PLANE_OPERATIONS.services.putAuthority.descriptor.redactedPaths).toContain('body');
		expect(CONTROL_PLANE_OPERATIONS.services.disconnect.descriptor.confirmation).toBe('input_required');
		expect(CONTROL_PLANE_OPERATIONS.planning.acceptExecutionInput.descriptor.rest?.path).toBe('/v1/decision-execution-inputs/{inputId}/accept');
		expect(CONTROL_PLANE_OPERATIONS.estimates.list.descriptor.pagination).toBe('cursor');
		expect(CONTROL_PLANE_OPERATIONS.assignmentGraphs.compile.descriptor.oauthScopes).toEqual(['treeseed:execution']);
		expect(CONTROL_PLANE_OPERATIONS.research.completeStage.descriptor.oauthScopes).toEqual(['treeseed:knowledge:write']);
		expect(CONTROL_PLANE_OPERATIONS.communications.cancelInvocation.descriptor).toMatchObject({ riskClass: 'destructive', confirmation: 'input_required' });
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
