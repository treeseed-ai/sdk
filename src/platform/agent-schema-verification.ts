import type { PlatformDiagnostic } from './schemas.ts';
import { describeContentFrontmatterSchema } from '../content/validation/content-model-schemas.ts';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { z } from 'zod';
import { assignmentAttemptSchema, assignmentContextSchema, assignmentResultSchema, usageSettlementSchema, leaseSchema, reservationSchema,
	exactEntityReferenceSchema, exactGrantSchema, assignmentWorkspaceSchema, estimateSchema } from '../agent-capacity/contracts/capacity/assignments/agent-execution.ts';
import { assignmentReferenceSchema, effectiveActivityProfileSchema, authorizedContextItemSchema, verificationRecordSchema,
	usageSchema, diagnosticSchema, assignmentTimingAwarenessReceiptSchema } from '../agent-capacity/contracts/capacity/assignments/agent-execution.ts';
import { executionNodeSchema, executionEdgeSchema, graphRevisionSchema, graphChangeSetSchema,
	conditionDefinitionSchema } from '../agent-capacity/validation/execution/execution-graph.ts';
import { appliedWorkdaySchema, workdayPolicySchema, workdayProfileSchema } from '../agent-capacity/contracts/capacity/workdays/workday-allocation.ts';
import { activityProfileSchema, activityProfilesSchema } from '../agent-capacity/validation/agent-definition-schema.ts';

const models = {
	Book: 'book', Knowledge: 'knowledge', Objective: 'objective',
	Discussion: 'discussion', DiscussionMessage: 'discussion_message',
	AgentProfile: 'agent', Proposal: 'proposal', Question: 'question', Note: 'note', Decision: 'decision',
} as const;

// These are the existing executable validators, not a copy of the target
// declaration. Unimplemented stored models remain explicitly unverified.
const runtimeSchemas = {
	AssignmentContext: assignmentContextSchema, ExactEntityReference: exactEntityReferenceSchema,
	ExactGrant: exactGrantSchema, AssignmentWorkspace: assignmentWorkspaceSchema, Estimate: estimateSchema,
	AssignmentReference: assignmentReferenceSchema, GitReference: assignmentReferenceSchema.options[0],
	TreeDxReference: assignmentReferenceSchema.options[1], UrlReference: assignmentReferenceSchema.options[2],
	ReadOnlyWorkspace: assignmentWorkspaceSchema.options[0], TreeDxAssignmentWorkspace: assignmentWorkspaceSchema.options[1],
	GitAssignmentWorkspace: assignmentWorkspaceSchema.options[2], EffectiveActivityProfile: effectiveActivityProfileSchema,
	AuthorizedContextItem: authorizedContextItemSchema, VerificationRecord: verificationRecordSchema,
	Usage: usageSchema, Diagnostic: diagnosticSchema, AssignmentTimingAwarenessReceipt: assignmentTimingAwarenessReceiptSchema,
	GraphChangeSet: graphChangeSetSchema, ConditionDefinition: conditionDefinitionSchema,
	WorkdayPolicyFields: workdayPolicySchema, ActivityProfile: activityProfileSchema, ActivityProfiles: activityProfilesSchema,
};
const schemas: Record<string, z.ZodTypeAny> = {
	...Object.fromEntries(Object.entries(models).map(([name, model]) => [name, describeContentFrontmatterSchema(model)])),
	AssignmentAttempt: assignmentAttemptSchema,
	AssignmentResult: assignmentResultSchema, UsageSettlement: usageSettlementSchema,
	Lease: leaseSchema, Reservation: reservationSchema,
	ExecutionNode: executionNodeSchema, ExecutionEdge: executionEdgeSchema, Workday: appliedWorkdaySchema,
	GraphRevision: graphRevisionSchema, WorkdayPolicy: workdayProfileSchema,
	...runtimeSchemas,
};
const runtimeOnly = new Set(Object.keys(runtimeSchemas));

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

/** Compare validation assertions, not annotation text. A declaration assertion
 * absent from the executable schema is a mismatch, including constraints Zod
 * cannot represent in its generated JSON Schema. Never silently discard it. */
function structuralSchema(value: unknown, root: JsonSchema): unknown {
	if (typeof value === 'boolean') return value ? {} : false;
	const schema = dereference(record(value), root);
	const normalized: JsonSchema = {};
	for (const key of ['$ref','type','const','enum','minLength','maxLength','pattern','format','minimum','maximum',
		'exclusiveMinimum','exclusiveMaximum','multipleOf','minItems','maxItems','minProperties','maxProperties',
		'uniqueItems','minContains','maxContains'] as const) {
		if (schema[key] !== undefined) normalized[key] = schema[key];
	}
	if (normalized.type === 'integer' && schema.exclusiveMinimum === 0 && normalized.minimum === undefined) {
		normalized.minimum = 1; delete normalized.exclusiveMinimum;
	}
	if (normalized.const !== undefined || normalized.enum !== undefined) delete normalized.type;
	for (const key of ['items','contains','not','if','then','else','propertyNames','unevaluatedItems','unevaluatedProperties'] as const) {
		if (schema[key] !== undefined) normalized[key] = structuralSchema(schema[key], root);
	}
	for (const key of ['allOf','anyOf','oneOf','prefixItems'] as const) {
		if (schema[key] !== undefined) normalized[key] = Array.isArray(schema[key])
			? schema[key].map(child => structuralSchema(child, root)) : schema[key];
	}
	for (const key of ['properties','patternProperties','dependentSchemas'] as const) {
		if (schema[key] !== undefined) normalized[key] = Object.fromEntries(
			Object.entries(record(schema[key])).sort(([left], [right]) => left.localeCompare(right))
				.map(([name, child]) => [name, structuralSchema(child, root)]));
	}
	if (schema.dependentRequired !== undefined) normalized.dependentRequired = Object.fromEntries(
		Object.entries(record(schema.dependentRequired)).sort(([left], [right]) => left.localeCompare(right))
			.map(([key, child]) => [key, Array.isArray(child) ? [...child].sort() : child]));
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
		|| Array.isArray(expected) !== Array.isArray(actual)) return [
		`${path || '<root>'}: declaration ${JSON.stringify(expected)}, executable ${JSON.stringify(actual)}`,
	];
	const left = expected as JsonSchema, right = actual as JsonSchema;
	return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
		.flatMap((key) => structuralDifferences(left[key], right[key], path ? `${path}.${key}` : key));
}

