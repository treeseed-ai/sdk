import type { z } from 'zod';

export const CONTROL_PLANE_OPERATION_SCHEMA_VERSION = 'treeseed.control-plane-operation/v1' as const;

export type ControlPlaneHttpMethod = 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT';
export type ControlPlaneOperationKind = 'read' | 'mutation';
export type ControlPlaneRiskClass =
	| 'ordinary'
	| 'destructive'
	| 'credential'
	| 'authority'
	| 'production'
	| 'irreversible';
export type ControlPlaneConfirmationPolicy = 'never' | 'input_required';
export type ControlPlaneOperationSurface = 'rest' | 'cli' | 'mcp_tool' | 'mcp_resource' | 'internal';
export type ControlPlaneCacheScope = 'none' | 'principal' | 'team' | 'project' | 'public';
export type ControlPlanePaginationKind = 'none' | 'cursor';
export type ControlPlaneAuthenticationKind = 'anonymous' | 'oauth' | 'provider' | 'signed_request';

export interface ControlPlaneRestBinding {
	method: ControlPlaneHttpMethod;
	path: `/v1/${string}`;
}

export interface ControlPlaneSchemaBinding {
	input: string;
	output: string;
	parameters?: string;
	errors: string;
}

export interface ControlPlaneIdempotencyContract {
	required: boolean;
	header: 'Idempotency-Key';
}

export interface ControlPlaneConcurrencyContract {
	required: boolean;
	readHeader: 'ETag';
	writeHeader: 'If-Match';
}

export interface ControlPlaneOperationDescriptor {
	schemaVersion: typeof CONTROL_PLANE_OPERATION_SCHEMA_VERSION;
	operationId: `${string}.${string}`;
	description: string;
	rest?: ControlPlaneRestBinding;
	schemas: ControlPlaneSchemaBinding;
	capability: string;
	authentication: ControlPlaneAuthenticationKind;
	oauthScopes: OAuthScope[];
	kind: ControlPlaneOperationKind;
	riskClass: ControlPlaneRiskClass;
	confirmation: ControlPlaneConfirmationPolicy;
	idempotency: ControlPlaneIdempotencyContract;
	concurrency: ControlPlaneConcurrencyContract;
	surfaces: ControlPlaneOperationSurface[];
	cacheScope: ControlPlaneCacheScope;
	pagination: ControlPlanePaginationKind;
	audited: boolean;
	receipt: boolean;
	redactedPaths: string[];
}

export interface ControlPlaneOperationInput<TPath = Record<string, never>, TQuery = Record<string, never>, TBody = undefined> {
	path: TPath;
	query: TQuery;
	body: TBody;
}

export interface ControlPlaneOperationSchemas<TPath, TQuery, TBody, TOutput> {
	path: z.ZodType<TPath>;
	query: z.ZodType<TQuery>;
	body: z.ZodType<TBody>;
	output: z.ZodType<TOutput>;
}

export interface ControlPlaneOperationBinding<TPath = Record<string, never>, TQuery = Record<string, never>, TBody = undefined, TOutput = unknown> {
	descriptor: ControlPlaneOperationDescriptor;
	schema: ControlPlaneOperationSchemas<TPath, TQuery, TBody, TOutput>;
}

export type ControlPlaneOperationPath<T> = T extends ControlPlaneOperationBinding<infer TPath, any, any, any> ? TPath : never;
export type ControlPlaneOperationQuery<T> = T extends ControlPlaneOperationBinding<any, infer TQuery, any, any> ? TQuery : never;
export type ControlPlaneOperationBody<T> = T extends ControlPlaneOperationBinding<any, any, infer TBody, any> ? TBody : never;
export type ControlPlaneOperationOutput<T> = T extends ControlPlaneOperationBinding<any, any, any, infer TOutput> ? TOutput : never;

export const TREESEED_OAUTH_SCOPES = [
	'treeseed:read',
	'treeseed:knowledge:write',
	'treeseed:governance:write',
	'treeseed:projects:write',
	'treeseed:execution',
	'treeseed:admin',
] as const;

export type OAuthScope = typeof TREESEED_OAUTH_SCOPES[number];

export interface ControlPlaneCatalog {
	schemaVersion: 'treeseed.control-plane-catalog/v1';
	operations: ControlPlaneOperationDescriptor[];
}

export interface ControlPlaneCatalogDiagnostic {
	code: string;
	path: string;
	message: string;
}

const OPERATION_ID = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/u;
const PATH_PARAMETER = /\{([A-Za-z][A-Za-z0-9]*)\}/gu;

function duplicates(values: readonly string[]) {
	const seen = new Set<string>();
	return values.filter((value) => seen.size === seen.add(value).size);
}

