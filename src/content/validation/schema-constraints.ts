import { z } from 'zod';
import { zodToJsonSchema, type PostProcessCallback } from 'zod-to-json-schema';

// Zod's exporter cannot infer custom refinements. Register the definition
// created by the owning check; never borrow assertions from the target.
type ExportedSchema = NonNullable<Parameters<PostProcessCallback>[0]>;
const exporters = new WeakMap<z.ZodTypeDef, (schema: ExportedSchema) => ExportedSchema>();

/** Preserve inherited validation while requiring represented properties. */
export function requiredProperties<T extends z.AnyZodObject>(object: T, fields: readonly string[], message: string) {
	const schema = object.superRefine((value, context) => {
		for (const field of fields) if (Object.getOwnPropertyDescriptor(value, field)?.value === undefined)
			context.addIssue({ code: z.ZodIssueCode.custom, path: [field], message });
	});
	exporters.set(schema._def, exported => {
		if (!('type' in exported) || exported.type !== 'object') throw new Error('Required properties must export an object schema.');
		const required = 'required' in exported && Array.isArray(exported.required) ? exported.required : [];
		return { ...exported, required: [...new Set([...fields, ...required])] };
	});
	return schema;
}

export function uniqueArray<T extends z.ZodTypeAny>(array: z.ZodArray<T>) {
	const schema = array.superRefine((values, context) => {
		if (new Set(values.map(value => JSON.stringify(value))).size !== values.length) {
			context.addIssue({ code: z.ZodIssueCode.custom, message: 'Values must be unique.' });
		}
	});
	exporters.set(schema._def, exported => {
		if (!('type' in exported) || exported.type !== 'array') throw new Error('The unique-array validator must export an array schema.');
		return { ...exported, uniqueItems: true };
	});
	return schema;
}

/** Count represented properties once for both validation and schema export. */
export function minimumProperties<T extends z.AnyZodObject>(object: T, minimum: number,
	message: string): z.ZodEffects<T, z.output<T>, z.input<T>> {
	const schema = object.superRefine((value, context) => {
		if (Object.values(value).filter(entry => entry !== undefined).length < minimum) {
			context.addIssue({ code: z.ZodIssueCode.custom, message });
		}
	});
	exporters.set(schema._def, exported => {
		if (!('type' in exported) || exported.type !== 'object') throw new Error('Property bounds must export an object schema.');
		return { ...exported, minProperties: minimum };
	});
	return schema;
}

/** A represented selector, not a mode-only object, is required. */
export function alternativeProperties<T extends z.AnyZodObject>(object: T, fields: readonly string[]) {
	const schema = object.superRefine((value, context) => {
		if (!fields.some(field => Object.getOwnPropertyDescriptor(value, field)?.value !== undefined))
			context.addIssue({ code: z.ZodIssueCode.custom, message: 'At least one selector is required.' });
	});
	exporters.set(schema._def, exported => ({ ...exported, anyOf: fields.map(field => ({ required: [field] })) }));
	return schema;
}

export function exclusiveProperties<T extends z.ZodTypeAny>(object: T, fields: readonly string[]) {
	const schema = object.superRefine((value, context) => {
		if (fields.every(field => Object.getOwnPropertyDescriptor(value, field)?.value !== undefined))
			context.addIssue({ code: z.ZodIssueCode.custom, path: [fields[0]!], message: 'Specify only one alternative.' });
	});
	exporters.set(schema._def, exported => ({ ...exported, not: { required: [...fields] } }));
	return schema;
}

/** Exactly one actual branch must accept; retain overlap denial in the export. */
export function exclusiveUnion<T extends z.ZodUnion<[z.ZodTypeAny, ...z.ZodTypeAny[]]>>(union: T) {
	const schema = union.superRefine((value, context) => {
		if (union.options.filter(branch => branch.safeParse(value).success).length !== 1)
			context.addIssue({ code: z.ZodIssueCode.custom, message: 'Exactly one union branch must accept.' });
	});
	exporters.set(schema._def, exported => {
		if (!('anyOf' in exported)) throw new Error('Exclusive union must export its actual branches.');
		const { anyOf, ...rest } = exported; return { ...rest, oneOf: anyOf };
	});
	return schema;
}

