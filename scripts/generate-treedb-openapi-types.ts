import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';

type Schema = Record<string, unknown>;
type OpenApi = {
	paths?: Record<string, Record<string, Operation>>;
	components?: { schemas?: Record<string, Schema>; responses?: Record<string, unknown> };
};
type Operation = {
	operationId?: string;
	parameters?: unknown[];
	requestBody?: unknown;
	responses?: Record<string, unknown>;
};

const check = process.argv.includes('--check');
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = resolve(packageRoot, '../..');
const workspaceOpenApiPath = resolve(workspaceRoot, 'docs/api/openapi.yaml');
const packageOpenApiPath = resolve(packageRoot, 'docs/api/openapi.yaml');
const openApiPath = existsSync(workspaceOpenApiPath) ? workspaceOpenApiPath : packageOpenApiPath;
const workspaceOpenApiJsonPath = resolve(workspaceRoot, 'docs/api/openapi.json');
const packageOpenApiJsonPath = resolve(packageRoot, 'docs/api/openapi.json');
const outPath = resolve(packageRoot, 'src/treedb/generated/openapi-types.ts');

const openApi = parse(readFileSync(openApiPath, 'utf8')) as OpenApi;

function refName(ref: string) {
	return ref.split('/').pop() ?? ref;
}

function schemaRefType(ref: string) {
	return `components['schemas']['${refName(ref)}']`;
}

function literal(value: unknown): string {
	return JSON.stringify(value);
}

function key(name: string) {
	return /^[A-Za-z_$][\w$]*$/u.test(name) ? name : JSON.stringify(name);
}

function typeForSchema(schema: unknown): string {
	if (!schema || typeof schema !== 'object') return 'unknown';
	const s = schema as Schema;
	if (typeof s.$ref === 'string') return schemaRefType(s.$ref);
	if ('const' in s) return literal(s.const);
	if (Array.isArray(s.enum)) return s.enum.map(literal).join(' | ') || 'never';
	if (Array.isArray(s.oneOf)) return s.oneOf.map(typeForSchema).join(' | ') || 'unknown';
	if (Array.isArray(s.anyOf)) return s.anyOf.map(typeForSchema).join(' | ') || 'unknown';
	if (Array.isArray(s.allOf)) return s.allOf.map(typeForSchema).join(' & ') || 'unknown';
	if (s.nullable === true) return `${typeForSchema({ ...s, nullable: undefined })} | null`;
	if (s.type === 'string') return 'string';
	if (s.type === 'integer' || s.type === 'number') return 'number';
	if (s.type === 'boolean') return 'boolean';
	if (s.type === 'null') return 'null';
	if (s.type === 'array') return `${typeForSchema(s.items)}[]`;
	if (s.type === 'object' || s.properties || s.additionalProperties !== undefined) {
		const properties = (s.properties ?? {}) as Record<string, unknown>;
		const required = new Set(Array.isArray(s.required) ? s.required.map(String) : []);
		const parts = Object.entries(properties).map(([name, prop]) => {
			const optional = required.has(name) ? '' : '?';
			return `${key(name)}${optional}: ${typeForSchema(prop)};`;
		});
		if (s.additionalProperties === true) {
			parts.push('[key: string]: unknown;');
		} else if (s.additionalProperties && typeof s.additionalProperties === 'object') {
			parts.push(`[key: string]: ${typeForSchema(s.additionalProperties)};`);
		}
		return parts.length > 0 ? `{ ${parts.join(' ')} }` : 'Record<string, never>';
	}
	return 'unknown';
}

function parametersFor(operation: Operation, location: string) {
	const params = Array.isArray(operation.parameters) ? operation.parameters : [];
	const entries = params
		.filter((param): param is Record<string, unknown> => typeof param === 'object' && param !== null && (param as { in?: unknown }).in === location)
		.map((param) => {
			const name = String(param.name);
			const optional = param.required === true ? '' : '?';
			return `${key(name)}${optional}: ${typeForSchema(param.schema)};`;
		});
	return entries.length > 0 ? `{ ${entries.join(' ')} }` : 'never';
}

