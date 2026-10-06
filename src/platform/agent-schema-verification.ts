import type { PlatformDiagnostic } from './schemas.ts';
import { describeContentFrontmatterSchema } from '../content/validation/content-model-schemas.ts';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { z } from 'zod';
import { exportSchemaConstraints } from '../content/validation/schema-constraints.ts';
import { assignmentAttemptSchema, assignmentContextSchema, assignmentResultSchema, usageSettlementSchema, leaseSchema, reservationSchema,
	exactEntityReferenceSchema, exactGrantSchema, assignmentWorkspaceSchema, estimateSchema } from '../agent-capacity/contracts/capacity/assignments/agent-execution.ts';
import { assignmentReferenceSchema, effectiveActivityProfileSchema, authorizedContextItemSchema, verificationRecordSchema,
	usageSchema, diagnosticSchema, assignmentTimingAwarenessReceiptSchema } from '../agent-capacity/contracts/capacity/assignments/agent-execution.ts';
import { executionNodeSchema, executionEdgeSchema, graphRevisionSchema, graphChangeSetSchema,
	conditionDefinitionSchema } from '../agent-capacity/validation/execution/execution-graph.ts';
import { appliedWorkdaySchema, workdayPolicySchema, workdayProfileSchema, weightMapSchema, projectWeightSchema, agentClassWeightSchema } from '../agent-capacity/contracts/capacity/workdays/workday-allocation.ts';
import { activityProfileSchema, activityProfilesSchema } from '../agent-capacity/validation/agent-definition-schema.ts';
import { providerOfferSchema, providerStateSchema, availabilityWindowSchema, nativeLimitSchema } from '../agent-capacity/contracts/capacity/providers/supply-policy.ts';
import { treeDxWorkspaceSchema, treeDxWorkspaceReviewSchema, treeDxPublicationReceiptSchema } from '../treedx/types.ts';
import { teamRecordSchema, projectRecordSchema, repositoryBindingSchema, treeDxBindingSchema } from './schemas.ts';
import { agentRegistrationSchema } from '../agent-capacity/contracts/projects/agents/project-agent-class.ts';
import { workdayIntentSchema } from '../operator-contracts/workday-lifecycle.ts';
import { workdayScheduleSchema } from '../agent-capacity/contracts/capacity/workdays/workday-records.ts';

const models = {
	Book: 'book', Knowledge: 'knowledge', Objective: 'objective',
	Discussion: 'discussion', DiscussionMessage: 'discussion_message',
	AgentProfile: 'agent', Proposal: 'proposal', Question: 'question', Note: 'note', Decision: 'decision',
} as const;

