import { describe, expect, it } from 'vitest';
import { describeContentFrontmatterSchema } from '../../src/content/validation/content-model-schemas.ts';
import { verifyAgentContentSchema } from '../../src/platform/agent-schema-verification.ts';

const models = { Book: 'book', Knowledge: 'knowledge', Objective: 'objective',
	Discussion: 'discussion', DiscussionMessage: 'discussion_message' } as const;

const matching = () => ({ $defs: Object.fromEntries(Object.entries(models).map(([name, model]) => {
	const schema = describeContentFrontmatterSchema(model);
	const shape = ('shape' in schema ? schema.shape : {}) as Record<string, { isOptional(): boolean }>;
	return [name, { properties: Object.fromEntries(Object.keys(shape).map((key) => [key, {}])),
		required: Object.entries(shape).filter(([, field]) => !field.isOptional()).map(([key]) => key) }];
})) });

describe('Platform agent content schema verification', () => {
	it('accepts the SDK field and required-field contract', () => {
		expect(verifyAgentContentSchema(matching())).toEqual([]);
	});
	it('detects drift in fields, required fields, and constants', () => {
		const document = matching();
		delete document.$defs.Book.properties.revision;
		document.$defs.Knowledge.required = [];
		document.$defs.Book.properties.schemaVersion = { const: 'treeseed.book/v99' };
		expect(verifyAgentContentSchema(document).map((entry) => entry.code)).toEqual(expect.arrayContaining([
			'agent_schema_fields_mismatch', 'agent_schema_required_mismatch', 'agent_schema_constant_mismatch',
		]));
	});
});
