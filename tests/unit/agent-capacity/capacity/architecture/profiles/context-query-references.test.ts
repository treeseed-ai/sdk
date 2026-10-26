import { describe, expect, it } from 'vitest';
import { validateAgentDefinitionModel } from '../../../../../../src/agent-capacity/validation/agent-definition-schema.ts';
import { describeContentFrontmatterSchema, validatePortableContentData } from '../../../../../../src/content/validation/index.ts';
import { exportSchemaConstraints } from '../../../../../../src/content/validation/schema-constraints.ts';
import { zodToJsonSchema } from 'zod-to-json-schema';

const query = { id: 'portfolio/related-objectives', revision: 2 };
const set = { id: 'portfolio/prior-experience', revision: 3 };
const activity = {
	handler: 'configured/workload', permissions: { content: { read: ['objective', 'note'], write: [] }, tools: [] },
	prompt: { system: 'Read the authorized objective and relevant prior experience before working.' },
};
function definition(profile = 'acting', references: Record<string, unknown> = {}) {
	return { schemaVersion: 'treeseed.agent/v1', id: 'portfolio/renamed-contributor', name: 'Portfolio Contributor',
		agentClass: 'contributor', groupIds: ['portfolio-runtime'], purpose: 'Advance the shared project objective.',
		responsibilities: ['Use relevant governed context.'], capabilities: ['implementation'],
		context: { include: ['project-objectives'] }, contextQueryRefs: [query], contextQuerySetRefs: [set],
		activityProfiles: { [profile]: { ...activity, ...references } } };
}

describe('governed agent context query references', () => {
	it.each(['planning', 'estimating', 'acting', 'reviewing', 'reporting', 'chat'])('retains exact global and %s query references through public validation', profile => {
		const value = definition(profile, { contextQueryRefs: [query], contextQuerySetRefs: [set] }), before = structuredClone(value);
		expect(validateAgentDefinitionModel(value)).toMatchObject({ ok: true, data: value });
		expect(validatePortableContentData('agent', value)).toMatchObject({ ok: true, data: value });
		expect(value).toEqual(before);
	});
	it('exports exact versioned references for machine authoring at both scopes', () => {
		const schema = zodToJsonSchema(describeContentFrontmatterSchema('agent'), { $refStrategy: 'none', postProcess: exportSchemaConstraints });
		const references = { type: 'array', uniqueItems: true, items: { type: 'object', additionalProperties: false,
			required: ['id', 'revision'], properties: { id: { type: 'string', minLength: 1 }, revision: { type: 'integer', minimum: 0, exclusiveMinimum: true } } } };
		expect(schema).toMatchObject({ properties: { contextQueryRefs: references, contextQuerySetRefs: references,
			activityProfiles: { properties: { acting: { properties: { contextQueryRefs: references, contextQuerySetRefs: references } } } } } });
	});
	for (const field of ['contextQueryRefs', 'contextQuerySetRefs']) it(`rejects malformed and duplicate ${field} at global and profile scopes`, () => {
		for (const invalid of [null, 'query', [null], [{}], [{ id: '', revision: 1 }], [{ id: 'query' }],
			...[0, -1, 1.5, '1', null].map(revision => [{ id: 'query', revision }]),
			[{ ...query, commit: 'a'.repeat(40) }], [query, { revision: query.revision, id: query.id }]]) {
			const global = { ...definition(), [field]: invalid }, scoped = definition('acting', { [field]: invalid });
			for (const value of [global, scoped]) {
				expect(validateAgentDefinitionModel(value).ok, JSON.stringify(value)).toBe(false);
				expect(validatePortableContentData('agent', value).ok).toBe(false);
			}
		}
	});
});