function requestBodyFor(operation: Operation) {
	const body = operation.requestBody as { content?: Record<string, { schema?: unknown }> } | undefined;
	const content = body?.content ?? {};
	const json = content['application/json']?.schema;
	if (json) return typeForSchema(json);
	const octets = content['application/octet-stream']?.schema;
	if (octets) return 'ArrayBuffer | Uint8Array | Blob';
	return 'never';
}

function responseFor(response: unknown) {
	if (!response || typeof response !== 'object') return 'unknown';
	if (typeof (response as { $ref?: unknown }).$ref === 'string') {
		const name = refName((response as { $ref: string }).$ref);
		if (name === 'Error') return "components['schemas']['TreeDbErrorEnvelope']";
		if (name === 'Ok') return "components['schemas']['TreeDbOkEnvelope']";
	}
	const r = response as { content?: Record<string, { schema?: unknown }> };
	const content = r.content ?? {};
	const json = content['application/json']?.schema;
	if (json) return typeForSchema(json);
	const octets = content['application/octet-stream']?.schema;
	if (octets) return 'ArrayBuffer';
	return 'unknown';
}

function operationType(operation: Operation) {
	const responses = operation.responses ?? {};
	const responseEntries = Object.entries(responses).map(([status, response]) => `${JSON.stringify(status)}: ${responseFor(response)};`);
	return [
		'{',
		`parameters: { path: ${parametersFor(operation, 'path')}; query: ${parametersFor(operation, 'query')}; header: ${parametersFor(operation, 'header')}; };`,
		`requestBody: ${requestBodyFor(operation)};`,
		`responses: { ${responseEntries.join(' ')} };`,
		'}',
	].join(' ');
}

const schemas = openApi.components?.schemas ?? {};
const schemaLines = Object.entries(schemas)
	.sort(([a], [b]) => a.localeCompare(b))
	.map(([name, schema]) => `${key(name)}: ${typeForSchema(schema)};`);

const operationEntries: Array<[string, Operation]> = [];
const pathLines: string[] = [];
for (const [path, methods] of Object.entries(openApi.paths ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
	const methodLines: string[] = [];
	for (const [method, operation] of Object.entries(methods).sort(([a], [b]) => a.localeCompare(b))) {
		if (!operation?.operationId) continue;
		operationEntries.push([operation.operationId, operation]);
		methodLines.push(`${method}: operations['${operation.operationId}'];`);
	}
	pathLines.push(`${JSON.stringify(path)}: { ${methodLines.join(' ')} };`);
}

const operationLines = operationEntries
	.sort(([a], [b]) => a.localeCompare(b))
	.map(([id, operation]) => `${key(id)}: ${operationType(operation)};`);

const generated = `// Generated from docs/api/openapi.yaml. Do not edit by hand.

export interface paths {
${pathLines.map((line) => `\t${line}`).join('\n')}
}

export interface components {
\tschemas: {
${schemaLines.map((line) => `\t\t${line}`).join('\n')}
\t};
}

export interface operations {
${operationLines.map((line) => `\t${line}`).join('\n')}
}
`;

const current = (() => {
	try {
		return readFileSync(outPath, 'utf8');
	} catch {
		return null;
	}
})();

if (check && current !== generated) {
	console.error(`${relative(process.cwd(), outPath)} is not up to date. Run npm run treedb:generate-types.`);
	process.exit(1);
}

if (!check) {
	mkdirSync(dirname(outPath), { recursive: true });
	writeFileSync(outPath, generated, 'utf8');
	for (const target of [workspaceOpenApiJsonPath, packageOpenApiJsonPath]) {
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, `${JSON.stringify(openApi, null, 2)}\n`, 'utf8');
	}
	if (openApiPath === workspaceOpenApiPath) {
		mkdirSync(dirname(packageOpenApiPath), { recursive: true });
		writeFileSync(packageOpenApiPath, stringify(openApi), 'utf8');
	}
	console.log(`Wrote ${relative(process.cwd(), outPath)}`);
	console.log(`Wrote ${relative(process.cwd(), workspaceOpenApiJsonPath)}`);
	console.log(`Wrote ${relative(process.cwd(), packageOpenApiJsonPath)}`);
}
