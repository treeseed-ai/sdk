import { z } from 'zod';
import { defineOperation } from '../operation-builder.ts';
import type { ControlPlaneOperationBinding, ControlPlaneOperationDescriptor } from '../control-plane-operation.ts';
import { TREEAI_UPSTREAM_OPERATIONS, type TreeAiUpstreamOperation } from '../../treeai/generated/upstream.ts';

export const TREEAI_OPENAPI_DIGESTS = {
	inference: 'sha256:29255fae4e74aa0fb96d8abd1cdc5d869f469fc9bb55a68060eeae6d86f4273d',
	training: 'sha256:de80f39ca9d0d5a2a7ca6ce588326d3a562c771bc7e077b7e6c4949134ef2143',
	lab: 'sha256:8f9a3ca31a63143506e1b28ddb78eda50b2f6760278531b723047d968f56aa07',
} as const;

function treeSeedOperationId(operation: TreeAiUpstreamOperation) {
	return `treeai.${operation.operationId.toLowerCase().replace(/[^a-z0-9]+/gu, '.').replace(/^\.|\.$/gu, '')}` as `${string}.${string}`;
}

function risk(operation: TreeAiUpstreamOperation): ControlPlaneOperationDescriptor['riskClass'] {
	if (/rollback|cancel|disable/u.test(operation.operationId)) return 'destructive';
	if (operation.kind === 'mutation' && (/promot|enable|activate|campaigns/u.test(operation.operationId) || /(?:^|\.)mode(?:\.|$)/u.test(operation.operationId))) return 'authority';
	return 'ordinary';
}

function pathShape(path: string) {
	return Object.fromEntries([...path.matchAll(/\{([^}]+)\}/gu)].map((match) => [match[1]!, z.string().min(1)]));
}

function binding(operation: TreeAiUpstreamOperation) {
	const method = operation.method as 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT';
	const kind = operation.kind as 'read' | 'mutation';
	const riskClass = risk(operation);
	const path = `/v1/ai/nodes/{nodeId}/${operation.service}${operation.path}` as `/v1/${string}`;
	return defineOperation({
		operationId: treeSeedOperationId(operation), description: `${operation.summary} through a node-scoped TreeAI proxy.`,
		rest: { method, path }, parameters: `treeseed.${treeSeedOperationId(operation)}.parameters/v1`,
		capability: `treeai.${operation.service}.${kind}`, authentication: 'oauth_or_provider',
		oauthScopes: kind === 'read' ? ['treeseed:read'] : ['treeseed:execution'], kind, riskClass,
		confirmation: riskClass === 'ordinary' ? 'never' : 'input_required', idempotencyRequired: kind === 'mutation',
		surfaces: ['rest', 'cli'], cacheScope: kind === 'read' ? 'principal' : 'none', pagination: 'none',
		redactedPaths: ['headers.authorization'],
		upstream: { service: 'treeai', operationId: operation.operationId, contractVersion: '3.1.1', contractDigest: TREEAI_OPENAPI_DIGESTS[operation.service] },
	}, {
		path: z.object({ nodeId: z.string().min(1), ...pathShape(operation.path) }).strict(),
		query: kind === 'read' ? z.record(z.unknown()) : z.object({}).strict(),
		body: kind === 'read' ? z.undefined() : z.record(z.unknown()), output: z.record(z.unknown()),
	});
}

export const TREEAI_CONTROL_PLANE_OPERATION_LIST = Object.freeze(TREEAI_UPSTREAM_OPERATIONS.map(binding));
export const TREEAI_CONTROL_PLANE_OPERATIONS = Object.freeze(Object.fromEntries(TREEAI_CONTROL_PLANE_OPERATION_LIST.map((item) => [item.descriptor.operationId, item])) as Record<string, ControlPlaneOperationBinding<any, any, any, any>>);

export function treeAiControlPlaneOperation(upstreamOperationId: string) {
	const operation = TREEAI_CONTROL_PLANE_OPERATION_LIST.find((item) => item.descriptor.upstream?.operationId === upstreamOperationId);
	if (!operation) throw new Error(`Unknown TreeAI operation ${upstreamOperationId}.`);
	return operation;
}