export function validateControlPlaneCatalog(catalog: ControlPlaneCatalog): ControlPlaneCatalogDiagnostic[] {
	const diagnostics: ControlPlaneCatalogDiagnostic[] = [];
	const operationIds = new Set<string>();
	const restBindings = new Set<string>();

	for (const [index, operation] of catalog.operations.entries()) {
		const path = `operations.${index}`;
		if (operation.schemaVersion !== CONTROL_PLANE_OPERATION_SCHEMA_VERSION) {
			diagnostics.push({ code: 'operation_schema_version_invalid', path: `${path}.schemaVersion`, message: 'Operation schemaVersion is not supported.' });
		}
		if (!OPERATION_ID.test(operation.operationId)) {
			diagnostics.push({ code: 'operation_id_invalid', path: `${path}.operationId`, message: 'Operation IDs must be stable dotted lowercase words.' });
		}
		if (operationIds.has(operation.operationId)) {
			diagnostics.push({ code: 'operation_id_duplicate', path: `${path}.operationId`, message: `Duplicate operation ID ${operation.operationId}.` });
		}
		operationIds.add(operation.operationId);

		if (operation.surfaces.includes('rest') !== Boolean(operation.rest)) {
			diagnostics.push({ code: 'rest_binding_mismatch', path: `${path}.rest`, message: 'REST surface and REST binding must be declared together.' });
		}
		if (operation.rest) {
			const binding = `${operation.rest.method} ${operation.rest.path}`;
			if (restBindings.has(binding)) diagnostics.push({ code: 'rest_binding_duplicate', path: `${path}.rest`, message: `Duplicate REST binding ${binding}.` });
			restBindings.add(binding);
			const parameters = [...operation.rest.path.matchAll(PATH_PARAMETER)].map((match) => match[1]!);
			if (parameters.length > 0 && !operation.schemas.parameters) {
				diagnostics.push({ code: 'parameter_schema_required', path: `${path}.schemas.parameters`, message: 'Parameterized REST paths require a parameter schema.' });
			}
		}

		for (const scope of operation.oauthScopes) {
			if (!TREESEED_OAUTH_SCOPES.includes(scope)) diagnostics.push({ code: 'oauth_scope_invalid', path: `${path}.oauthScopes`, message: `Unknown OAuth scope ${scope}.` });
		}
		if (operation.authentication === 'oauth' && operation.oauthScopes.length === 0) {
			diagnostics.push({ code: 'oauth_scope_required', path: `${path}.oauthScopes`, message: 'OAuth-authenticated operations require at least one OAuth scope.' });
		}
		if (operation.authentication !== 'oauth' && operation.oauthScopes.length > 0) {
			diagnostics.push({ code: 'oauth_scope_forbidden', path: `${path}.oauthScopes`, message: 'Only OAuth-authenticated operations may declare OAuth scopes.' });
		}
		if (operation.authentication === 'provider' && operation.capability !== 'providers.execute') {
			diagnostics.push({ code: 'provider_auth_capability_invalid', path: `${path}.capability`, message: 'Provider-authenticated operations require providers.execute.' });
		}
		for (const duplicate of duplicates(operation.surfaces)) diagnostics.push({ code: 'surface_duplicate', path: `${path}.surfaces`, message: `Duplicate operation surface ${duplicate}.` });
		for (const duplicate of duplicates(operation.oauthScopes)) diagnostics.push({ code: 'oauth_scope_duplicate', path: `${path}.oauthScopes`, message: `Duplicate OAuth scope ${duplicate}.` });

		const elevatedRisk = operation.riskClass !== 'ordinary';
		if (elevatedRisk !== (operation.confirmation === 'input_required')) {
			diagnostics.push({ code: 'confirmation_policy_invalid', path: `${path}.confirmation`, message: 'Elevated-risk operations require input_required; ordinary operations must not.' });
		}
		if (operation.kind === 'read' && (operation.idempotency.required || operation.concurrency.required || operation.receipt)) {
			diagnostics.push({ code: 'read_mutation_contract_invalid', path, message: 'Read operations cannot require mutation idempotency, write concurrency, or mutation receipts.' });
		}
		if (operation.kind === 'mutation' && operation.surfaces.some((surface) => surface !== 'internal') && !operation.audited) {
			diagnostics.push({ code: 'mutation_audit_required', path: `${path}.audited`, message: 'Every externally reachable mutation must be audited.' });
		}
		if (operation.kind === 'mutation' && !operation.receipt) {
			diagnostics.push({ code: 'mutation_receipt_required', path: `${path}.receipt`, message: 'Mutations must return durable receipts.' });
		}
	}

	return diagnostics.sort((left, right) => `${left.path}:${left.code}`.localeCompare(`${right.path}:${right.code}`));
}

export function indexControlPlaneCatalog(catalog: ControlPlaneCatalog) {
	const diagnostics = validateControlPlaneCatalog(catalog);
	if (diagnostics.length > 0) throw new Error(`Invalid control-plane catalog: ${diagnostics.map((entry) => entry.code).join(', ')}`);
	return new Map(catalog.operations.map((operation) => [operation.operationId, operation]));
}
