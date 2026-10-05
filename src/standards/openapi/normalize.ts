import { canonicalizeStandardsValue, type CanonicalJsonValue } from '../canonicalize.ts';
import { StandardsError } from '../errors.ts';
import type { OpenApiContractModel, OpenApiOperationModel } from './contracts.ts';

const httpMethods = new Set(['delete', 'get', 'head', 'options', 'patch', 'post', 'put', 'trace']);
const unorderedArrays = new Set(['enum', 'required', 'tags']);

function record(value: unknown, path: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new StandardsError('standards_invalid_contract', 'Expected an OpenAPI object.', path);
	}
	return value as Record<string, unknown>;
}

function pointer(document: Record<string, unknown>, reference: string) {
	if (!reference.startsWith('#/')) throw new StandardsError('standards_invalid_contract', 'External OpenAPI references are not supported.', '$ref');
	return reference.slice(2).split('/').map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
		.reduce<unknown>((current, part) => record(current, reference)[part], document);
}

function normalizeValue(value: unknown, document: Record<string, unknown>, references: Set<string>, key = ''): CanonicalJsonValue {
	if (Array.isArray(value)) {
		const entries = value.map((entry) => normalizeValue(entry, document, references));
		return unorderedArrays.has(key) ? entries.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))) : entries;
	}
	if (!value || typeof value !== 'object') return canonicalizeStandardsValue(value);
	const input = value as Record<string, unknown>;
	if (typeof input.$ref === 'string') {
		if (references.has(input.$ref)) return { $ref: input.$ref };
		const nextReferences = new Set(references).add(input.$ref);
		return normalizeValue(pointer(document, input.$ref), document, nextReferences);
	}
	return Object.fromEntries(Object.keys(input).filter((entry) => !['description', 'externalDocs', 'summary'].includes(entry)).sort()
		.map((entry) => [entry, normalizeValue(input[entry], document, references, entry)]));
}

function operation(value: unknown, document: Record<string, unknown>): OpenApiOperationModel {
	const input = record(value, 'operation');
	const responses = record(input.responses ?? {}, 'operation.responses');
	return {
		operationId: typeof input.operationId === 'string' ? input.operationId : null,
		security: normalizeValue(input.security ?? document.security ?? [], document, new Set(), 'security'),
		parameters: (Array.isArray(input.parameters) ? input.parameters : []).map((entry) => normalizeValue(entry, document, new Set()))
			.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
		requestBody: input.requestBody ? normalizeValue(input.requestBody, document, new Set()) : null,
		responses: Object.fromEntries(Object.keys(responses).sort().map((status) => [status, normalizeValue(responses[status], document, new Set())])),
	};
}

export function normalizeOpenApi(documentValue: unknown): OpenApiContractModel {
	const document = record(documentValue, '$');
	if (typeof document.openapi !== 'string' || !/^3\./u.test(document.openapi)) {
		throw new StandardsError('standards_invalid_contract', 'OpenAPI version 3 is required.', 'openapi');
	}
	const paths = record(document.paths ?? {}, 'paths');
	const operations: Record<string, OpenApiOperationModel> = {};
	for (const path of Object.keys(paths).sort()) {
		const pathItem = record(paths[path], `paths.${path}`);
		for (const method of Object.keys(pathItem).filter((entry) => httpMethods.has(entry.toLowerCase())).sort()) {
			operations[`${method.toUpperCase()} ${path}`] = operation(pathItem[method], document);
		}
	}
	return { schemaVersion: 1, openapi: document.openapi, operations };
}
