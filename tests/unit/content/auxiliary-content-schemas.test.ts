import { describe, expect, it } from 'vitest';
import { describeContentFrontmatterContract, describeContentFrontmatterSchema, validateContentFrontmatter } from '../../../src/content/validation/content-model-schemas.ts';
import { validatePortableContentData } from '../../../src/content/validation/portable-content-data.ts';
import { buildBuiltinModelRegistry } from '../../../src/entrypoints/models/model-registry.ts';

describe('auxiliary content schemas', () => {
	it('derives machine-readable field and enum guidance from the canonical schema', () => {
		const contract = describeContentFrontmatterContract('question');
		expect(contract.fields.title).toMatchObject({ type: 'string', required: true });
		expect(contract.fields.status).toMatchObject({
			type: 'string', required: false,
			values: ['live', 'in progress', 'exploratory', 'planned', 'speculative'],
		});
		expect(contract.fields.question_type).toMatchObject({
			type: 'string', values: ['research', 'implementation', 'strategy', 'evaluation', 'knowledge-gap'],
		});
	});
	it('validates agent tests with field-addressable diagnostics', () => {
		expect(validateContentFrontmatter('agent_test', {
			id: 'agent-test:reviewer', agent: 'reviewer', kind: 'handler', trigger: {}, expect: {}, groupIds: [],contextQueryRefs:['query:review'],
		})).toMatchObject({ ok: true });
		expect(validateContentFrontmatter('agent_test', {
			id: 'agent-test:reviewer', agent: '', kind: 'unknown',
		})).toMatchObject({ ok: false, diagnostics: expect.arrayContaining([
			expect.objectContaining({ field: 'agent' }), expect.objectContaining({ field: 'kind' }),
		]) });
	});

	it('requires exact bounded context-query test expectations',() => {
		expect(validateContentFrontmatter('agent_test',{ id:'context-test',agent:'reviewer',kind:'context-query',queryRef:{ id:'query-a',revision:2 },testRef:'fixture:review',expectedIdentities:['decision:a'],expectedRelations:['references'],expectedPaths:['content/decisions/a.mdx'],expectedSchemaVersions:['treeseed.decision/v1'],resultBounds:{ min:1,max:4 },budget:{ maxContextItems:8,maxTokens:1200 } })).toMatchObject({ ok:true });
		expect(validateContentFrontmatter('agent_test',{ id:'context-test',agent:'reviewer',kind:'context-query' })).toMatchObject({ ok:false,diagnostics:expect.arrayContaining([expect.objectContaining({ field:'queryRef' }),expect.objectContaining({ field:'budget' })]) });
	});

	it('requires one exact query-set revision for composition tests',() => {
		expect(validateContentFrontmatter('agent_test',{ id:'set-test',agent:'reviewer',kind:'context-query-set',querySetRef:{ id:'set-a',revision:2 },testRef:'fixture:set',expectedIdentities:[],expectedRelations:[],expectedPaths:[],expectedSchemaVersions:[],resultBounds:{ min:0,max:4 },budget:{ maxContextItems:4,maxTokens:1200 } })).toMatchObject({ ok:true });
		expect(validateContentFrontmatter('agent_test',{ id:'set-test',agent:'reviewer',kind:'context-query-set',queryRef:{ id:'query-a',revision:2 },testRef:'fixture:set',expectedIdentities:[],expectedRelations:[],expectedPaths:[],expectedSchemaVersions:[],resultBounds:{ min:0,max:4 },budget:{ maxContextItems:4,maxTokens:1200 } })).toMatchObject({ ok:false });
	});

	it('validates workday summaries and template products through the portable registry', () => {
		const workday = describeContentFrontmatterSchema('workday').safeParse({
			title: 'Local workday', slug: 'local-workday', workDayId: 'workday-1', reportVersion: 'v1',
			projectId: 'project-1', environment: 'local', workdayState: 'completed', startedAt: '2026-08-12T00:00:00Z',
			generatedAt: '2026-08-12T01:00:00Z', summary: 'Completed one bounded assignment.',
		});
		expect(workday.success).toBe(true);
		const template = validateContentFrontmatter('template_product', {
			slug: 'engineering', title: 'Engineering', description: 'Engineering starter.', summary: 'Starter.', status: 'live',
			category: 'starter', publisher: { id: 'treeseed', name: 'TreeSeed' }, templateVersion: '1.0.0',
			templateApiVersion: 1, minCliVersion: '1.0.0', minCoreVersion: '1.0.0',
			fulfillment: { mode: 'git', source: { kind: 'git', repoUrl: 'https://github.com/treeseed-ai/template-engineering.git', directory: '.', ref: 'main' } },
		});
		expect(template).toMatchObject({ ok: true });
	});

	it('normalizes first-party aliases before portable validation', () => {
		const result = validatePortableContentData('proposal', {
			title: 'Portable proposal', description: 'Valid proposal input.', date: '2026-08-12', status: 'planned',
			summary: 'Camel-case Astro fields use the same portable contract.', proposalType: 'implementation',
			motivation: 'Prevent split schema authority.', primaryContributor: 'self-hosting-architect',
		});
		expect(result).toMatchObject({ ok: true, portable: true });
		expect(validatePortableContentData('proposal', { title: 'Invalid', proposalType: 'Not Portable' })).toMatchObject({
			ok: false, diagnostics: expect.arrayContaining([expect.objectContaining({ field: 'proposal_type' })]),
		});
	});

	it('uses the SDK knowledge contract field names for books and pages', () => {
		expect(validatePortableContentData('book', {
			schemaVersion: 'treeseed.book/v2', id: 'guide', order: 1, slug: 'guide', title: 'Guide',
			description: 'Guide description.', summary: 'Guide summary.', status: 'draft', visibility: 'project',
			groupIds: ['editorial'], relatedBookIds: [], audience: ['developers'],
		})).toMatchObject({ ok: true });
		expect(validatePortableContentData('knowledge', {
			schemaVersion: 'treeseed.knowledge-page/v1', id: 'guide.index', bookId: 'guide', slug: 'index',
			title: 'Guide', summary: 'Guide summary.', status: 'draft', visibility: 'project', groupIds: ['editorial'],
		})).toMatchObject({ ok: true });
	});

	it('requires every built-in content model to have portable Zod validation', () => {
		const contentModels = Object.values(buildBuiltinModelRegistry()).filter((definition) => definition.storage === 'content');
		for (const definition of contentModels) {
			expect(validatePortableContentData(definition.name, {}, buildBuiltinModelRegistry()), definition.name)
				.toMatchObject({ portable: true });
		}
	});

	it('returns exact nested diagnostics for malformed agent definitions', () => {
		const result = validatePortableContentData('agent', {
			id: 'agent:invalid', slug: 'invalid', title: 'Invalid', name: 'Invalid', description: 'Invalid agent.',
			summary: 'Invalid agent.', agentClass: 'engineering', projectAgentClassId: 'engineering',
			projectAgentClassSlug: 'engineering', enabled: true, groupIds: ['agent'],
			identity: { purpose: 'Test validation.', responsibilities: ['Validate'], durableInstructions: 'Validate first.' },
			activityProfiles: { planning: { enabled: true, handler: 'writer', prompt: { system: '' } } },
		});
		expect(result).toMatchObject({
			ok: false,
			portable: true,
			diagnostics: expect.arrayContaining([
				expect.objectContaining({ field: 'activityProfiles.planning.prompt.system', code: 'content_zod_too_small' }),
				expect.objectContaining({ field: 'activityProfiles.planning.branchPolicy', code: 'content_zod_invalid_type' }),
			]),
		});
	});
});