type ForbiddenFields<Field extends string> = { fields: readonly Field[]; conditions?: readonly { field: Field; equals: unknown }[] };
type ConditionalRequirement<Field extends string> = {
	field: Field; equals?: unknown; notEquals?: unknown; in?: readonly unknown[];
	message: string; path?: readonly (string | number)[];
} & ({ alternatives: readonly (readonly Field[])[]; forbidden?: ForbiddenFields<Field>; allowed?: never; contains?: never;
	items?: { field: Field; key: string; required: readonly string[];
		conditional?: { field: string; equals: unknown; required: readonly string[] } } }
	| { alternatives?: never; forbidden: { field: Field; key: string } | ForbiddenFields<Field>; allowed?: never; contains?: never }
	| { alternatives?: never; forbidden?: never; allowed: { field: Field; values: readonly unknown[] }; contains?: never }
	| { alternatives?: never; forbidden?: never; allowed?: never; contains: { field: Field; properties: Readonly<Record<string, unknown>> } });

/** The same owning field rules drive runtime validation and schema export. */
export function conditionalFields<T extends z.AnyZodObject>(object: T,
	rules: readonly ConditionalRequirement<keyof z.infer<NoInfer<T>> & string>[]): z.ZodEffects<T, z.output<T>, z.input<T>> {
	const schema = object.superRefine((value, context) => {
		for (const rule of rules) {
			const selected = Object.getOwnPropertyDescriptor(value, rule.field)?.value;
			if (selected === undefined || (Object.hasOwn(rule, 'equals') && selected !== rule.equals)) continue;
			if (Object.hasOwn(rule, 'notEquals') && selected === rule.notEquals) continue;
			if (rule.in && !rule.in.includes(selected)) continue;
			const nested = rule.forbidden && 'field' in rule.forbidden ? Object.getOwnPropertyDescriptor(value, rule.forbidden.field)?.value : undefined;
			const entries: unknown = rule.contains ? Object.getOwnPropertyDescriptor(value, rule.contains.field)?.value : undefined;
			const forbidden = rule.forbidden ? 'fields' in rule.forbidden
				? rule.forbidden.fields.some(field => Object.getOwnPropertyDescriptor(value, field)?.value !== undefined)
					|| Boolean(rule.forbidden.conditions?.some(condition => Object.getOwnPropertyDescriptor(value, condition.field)?.value === condition.equals))
				: nested && typeof nested === 'object' && Object.getOwnPropertyDescriptor(nested, rule.forbidden.key)?.value !== undefined
				: false;
			const invalid = forbidden || (rule.alternatives ? !rule.alternatives.some(fields => fields.every(field => Object.getOwnPropertyDescriptor(value, field)?.value !== undefined))
				: rule.allowed ? !rule.allowed.values.includes(Object.getOwnPropertyDescriptor(value, rule.allowed.field)?.value)
				: rule.contains ? !Array.isArray(entries) || !entries.some(entry => entry && typeof entry === 'object'
					&& Object.entries(rule.contains.properties).every(([key, expected]) => Object.getOwnPropertyDescriptor(entry, key)?.value === expected))
				: false);
			if (invalid) {
				context.addIssue({ code: z.ZodIssueCode.custom, path: [...(rule.path ?? [])], message: rule.message });
			}
			const requirement = 'items' in rule ? rule.items : undefined;
			if (requirement) {
				const parent = Object.getOwnPropertyDescriptor(value, requirement.field)?.value;
				const children: unknown = parent && typeof parent === 'object' ? Object.getOwnPropertyDescriptor(parent, requirement.key)?.value : undefined;
				if (Array.isArray(children)) for (const [index, child] of children.entries()) {
					if (!child || typeof child !== 'object') continue;
					const conditional = requirement.conditional;
					const fields = [...requirement.required, ...(conditional && Object.getOwnPropertyDescriptor(child, conditional.field)?.value === conditional.equals ? conditional.required : [])];
					for (const field of fields) if (Object.getOwnPropertyDescriptor(child, field)?.value === undefined)
						context.addIssue({ code: z.ZodIssueCode.custom, path: [requirement.field, requirement.key, index, field], message: rule.message });
				}
			}
		}
	});
	exporters.set(schema._def, exported => {
		if (!('type' in exported) || exported.type !== 'object') throw new Error('Conditional fields must export an object schema.');
		const required = (fields: readonly string[]) => ({ type: 'object', required: [...fields] });
		const forbidden = (fields: ForbiddenFields<string>) => ({ type: 'object', anyOf: [
			...fields.fields.map(field => required([field])),
			...(fields.conditions ?? []).map(condition => ({ ...required([condition.field]), properties: { [condition.field]: { const: condition.equals } } })),
		] });
		return { ...exported, allOf: rules.map(rule => ({
			if: { ...required([rule.field]), ...(Object.hasOwn(rule, 'equals') ? { properties: { [rule.field]: { const: rule.equals } } }
				: Object.hasOwn(rule, 'notEquals') ? { properties: { [rule.field]: { not: { const: rule.notEquals } } } }
				: rule.in ? { properties: { [rule.field]: { enum: [...rule.in] } } } : {}) },
			then: rule.alternatives && rule.forbidden ? {
				...(rule.alternatives.length === 1 ? required(rule.alternatives[0]!) : { type: 'object', anyOf: rule.alternatives.map(required) }),
				not: forbidden(rule.forbidden),
			} : rule.forbidden ? 'fields' in rule.forbidden
				? { type: 'object', not: forbidden(rule.forbidden) }
				: { type: 'object', properties: { [rule.forbidden.field]: { not: required([rule.forbidden.key]) } } }
				: rule.allowed ? { type: 'object', properties: { [rule.allowed.field]: { enum: [...rule.allowed.values] } } }
				: rule.contains ? { type: 'object', properties: { [rule.contains.field]: { type: 'array', contains: {
					...required(Object.keys(rule.contains.properties)), properties: Object.fromEntries(Object.entries(rule.contains.properties).map(([key, value]) => [key, { const: value }])),
				} } } }
				: rule.alternatives.length === 1 ? { ...required(rule.alternatives[0]!), ...(rule.items ? { properties: {
					[rule.items.field]: { type: 'object', properties: { [rule.items.key]: { type: 'array', items: {
						...required(rule.items.required), ...(rule.items.conditional ? { allOf: [{
							if: { properties: { [rule.items.conditional.field]: { const: rule.items.conditional.equals } }, required: [rule.items.conditional.field] },
							then: { required: [...rule.items.conditional.required] },
						}] } : {}),
					} } } },
				} } : {}) }
				: { type: 'object', anyOf: rule.alternatives.map(required) },
		})) };
	});
	return schema;
}

export const exportSchemaConstraints: PostProcessCallback = (schema, definition) => {
	// The upstream intersection exporter flattens allOf and loses sibling
	// object constraints. Export each actual validator intact, not the target.
	if ('typeName' in definition && definition.typeName === z.ZodFirstPartyTypeKind.ZodIntersection && 'left' in definition && 'right' in definition
		&& definition.left instanceof z.ZodType && definition.right instanceof z.ZodType) {
		return { allOf: [definition.left, definition.right].map(part => {
			const { $schema: _dialect, ...branch } = zodToJsonSchema(part, { $refStrategy: 'none', postProcess: exportSchemaConstraints });
			return branch;
		}) };
	}
	const exportConstraint = exporters.get(definition);
	if (!exportConstraint) {
		// A slash escape protects a JavaScript regex delimiter; JSON Schema
		// patterns have no delimiter. Preserve the same regex grammar directly.
		if (schema && 'pattern' in schema && typeof schema.pattern === 'string')
			return { ...schema, pattern: schema.pattern.replace(/\\\//gu, '/') };
		return schema;
	}
	if (!schema) throw new Error('An owning constraint has no exported schema.');
	return exportConstraint(schema);
};
