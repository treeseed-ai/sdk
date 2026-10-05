import { z } from 'zod';
import type { PostProcessCallback } from 'zod-to-json-schema';

// Zod's exporter cannot infer a custom uniqueness refinement. Register the
// definition created by the owning check, rather than copying field names or
// borrowing assertions from the declaration being verified.
const uniqueDefinitions = new WeakSet<z.ZodTypeDef>();

export function uniqueArray<T extends z.ZodTypeAny>(array: z.ZodArray<T>) {
	const schema = array.superRefine((values, context) => {
		if (new Set(values.map(value => JSON.stringify(value))).size !== values.length) {
			context.addIssue({ code: z.ZodIssueCode.custom, message: 'Values must be unique.' });
		}
	});
	uniqueDefinitions.add(schema._def);
	return schema;
}

export const exportSchemaConstraints: PostProcessCallback = (schema, definition) => {
	if (!uniqueDefinitions.has(definition)) return schema;
	if (!schema || !('type' in schema) || schema.type !== 'array') {
		throw new Error('The unique-array validator must export an array schema.');
	}
	return { ...schema, uniqueItems: true };
};
