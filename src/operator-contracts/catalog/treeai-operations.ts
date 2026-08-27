import { z } from 'zod';
import { defineOperation } from '../operation-builder.ts';
import type { ControlPlaneOperationBinding, ControlPlaneOperationDescriptor } from '../control-plane-operation.ts';
import { TREEAI_UPSTREAM_OPERATIONS, type TreeAiUpstreamOperation } from '../../treeai/generated/upstream.ts';

export const TREEAI_OPENAPI_DIGESTS = {
	inference: 'sha256:3a00f1d91635d87d0aad2c6d329f495ff210f393bc9851570aa3e3ad1f5c1db4',
	training: 'sha256:89dc70cecc85079853e4f177827d681e66f4b24b93ef17713051b99f07c2fe00',
	lab: 'sha256:bccafa27b00a63b9fb22b132b850f9af6e77d44047dbc8966344088266d65898',
	qualification: 'sha256:3f68b78845ec19c5de389663f1cb677ab4df0683ecd113c4f5780885a89370b7',
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
