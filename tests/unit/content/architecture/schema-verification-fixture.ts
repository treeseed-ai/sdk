import { describeContentFrontmatterSchema } from '../../../../src/content/validation/content-model-schemas.ts';
import { zodToJsonSchema } from 'zod-to-json-schema';

type Definition = { properties: Record<string, Record<string, unknown>>; required: string[];
	[key: string]: unknown };
export type Declaration = { $defs: Record<string, Definition | boolean>; [key: string]: unknown };

// This intentionally incomplete, implementation-generated input reproduces the
// existing false equivalence claim. It is NOT the canonical architecture oracle.
export function partialSdkDocument(): Declaration {
	const models = { Book: 'book', Knowledge: 'knowledge', Objective: 'objective',
		Discussion: 'discussion', DiscussionMessage: 'discussion_message' } as const;
	return { $defs: Object.fromEntries(Object.entries(models).map(([name, model]) => {
		const generated = zodToJsonSchema(describeContentFrontmatterSchema(model),
			{ name, $refStrategy: 'none' }) as { definitions?: Record<string, Definition> };
		return [name, generated.definitions![name]!];
	})) };
}

export function definition(document: Declaration, name: string): Definition {
	const value = document.$defs[name];
	if (!value || typeof value !== 'object') throw new Error(`Missing fixture definition ${name}`);
	return value;
}
