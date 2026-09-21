import { describe, expect, it } from 'vitest';
import { describeContentFrontmatterSchema } from '../../src/content/validation/content-model-schemas.ts';
import { verifyAgentContentSchema } from '../../src/platform/agent-schema-verification.ts';
import { zodToJsonSchema } from 'zod-to-json-schema';

const models = { Book: 'book', Knowledge: 'knowledge', Objective: 'objective',
	Discussion: 'discussion', DiscussionMessage: 'discussion_message' } as const;

const matching = () => ({ $defs: Object.fromEntries(Object.entries(models).map(([name, model]) => {
	const schema = describeContentFrontmatterSchema(model);
	const generated = zodToJsonSchema(schema, { name, $refStrategy: 'none' }) as { definitions?: Record<string, unknown> };
	return [name, generated.definitions?.[name]];
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
	it('detects nested declarative constraint drift', () => {
		const document = matching();
		document.$defs.Knowledge.properties.bookRef.properties.commit.pattern = '^wrong$';
		expect(verifyAgentContentSchema(document).map((entry) => entry.code)).toContain('agent_schema_structure_mismatch');
	});
});
