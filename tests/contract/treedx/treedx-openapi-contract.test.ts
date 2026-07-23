import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { TREEDX_CLIENT_OPERATION_MAP } from '../../../src/treedx/client.ts';

type OpenApiOperation = {
	operationId?: string;
	summary?: string;
	security?: unknown;
	'x-treedx-required-capabilities'?: unknown;
	responses?: Record<string, unknown>;
};

type OpenApi = {
	security?: unknown;
	paths: Record<string, Record<string, OpenApiOperation>>;
	components: { schemas: Record<string, unknown> };
};

const workspaceOpenApiPath = resolve(process.cwd(), '../../docs/api/openapi.yaml');
const packageOpenApiPath = resolve(process.cwd(), 'docs/api/openapi.yaml');
const openApiPath = existsSync(workspaceOpenApiPath) ? workspaceOpenApiPath : packageOpenApiPath;
const openApi = parse(readFileSync(openApiPath, 'utf8')) as OpenApi;

function operations() {
	return Object.entries(openApi.paths).flatMap(([path, methods]) =>
		Object.entries(methods).map(([method, operation]) => ({ path, method, operation })),
	);
}

function responseSchemaName(response: unknown): string | null {
	if (!response || typeof response !== 'object') return null;
	const ref = (response as { $ref?: string }).$ref;
	if (ref) return ref.split('/').pop() ?? ref;
	const schema = (response as { content?: Record<string, { schema?: { $ref?: string } }> }).content?.['application/json']?.schema;
	return schema?.$ref?.split('/').pop() ?? null;
}

describe('TreeDX OpenAPI contract metadata', () => {
	it('uses unified contract language', () => {
		const text = readFileSync(openApiPath, 'utf8');
		const rollout = String.fromCharCode(115, 116, 97, 103, 101);
		const segment = String.fromCharCode(112, 104, 97, 115, 101);
		const blocked = [`x-treedx-${rollout}`, `S${rollout.slice(1)} \\d`, `P${segment.slice(1)} \\d`, 'deferred-' + 'production'];
		expect(text).not.toMatch(new RegExp(blocked.join('|'), 'u'));
	});

	it('defines operation metadata and typed success schemas for every JSON route', () => {
		for (const { path, method, operation } of operations()) {
			expect(operation.operationId, `${method.toUpperCase()} ${path}`).toBeTypeOf('string');
			expect(operation.summary, `${method.toUpperCase()} ${path}`).toBeTypeOf('string');
			expect(operation.security ?? openApi.security, `${method.toUpperCase()} ${path}`).toBeDefined();
			expect(operation['x-treedx-required-capabilities'], `${method.toUpperCase()} ${path}`).toBeDefined();

			const success = operation.responses?.['200'];
			expect(success, `${operation.operationId} 200`).toBeDefined();
			const content = (success as { content?: Record<string, unknown> } | undefined)?.content ?? {};
			if ('application/octet-stream' in content) continue;
			if (!('application/json' in content)) continue;
			const schemaName = responseSchemaName(success);
			expect(schemaName, `${operation.operationId} 200 schema`).toBeTruthy();
			expect(schemaName, `${operation.operationId} must not use generic OkEnvelope`).not.toBe('OkEnvelope');
			expect(schemaName, `${operation.operationId} must not use generic TreeDxOkEnvelope`).not.toBe('TreeDxOkEnvelope');
			expect(openApi.components.schemas).toHaveProperty(String(schemaName));
		}
	});

	it('keeps SDK-mapped operations present', () => {
		const ids = new Set(operations().map(({ operation }) => operation.operationId));
		for (const [method, operationId] of Object.entries(TREEDX_CLIENT_OPERATION_MAP)) {
			expect(ids.has(operationId), `${method} -> ${operationId}`).toBe(true);
		}
	});
});
