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

type ConditionalRequirement<Field extends string> = {
	field: Field; equals?: unknown; alternatives: readonly (readonly Field[])[];
	message: string; path?: readonly Field[];
};

/** The same owning field rules drive runtime validation and schema export. */
export function conditionalFields<T extends z.AnyZodObject>(object: T,
	rules: readonly ConditionalRequirement<keyof z.infer<T> & string>[]) {
	const schema = object.superRefine((value, context) => {
		for (const rule of rules) {
			const selected = Object.getOwnPropertyDescriptor(value, rule.field)?.value;
			if (selected === undefined || (Object.hasOwn(rule, 'equals') && selected !== rule.equals)) continue;
			if (!rule.alternatives.some(fields => fields.every(field => Object.getOwnPropertyDescriptor(value, field)?.value !== undefined))) {
				context.addIssue({ code: z.ZodIssueCode.custom, path: [...(rule.path ?? [])], message: rule.message });
			}
		}
	});
	exporters.set(schema._def, exported => {
		if (!('type' in exported) || exported.type !== 'object') throw new Error('Conditional fields must export an object schema.');
		const required = (fields: readonly string[]) => ({ type: 'object', required: [...fields] });
		return { ...exported, allOf: rules.map(rule => ({
			if: { ...required([rule.field]), ...(Object.hasOwn(rule, 'equals') ? { properties: { [rule.field]: { const: rule.equals } } } : {}) },
			then: rule.alternatives.length === 1 ? required(rule.alternatives[0]!)
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
