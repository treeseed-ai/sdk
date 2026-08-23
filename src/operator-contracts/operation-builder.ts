import { z } from 'zod';
import { TREEDX_OPENAPI_CONTRACT } from '@treeseed/treedx/openapi';
import {
	CONTROL_PLANE_OPERATION_SCHEMA_VERSION,
	type ControlPlaneOperationBinding,
	type ControlPlaneOperationDescriptor,
} from './control-plane-operation.ts';

type Definition = Omit<ControlPlaneOperationDescriptor, 'schemaVersion' | 'schemas' | 'idempotency' | 'concurrency' | 'audited' | 'receipt' | 'redactedPaths' | 'authentication'> & {
	parameters?: string;
	redactedPaths?: string[];
	idempotencyRequired?: boolean;
	concurrencyRequired?: boolean;
	authentication?: ControlPlaneOperationDescriptor['authentication'];
};

export function defineOperation<TPath, TQuery, TBody, TOutput>(
	definition: Definition,
	schema: ControlPlaneOperationBinding<TPath, TQuery, TBody, TOutput>['schema'],
): ControlPlaneOperationBinding<TPath, TQuery, TBody, TOutput> {
	const { parameters, redactedPaths = [], idempotencyRequired, concurrencyRequired, ...descriptor } = definition;
	const mutation = definition.kind === 'mutation';
	return {
		descriptor: {
			...descriptor,
			authentication: definition.authentication ?? (definition.oauthScopes.length ? 'oauth' : 'anonymous'),
			schemaVersion: CONTROL_PLANE_OPERATION_SCHEMA_VERSION,
			schemas: {
				input: `treeseed.${definition.operationId}.input/v1`,
				output: `treeseed.${definition.operationId}.output/v1`,
				errors: 'treeseed.problem/v1',
				...(parameters ? { parameters } : {}),
			},
			idempotency: { required: idempotencyRequired ?? mutation, header: 'Idempotency-Key' },
			concurrency: { required: concurrencyRequired ?? false, readHeader: 'ETag', writeHeader: 'If-Match' },
			audited: definition.surfaces.some((surface) => surface !== 'internal'),
			receipt: mutation,
			redactedPaths,
		},
		schema,
	};
}

const empty = z.object({}).strict();
const none = z.undefined();
const record = z.record(z.unknown());

export function defineTreeDxProxyOperation<T extends z.ZodRawShape>(
	operationId: `${string}.${string}`,
	upstreamOperationId: string | null,
	method: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT',
	path: `/v1/${string}`,
	pathShape: T,
	options: {
		read?: boolean;
		risk?: ControlPlaneOperationDescriptor['riskClass'];
		surfaces?: ControlPlaneOperationDescriptor['surfaces'];
		pagination?: ControlPlaneOperationDescriptor['pagination'];
	} = {},
) {
	const kind = (options.read ?? method === 'GET') ? 'read' : 'mutation';
	const riskClass = options.risk ?? 'ordinary';
	const surfaces = options.surfaces ?? ['rest', 'mcp_tool', ...(method === 'GET' ? ['mcp_resource' as const] : [])];
	return defineOperation({
		operationId,
		description: `${kind === 'read' ? 'Read' : 'Apply'} ${operationId} through the project-scoped TreeDX proxy.`,
		...(surfaces.includes('rest') ? { rest: { method, path } } : {}),
		...(Object.keys(pathShape).length ? { parameters: `treeseed.${operationId}.parameters/v1` } : {}),
		capability: kind === 'read' ? 'treedx.read' : 'treedx.write',
		authentication: 'oauth_or_provider',
		oauthScopes: kind === 'read' ? ['treeseed:read'] : ['treeseed:projects:write'],
		kind,
		riskClass,
		confirmation: riskClass === 'ordinary' ? 'never' : 'input_required',
		surfaces,
		cacheScope: kind === 'read' ? 'project' : 'none',
		pagination: options.pagination ?? 'none',
		...(upstreamOperationId ? { upstream: { service: 'treedx' as const, operationId: upstreamOperationId, contractVersion: TREEDX_OPENAPI_CONTRACT.openapiVersion, contractDigest: TREEDX_OPENAPI_CONTRACT.openapiSha256 } } : {}),
	}, {
		path: z.object(pathShape).strict(),
		query: method === 'GET' ? record : empty,
		body: method === 'GET' ? none : record,
		output: record,
	});
}
