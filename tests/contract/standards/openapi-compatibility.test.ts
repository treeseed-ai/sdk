import { describe, expect, it } from 'vitest';
import { compareOpenApi, normalizeOpenApi } from '../../../src/standards/openapi/index.ts';

function document(schema: Record<string, unknown> = { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }) {
	return {
		openapi: '3.1.0', info: { title: 'Example', version: '1.0.0' },
		paths: {
			'/items': { get: {
				operationId: 'listItems', security: [{ bearer: [] }],
				responses: { '200': { description: 'ok', content: { 'application/json': { schema } } } },
			} },
		},
	};
}

describe('OpenAPI compatibility', () => {
	it('normalizes representation-only object and set ordering', () => {
		const first = document({ type: 'string', enum: ['b', 'a'] });
		const second = { ...document({ enum: ['a', 'b'], type: 'string' }), info: { version: '1.0.0', title: 'Example' } };
		expect(compareOpenApi(normalizeOpenApi(first), normalizeOpenApi(second)))
			.toEqual({ classification: 'unchanged', findings: [] });
	});

	it('classifies an additive operation and optional property as compatible additions', () => {
		const baseline = document();
		const candidate = document({ type: 'object', properties: { id: { type: 'string' }, label: { type: 'string' } }, required: ['id'] });
		(candidate.paths as Record<string, unknown>)['/health'] = { get: { responses: { '200': { description: 'ok' } } } };
		const comparison = compareOpenApi(normalizeOpenApi(baseline), normalizeOpenApi(candidate));
		expect(comparison.classification).toBe('compatible_addition');
		expect(comparison.findings.map((entry) => entry.code)).toEqual(['openapi_operation_added', 'openapi_property_added']);
	});

	it('classifies removed operations, required properties, auth, and status changes as breaking', () => {
		const baseline = document();
		const required = document({ type: 'object', properties: { id: { type: 'string' }, tenant: { type: 'string' } }, required: ['id', 'tenant'] });
		const requiredOperation = (required.paths['/items'] as { get: Record<string, unknown> }).get;
		requiredOperation.security = [];
		requiredOperation.responses = { '201': { description: 'changed' } };
		expect(compareOpenApi(normalizeOpenApi(baseline), normalizeOpenApi(required)).classification).toBe('breaking');
		expect(compareOpenApi(normalizeOpenApi(baseline), normalizeOpenApi({ ...baseline, paths: {} })).findings[0]?.code)
			.toBe('openapi_operation_removed');
	});

	it('rejects external references and resolves local references deterministically', () => {
		const local = document({ $ref: '#/components/schemas/Item' });
		(local as Record<string, unknown>).components = { schemas: { Item: { type: 'object', properties: { id: { type: 'string' } } } } };
		expect(normalizeOpenApi(local).operations['GET /items']).toBeDefined();
		expect(() => normalizeOpenApi(document({ $ref: 'https://example.com/schema.json' }))).toThrow(/External OpenAPI references/u);
	});

	it('classifies narrowed accepted input and widened possible output enums as breaking', () => {
		const baseline = document({ type: 'string', enum: ['a', 'b'] });
		const widenedOutput = document({ type: 'string', enum: ['a', 'b', 'c'] });
		expect(compareOpenApi(normalizeOpenApi(baseline), normalizeOpenApi(widenedOutput)).classification).toBe('breaking');
	});

	it('treats a required output becoming optional as breaking and the reverse as additive', () => {
		const required = document({ type: 'object', properties: { id: { type: 'string' } }, required: ['id'] });
		const optional = document({ type: 'object', properties: { id: { type: 'string' } } });
		expect(compareOpenApi(normalizeOpenApi(required), normalizeOpenApi(optional)).findings).toEqual(expect.arrayContaining([
			expect.objectContaining({ code: 'openapi_required_output_removed', classification: 'breaking' }),
		]));
		expect(compareOpenApi(normalizeOpenApi(optional), normalizeOpenApi(required)).findings).toEqual(expect.arrayContaining([
			expect.objectContaining({ code: 'openapi_required_output_added', classification: 'compatible_addition' }),
		]));
	});

	it('fails closed when a primitive schema type or constraint changes', () => {
		const baseline = document({ type: 'string', minLength: 1 });
		const candidate = document({ type: 'number', minimum: 0 });
		expect(compareOpenApi(normalizeOpenApi(baseline), normalizeOpenApi(candidate)).findings).toEqual(expect.arrayContaining([
			expect.objectContaining({ code: 'openapi_schema_constraint_changed', classification: 'breaking' }),
		]));
	});
});
