import type { PlatformDiagnostic } from './schemas.ts';
import { describeContentFrontmatterSchema } from '../content/validation/content-model-schemas.ts';
import { zodToJsonSchema } from 'zod-to-json-schema';

const models = {
	Book: 'book', Knowledge: 'knowledge', Objective: 'objective',
	Discussion: 'discussion', DiscussionMessage: 'discussion_message',
} as const;

type Field = { isOptional(): boolean; safeParse(value: unknown): { success: boolean } };
type JsonSchema = Record<string, unknown>;

function record(value: unknown): JsonSchema {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonSchema : {};
}

function dereference(schema: JsonSchema, root: JsonSchema): JsonSchema {
	const reference = typeof schema.$ref === 'string' ? schema.$ref : '';
	if (!reference.startsWith('#/$defs/')) return schema;
	return { ...record(record(root.$defs)[reference.slice('#/$defs/'.length)]),
		...Object.fromEntries(Object.entries(schema).filter(([key]) => key !== '$ref')) };
}

/** Normalize the declarative constraints represented directly by Zod. Cross-field
 * refinements (for example exact-reference custody and unique arrays) remain in
 * focused semantic tests because JSON Schema conditionals do not round-trip
 * through Zod's refinement API. */
function structuralSchema(value: unknown, root: JsonSchema): unknown {
	const schema = dereference(record(value), root);
	const normalized: JsonSchema = {};
	for (const key of ['type','const','enum','minLength','maxLength','pattern','format','minimum','maximum','minItems','maxItems'] as const) {
		if (schema[key] !== undefined) normalized[key] = schema[key];
	}
	if (normalized.type === 'integer' && schema.exclusiveMinimum === 0 && normalized.minimum === undefined) normalized.minimum = 1;
	if (normalized.const !== undefined || normalized.enum !== undefined) delete normalized.type;
	if (schema.items !== undefined) normalized.items = structuralSchema(schema.items, root);
	if (schema.properties !== undefined) normalized.properties = Object.fromEntries(
		Object.entries(record(schema.properties)).sort(([left], [right]) => left.localeCompare(right))
			.map(([key, child]) => [key, structuralSchema(child, root)]),
	);
	if (Array.isArray(schema.required)) normalized.required = [...schema.required].sort();
	if (schema.additionalProperties === false) normalized.additionalProperties = false;
	else if (schema.additionalProperties && Object.keys(record(schema.additionalProperties)).length) {
		normalized.additionalProperties = structuralSchema(schema.additionalProperties, root);
	}
	return normalized;
}

function structuralDifferences(expected: unknown, actual: unknown, path = ''): string[] {
	if (JSON.stringify(expected) === JSON.stringify(actual)) return [];
	if (!expected || !actual || typeof expected !== 'object' || typeof actual !== 'object'
		|| Array.isArray(expected) || Array.isArray(actual)) return [path || '<root>'];
	const left = expected as JsonSchema, right = actual as JsonSchema;
	return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
		.flatMap((key) => structuralDifferences(left[key], right[key], path ? `${path}.${key}` : key));
}

/** Compare the authored architecture declaration with its executable content validators. */
export function verifyAgentContentSchema(document: unknown, path = 'docs/agent.schema.yml'): PlatformDiagnostic[] {
	const definitions = (document as { $defs?: Record<string, unknown> })?.$defs ?? {};
	const diagnostics: PlatformDiagnostic[] = [];
	for (const [definition, model] of Object.entries(models)) {
		const declared = definitions[definition] as { properties?: Record<string, { const?: unknown }>; required?: string[] } | undefined;
		const schema = describeContentFrontmatterSchema(model);
		const shape = 'shape' in schema ? schema.shape as Record<string, Field> : {};
		if (!declared?.properties || !Array.isArray(declared.required)) {
			diagnostics.push({ code: 'agent_schema_missing', path, message: `${definition} must declare properties and required fields.` });
			continue;
		}
		const declaredKeys = Object.keys(declared.properties).sort();
		const actualKeys = Object.keys(shape).sort();
		const missing = actualKeys.filter((key) => !declaredKeys.includes(key));
		const extra = declaredKeys.filter((key) => !actualKeys.includes(key));
		if (missing.length || extra.length) diagnostics.push({ code: 'agent_schema_fields_mismatch', path,
			message: `${definition} differs from SDK ${model} fields; missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'}.` });
		const required = actualKeys.filter((key) => !shape[key]!.isOptional()).sort();
		const declaredRequired = [...declared.required].sort();
		if (JSON.stringify(required) !== JSON.stringify(declaredRequired)) diagnostics.push({ code: 'agent_schema_required_mismatch', path,
			message: `${definition} required fields differ; SDK: ${required.join(', ') || 'none'}; declaration: ${declaredRequired.join(', ') || 'none'}.` });
		for (const [field, specification] of Object.entries(declared.properties)) {
			if (specification && Object.hasOwn(specification, 'const') && shape[field]
				&& !shape[field].safeParse(specification.const).success) diagnostics.push({ code: 'agent_schema_constant_mismatch', path,
					message: `${definition}.${field} constant is rejected by the SDK validator.` });
		}
		const generated = record(zodToJsonSchema(schema, { name: definition, $refStrategy: 'none' }));
		const generatedDefinition = record(record(generated.definitions)[definition]);
		const expectedStructure = JSON.stringify(structuralSchema(declared, document as JsonSchema));
		const actualStructure = JSON.stringify(structuralSchema(generatedDefinition, generated));
		if (expectedStructure !== actualStructure) diagnostics.push({ code: 'agent_schema_structure_mismatch', path,
			message: `${definition} nested declarative constraints differ from the SDK validator at ${
				structuralDifferences(JSON.parse(expectedStructure), JSON.parse(actualStructure)).slice(0, 8).join(', ')}.` });
	}
	return diagnostics;
}
