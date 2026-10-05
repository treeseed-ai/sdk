import { z } from 'zod';
import type { PostProcessCallback } from 'zod-to-json-schema';

// Zod's exporter cannot infer custom refinements. Register the definition
// created by the owning check; never borrow assertions from the target.
type ExportedSchema = NonNullable<Parameters<PostProcessCallback>[0]>;
const exporters = new WeakMap<z.ZodTypeDef, (schema: ExportedSchema) => ExportedSchema>();

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

type ConditionalRequirement<Field extends string> = {
	field: Field; equals?: unknown; notEquals?: unknown; in?: readonly unknown[];
	message: string; path?: readonly (string | number)[];
} & ({ alternatives: readonly (readonly Field[])[]; forbidden?: never; allowed?: never; contains?: never }
	| { alternatives?: never; forbidden: { field: Field; key: string }; allowed?: never; contains?: never }
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
			const nested = rule.forbidden ? Object.getOwnPropertyDescriptor(value, rule.forbidden.field)?.value : undefined;
			const entries: unknown = rule.contains ? Object.getOwnPropertyDescriptor(value, rule.contains.field)?.value : undefined;
			const invalid = rule.forbidden ? nested && typeof nested === 'object'
				&& Object.getOwnPropertyDescriptor(nested, rule.forbidden.key)?.value !== undefined
				: rule.allowed ? !rule.allowed.values.includes(Object.getOwnPropertyDescriptor(value, rule.allowed.field)?.value)
				: rule.contains ? !Array.isArray(entries) || !entries.some(entry => entry && typeof entry === 'object'
					&& Object.entries(rule.contains.properties).every(([key, expected]) => Object.getOwnPropertyDescriptor(entry, key)?.value === expected))
				: !rule.alternatives.some(fields => fields.every(field => Object.getOwnPropertyDescriptor(value, field)?.value !== undefined));
			if (invalid) {
				context.addIssue({ code: z.ZodIssueCode.custom, path: [...(rule.path ?? [])], message: rule.message });
			}
		}
	});
	exporters.set(schema._def, exported => {
		if (!('type' in exported) || exported.type !== 'object') throw new Error('Conditional fields must export an object schema.');
		const required = (fields: readonly string[]) => ({ type: 'object', required: [...fields] });
		return { ...exported, allOf: rules.map(rule => ({
			if: { ...required([rule.field]), ...(Object.hasOwn(rule, 'equals') ? { properties: { [rule.field]: { const: rule.equals } } }
				: Object.hasOwn(rule, 'notEquals') ? { properties: { [rule.field]: { not: { const: rule.notEquals } } } }
				: rule.in ? { properties: { [rule.field]: { enum: [...rule.in] } } } : {}) },
			then: rule.forbidden ? { type: 'object', properties: { [rule.forbidden.field]: { not: required([rule.forbidden.key]) } } }
				: rule.allowed ? { type: 'object', properties: { [rule.allowed.field]: { enum: [...rule.allowed.values] } } }
				: rule.contains ? { type: 'object', properties: { [rule.contains.field]: { type: 'array', contains: {
					...required(Object.keys(rule.contains.properties)), properties: Object.fromEntries(Object.entries(rule.contains.properties).map(([key, value]) => [key, { const: value }])),
				} } } }
				: rule.alternatives.length === 1 ? required(rule.alternatives[0]!)
				: { type: 'object', anyOf: rule.alternatives.map(required) },
		})) };
	});
	return schema;
}

export const exportSchemaConstraints: PostProcessCallback = (schema, definition) => {
	const exportConstraint = exporters.get(definition);
	if (!exportConstraint) return schema;
	if (!schema) throw new Error('An owning constraint has no exported schema.');
	return exportConstraint(schema);
};