// These are the existing executable validators, not a copy of the target
// declaration. Unimplemented stored models remain explicitly unverified.
const runtimeSchemas = {
	WeightMap: weightMapSchema, ProjectWeight: projectWeightSchema, AgentClassWeight: agentClassWeightSchema,
	WorkdayIntent: workdayIntentSchema,
	RepositoryBinding: repositoryBindingSchema, TreeDxBinding: treeDxBindingSchema,
	AvailabilityWindow: availabilityWindowSchema, NativeLimit: nativeLimitSchema,
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
	PlanningRound: appliedWorkdaySchema.innerType().shape.planningRounds.element,
	AssignmentLimits: assignmentAttemptSchema.innerType().shape.limits,
	ProviderOfferSelection: assignmentAttemptSchema.innerType().shape.provider,
};
const schemas: Record<string, z.ZodTypeAny> = {
	Team: teamRecordSchema, Project: projectRecordSchema, AgentRegistration: agentRegistrationSchema,
	WorkdaySchedule: workdayScheduleSchema,
	...Object.fromEntries(Object.entries(models).map(([name, model]) => [name, describeContentFrontmatterSchema(model)])),
	ProviderOffer: providerOfferSchema, ProviderState: providerStateSchema,
	TreeDxWorkspace: treeDxWorkspaceSchema, TreeDxWorkspaceReview: treeDxWorkspaceReviewSchema, TreeDxPublicationReceipt: treeDxPublicationReceiptSchema,
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

function dereference(schema: JsonSchema, root: JsonSchema, references: Set<string>): JsonSchema | false {
	while (typeof schema.$ref === 'string' && schema.$ref.startsWith('#/')) {
		const reference = schema.$ref;
		if (references.has(reference)) return schema;
		references.add(reference);
		const parts = reference.slice(2).split('/');
		if (parts.some(part => /~(?![01])/u.test(part))) return schema;
		let selected: unknown = root;
		for (const part of parts) {
			const key = part.replace(/~1/gu, '/').replace(/~0/gu, '~');
			if (!selected || typeof selected !== 'object' || !Object.hasOwn(selected, key)) return schema;
			selected = Object.getOwnPropertyDescriptor(selected, key)?.value;
		}
		if (selected === false) return false;
		if (selected !== true && (!selected || typeof selected !== 'object' || Array.isArray(selected))) return schema;
		schema = { ...record(selected), ...Object.fromEntries(Object.entries(schema).filter(([key]) => key !== '$ref')) };
	}
	// Missing, external and recursive references remain explicit assertions;
	// never erase them into an unconstrained schema or fetch moving authority.
	return schema;
}

// oneOf and anyOf agree only when a required literal discriminator proves
// every branch mutually exclusive. Untagged or overlapping unions stay exact.
function disjointTaggedBranches(value: unknown): value is JsonSchema[] {
	if (!Array.isArray(value) || !value.length) return false;
	const branches = value.map(record), first = branches[0]!;
	if (branches.some(branch => branch.type !== 'object' || !Array.isArray(branch.required))) return false;
	return (first.required as unknown[]).some(field => {
		if (typeof field !== 'string') return false;
		const tags: string[] = [];
		for (const branch of branches) {
			if (!(branch.required as unknown[]).includes(field)) return false;
			const tag = record(record(branch.properties)[field]);
			if (!Object.hasOwn(tag, 'const')) return false;
			const literal = tag.const;
			if (literal !== null && typeof literal !== 'string' && typeof literal !== 'boolean'
				&& !(typeof literal === 'number' && Number.isFinite(literal))) return false;
			tags.push(JSON.stringify(literal));
		}
		return new Set(tags).size === branches.length;
	});
}

type Scalar = string | number | boolean | null;
function finiteValuesImplyType(schema: JsonSchema): boolean {
	const values = Object.hasOwn(schema, 'const') ? [schema.const] : Array.isArray(schema.enum) ? schema.enum : [];
	const types = Array.isArray(schema.type) ? schema.type : [schema.type];
	return values.length > 0 && values.every(value => types.some(type => type === 'null' ? value === null
		: type === 'array' ? Array.isArray(value) : type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
			: type === 'integer' ? typeof value === 'number' && Number.isInteger(value)
				: type === 'number' ? typeof value === 'number' && Number.isFinite(value) : typeof value === type));
}
function finiteValues(value: unknown): Scalar[] | undefined {
	const schema = record(value), keys = Object.keys(schema);
	if (keys.length !== 1) return undefined;
	const values = keys[0] === 'const' ? [schema.const]
		: keys[0] === 'enum' && Array.isArray(schema.enum) ? schema.enum
			: schema.type === 'null' ? [null] : undefined;
	if (!values?.length || values.some(item => item !== null && typeof item !== 'string'
		&& typeof item !== 'boolean' && !(typeof item === 'number' && Number.isFinite(item)))) return undefined;
	return values as Scalar[];
}

function finiteSchema(values: Scalar[]): JsonSchema {
	const unique = [...new Map(values.map(value => [JSON.stringify(value), value])).entries()]
		.sort(([left], [right]) => left.localeCompare(right)).map(([, value]) => value);
	return unique.length === 1 ? { const: unique[0] } : { enum: unique };
}

/** Compare validation assertions, not annotation text. A declaration assertion
 * absent from the executable schema is a mismatch, including constraints Zod
 * cannot represent in its generated JSON Schema. Never silently discard it. */
type StructureCache = WeakMap<object, Map<string, unknown>>;
function structuralSchema(value: unknown, root: JsonSchema, ancestors: ReadonlySet<string> = new Set(), inheritedObject = false,
	cache: StructureCache = new WeakMap()): unknown {
	if (!value || typeof value !== 'object') return structuralSchemaValue(value, root, ancestors, inheritedObject, cache);
	const key = JSON.stringify([[...ancestors].sort(), inheritedObject]), entries = cache.get(value) ?? new Map<string, unknown>();
	if (entries.has(key)) return entries.get(key);
	const result = structuralSchemaValue(value, root, ancestors, inheritedObject, cache);
	entries.set(key, result); cache.set(value, entries); return result;
}

// Cache only within ONE immutable comparison, including reference ancestry.
// A later supplied document is always freshly evaluated, even on the same object.
function structuralSchemaValue(value: unknown, root: JsonSchema, ancestors: ReadonlySet<string>, inheritedObject: boolean, cache: StructureCache): unknown {
	if (typeof value === 'boolean') return value ? {} : false;
	const references = new Set(ancestors), schema = dereference(record(value), root, references);
	if (schema === false) return false;
	const normalized: JsonSchema = {};
	for (const key of ['$ref','type','const','enum','minLength','maxLength','pattern','format','minimum','maximum',
		'exclusiveMinimum','exclusiveMaximum','multipleOf','minItems','maxItems','minProperties','maxProperties',
		'uniqueItems','minContains','maxContains'] as const) {
		if (schema[key] !== undefined) normalized[key] = schema[key];
	}
	// Conditional and intersection/union branches see the same instance as
	// their parent. Only an already established object kind is redundant;
	// property/item schemas and contradictory branch kinds remain independent.
	const objectAuthority = inheritedObject || schema.type === 'object';
	if (inheritedObject && normalized.type === 'object') delete normalized.type;
	if (normalized.type === 'integer' && schema.exclusiveMinimum === 0 && normalized.minimum === undefined) {
		normalized.minimum = 1; delete normalized.exclusiveMinimum;
	}
	if (!Object.hasOwn(normalized, 'const') && Array.isArray(normalized.enum) && normalized.enum.length === 1) {
		normalized.const = normalized.enum[0]; delete normalized.enum;
	}
	// Finite values imply their kind only when every value satisfies it.
	// A contradictory kind is still an assertion and must remain visible.
	if (finiteValuesImplyType(normalized)) delete normalized.type;
	for (const key of ['items','contains','not','if','then','else','propertyNames','unevaluatedItems','unevaluatedProperties'] as const) {
		if (schema[key] !== undefined) normalized[key] = structuralSchema(schema[key], root, references,
			objectAuthority && ['not', 'if', 'then', 'else'].includes(key), cache);
	}
	for (const key of ['allOf','anyOf','oneOf','prefixItems'] as const) {
		if (schema[key] !== undefined) normalized[key] = Array.isArray(schema[key])
			? schema[key].map(child => structuralSchema(child, root, references, objectAuthority && key !== 'prefixItems', cache)) : schema[key];
	}
	if (normalized.anyOf === undefined && disjointTaggedBranches(normalized.oneOf)) {
		normalized.anyOf = normalized.oneOf; delete normalized.oneOf;
	}
	if (disjointTaggedBranches(normalized.anyOf)) normalized.anyOf = [...normalized.anyOf]
		.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
	for (const key of ['properties','patternProperties','dependentSchemas'] as const) {
		if (schema[key] !== undefined) normalized[key] = Object.fromEntries(
			Object.entries(record(schema[key])).sort(([left], [right]) => left.localeCompare(right))
				.map(([name, child]) => [name, structuralSchema(child, root, references, false, cache)]));
	}
	if (schema.dependentRequired !== undefined) normalized.dependentRequired = Object.fromEntries(
		Object.entries(record(schema.dependentRequired)).sort(([left], [right]) => left.localeCompare(right))
			.map(([key, child]) => [key, Array.isArray(child) ? [...child].sort() : child]));
	if (Array.isArray(schema.required)) normalized.required = [...schema.required].sort();
	if (schema.additionalProperties === false) normalized.additionalProperties = false;
	else if (schema.additionalProperties && Object.keys(record(schema.additionalProperties)).length) {
		normalized.additionalProperties = structuralSchema(schema.additionalProperties, root, references, false, cache);
	}
	const finite = finiteValues(normalized);
	if (finite) return finiteSchema(finite);
	// Finite scalar unions are equivalent to their exact set only when no
	// other assertions qualify them. oneOf additionally requires disjoint
	// branches; duplicate/overlapping alternatives must not become anyOf.
	if (Object.keys(normalized).length === 1) {
		const key = normalized.anyOf !== undefined ? 'anyOf' : 'oneOf', union = normalized[key];
		if (Array.isArray(union) && union.length) {
			const branches = union.map(finiteValues);
			if (branches.every((branch): branch is Scalar[] => branch !== undefined)) {
				const values = branches.flat();
				if (key === 'anyOf' || new Set(values.map(value => JSON.stringify(value))).size === values.length) {
					return finiteSchema(values);
				}
			}
		}
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
	const generated = record(zodToJsonSchema(schema, { name, $refStrategy: 'none', postProcess: exportSchemaConstraints }));
	let base = schema;
	while (base instanceof z.ZodEffects) base = base.innerType();
	const shape: Record<string, Field> = base instanceof z.ZodObject ? base.shape : {};
	const keys = Object.keys(shape).sort(), required = keys.filter(key => !shape[key]!.isOptional());
	return [name, { object: base instanceof z.ZodObject, shape, keys, required,
		structure: JSON.stringify(structuralSchema(record(record(generated.definitions)[name]), generated)) }] as const;
}));