// The executable side is immutable for this module lifetime. Avoid repeatedly
// compiling it for every independently supplied declaration and mutation.
const executableStructures = new Map(Object.entries(schemas).map(([name, schema]) => {
	const generated = record(zodToJsonSchema(schema, { name, $refStrategy: 'none' }));
	return [name, structuralSchema(record(record(generated.definitions)[name]), generated)] as const;
}));

/** Compare the authored architecture declaration with its executable content validators. */
export function verifyAgentContentSchema(document: unknown, path = 'docs/agent.schema.yml'): PlatformDiagnostic[] {
	const definitions = (document as { $defs?: Record<string, unknown> })?.$defs ?? {};
	const diagnostics: PlatformDiagnostic[] = [];
	const union = record(document).oneOf;
	if (!Array.isArray(union) || !union.length) diagnostics.push({ code: 'agent_schema_root_missing', path,
		message: 'The stored-record root must declare a nonempty oneOf union; a content-model subset is not complete authority.' });
	else {
		const seen = new Set<string>();
		for (const entry of union) {
			const reference = record(entry).$ref;
			const match = typeof reference === 'string' ? /^#\/\$defs\/([^/]+)$/u.exec(reference) : null;
			const name = match?.[1];
			if (!name || Object.keys(record(entry)).length !== 1) diagnostics.push({ code: 'agent_schema_root_invalid', path,
				message: `Stored-record root reference ${String(reference)} must identify one exact local definition.` });
			else {
				if (seen.has(name)) diagnostics.push({ code: 'agent_schema_root_duplicate', path, message: `Stored-record root repeats ${name}.` });
				seen.add(name);
				if (!Object.hasOwn(definitions, name) || !Object.keys(record(definitions[name])).length) diagnostics.push({
					code: 'agent_schema_missing', path, message: `${name} root authority is missing or unconstrained.` });
				else if (runtimeOnly.has(name)) diagnostics.push({ code: 'agent_schema_root_invalid', path,
					message: `${name} is a runtime/shared contract, not a stored-record root member.` });
				else if (!Object.hasOwn(schemas, name)) diagnostics.push({ code: 'agent_schema_unverified', path,
					message: `${name} stored-record authority has no executable schema equivalence implementation.` });
			}
		}
		for (const name of Object.keys(schemas)) if (!runtimeOnly.has(name) && !seen.has(name)) {
			diagnostics.push({ code: 'agent_schema_root_missing', path,
				message: `${name} executable stored-record authority is absent from the root union.` });
		}
	}
	for (const [definition, schema] of Object.entries(schemas)) {
		const declared = definitions[definition] as { properties?: Record<string, { const?: unknown }>; required?: string[] } | undefined;
		let base = schema;
		while (base instanceof z.ZodEffects) base = base.innerType();
		const shape: Record<string, Field> = base instanceof z.ZodObject ? base.shape : {};
		if (!declared || typeof declared !== 'object' || (base instanceof z.ZodObject && !declared.properties)) {
			diagnostics.push({ code: 'agent_schema_missing', path, message: `${definition} must declare properties and required fields.` });
			continue;
		}
		const declaredKeys = Object.keys(declared.properties ?? {}).sort();
		const actualKeys = Object.keys(shape).sort();
		const missing = actualKeys.filter((key) => !declaredKeys.includes(key));
		const extra = declaredKeys.filter((key) => !actualKeys.includes(key));
		if (missing.length || extra.length) diagnostics.push({ code: 'agent_schema_fields_mismatch', path,
			message: `${definition} differs from SDK executable fields; missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'}.` });
		const required = actualKeys.filter((key) => !shape[key]!.isOptional()).sort();
		const declaredRequired = [...(declared.required ?? [])].sort();
		if (JSON.stringify(required) !== JSON.stringify(declaredRequired)) diagnostics.push({ code: 'agent_schema_required_mismatch', path,
			message: `${definition} required fields differ; SDK: ${required.join(', ') || 'none'}; declaration: ${declaredRequired.join(', ') || 'none'}.` });
		for (const [field, specification] of Object.entries(declared.properties ?? {})) {
			if (specification && Object.hasOwn(specification, 'const') && shape[field]
				&& !shape[field].safeParse(specification.const).success) diagnostics.push({ code: 'agent_schema_constant_mismatch', path,
					message: `${definition}.${field} constant is rejected by the SDK validator.` });
		}
		const expectedStructure = JSON.stringify(structuralSchema(declared, document as JsonSchema));
		const actualStructure = JSON.stringify(executableStructures.get(definition));
		if (expectedStructure !== actualStructure) diagnostics.push({ code: 'agent_schema_structure_mismatch', path,
			message: `${definition} nested declarative constraints differ from the SDK validator at ${
				structuralDifferences(JSON.parse(expectedStructure), JSON.parse(actualStructure)).join('; ')}.` });
	}
	return diagnostics;
}