/** Compare the authored architecture declaration with its executable content validators. */
export function verifyAgentContentSchema(document: unknown, path = 'docs/agent.schema.yml'): PlatformDiagnostic[] {
	const definitions = (document as { $defs?: Record<string, unknown> })?.$defs ?? {};
	const diagnostics: PlatformDiagnostic[] = [];
	const structures: StructureCache = new WeakMap();
	for (const [name, value] of Object.entries(definitions)) if (!Object.keys(record(value)).length)
		diagnostics.push({ code: 'agent_schema_missing', path, message: `${name} definition is missing or unconstrained.` });
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
	for (const [definition, executable] of executableStructures) {
		const declared = definitions[definition] as { properties?: Record<string, { const?: unknown }>; required?: string[] } | undefined;
		const { shape, keys: actualKeys, required } = executable;
		if (!declared || typeof declared !== 'object' || (executable.object && !declared.properties)) {
			diagnostics.push({ code: 'agent_schema_missing', path, message: `${definition} must declare properties and required fields.` });
			continue;
		}
		const declaredKeys = Object.keys(declared.properties ?? {}).sort();
		const missing = actualKeys.filter((key) => !declaredKeys.includes(key));
		const extra = declaredKeys.filter((key) => !actualKeys.includes(key));
		if (missing.length || extra.length) diagnostics.push({ code: 'agent_schema_fields_mismatch', path,
			message: `${definition} differs from SDK executable fields; missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'}.` });
		const declaredRequired = [...(declared.required ?? [])].sort();
		if (JSON.stringify(required) !== JSON.stringify(declaredRequired)) diagnostics.push({ code: 'agent_schema_required_mismatch', path,
			message: `${definition} required fields differ; SDK: ${required.join(', ') || 'none'}; declaration: ${declaredRequired.join(', ') || 'none'}.` });
		for (const [field, specification] of Object.entries(declared.properties ?? {})) {
			if (specification && Object.hasOwn(specification, 'const') && shape[field]
				&& !shape[field].safeParse(specification.const).success) diagnostics.push({ code: 'agent_schema_constant_mismatch', path,
					message: `${definition}.${field} constant is rejected by the SDK validator.` });
		}
		const expectedStructure = JSON.stringify(structuralSchema(declared, document as JsonSchema, new Set(), false, structures));
		const actualStructure = executable.structure;
		if (expectedStructure !== actualStructure) diagnostics.push({ code: 'agent_schema_structure_mismatch', path,
			message: `${definition} nested declarative constraints differ from the SDK validator at ${
				structuralDifferences(JSON.parse(expectedStructure), JSON.parse(actualStructure)).join('; ')}.` });
	}
	return diagnostics;
}
