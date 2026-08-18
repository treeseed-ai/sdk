import { describe,expect,it } from 'vitest';
import { buildBuiltinModelRegistry } from '../../../src/model-registry/build-builtin-model-registry.ts';
import { validateContentFrontmatter } from '../../../src/content/validation/content-model-schemas.ts';

describe('agent operational portable content',() => {
	it('validates the complete SDK-owned model family',() => {
		const base = { id:'item-a',title:'Item A',status:'active',teamId:'team-a',projectId:'project-a',createdAt:'2026-08-13T00:00:00.000Z' };
		const examples = {
			agent_context_query:{ id:'query-a',title:'Runtime context',description:'Load runtime evidence.',revision:1,maturity:'validated',purpose:'review',query:'runtime evidence',target:{ kind:'graph',models:['decision'] },resultLimit:8,contextBudget:{ maxItems:12 },tokenBudget:2000 },
			agent_context_query_set:{ id:'set-a',title:'Review context',description:'Queries for review.',revision:1,queryRefs:[{ id:'query-a',revision:1 }] },
			agent_instruction_template:{ id:'template-a',title:'Review instructions',description:'Shared review rules.',revision:1,kind:'summary',instructions:'Inspect exact evidence.',outputSkeleton:'## Findings' },
			discussion_topic:{ id:'topic-a',title:'Runtime',description:'Runtime coordination.',slug:'runtime',groupIds:['group:project'] },
			assignment_plan:{ ...base,status:'ready',revision:1,objective:'Complete the governed slice.',remaining:[{ id:'step-a',title:'Implement',description:'Implement it.' }] },
			assignment_status:{ ...base,status:'running',sequence:0,phase:'implementation' },
			assignment_summary:{ ...base,status:'completed',summary:'Completed the governed slice.',performance:{ outcome:'met' } },
			agent_evaluation:{ ...base,agentId:'agent-a',agentDefinitionRef:{ id:'agent-a',revision:2 },activityProfile:'acting',contextQueryRefs:[{ id:'query-a',revision:1 }],instructionTemplateRefs:[{ id:'template-a',revision:1 }],evaluatorId:'reviewer-a',outcome:'passed',criteria:[{ id:'scope',outcome:'passed',evidenceRefs:['receipt-a'] }] },
		} as const;
		for (const [model,value] of Object.entries(examples)) expect(validateContentFrontmatter(model as never,value),model).toMatchObject({ ok:true });
	});

	it('enforces immutable revisions and append-only status lineage',() => {
		expect(validateContentFrontmatter('agent_context_query_set',{ id:'set',title:'Set',description:'Set.',revision:1,queryRefs:['query-a'] })).toMatchObject({ ok:false });
		const base={ id:'status-2',title:'Status',status:'running',teamId:'team-a',projectId:'project-a',assignmentId:'assignment-a',createdAt:'2026-08-13T00:00:00Z',sequence:1,phase:'work' };
		expect(validateContentFrontmatter('assignment_status',base)).toMatchObject({ ok:false,diagnostics:expect.arrayContaining([expect.objectContaining({ field:'previousStatusRef' })]) });
		expect(validateContentFrontmatter('assignment_status',{ ...base,previousStatusRef:{ id:'status-1',revision:1 } })).toMatchObject({ ok:true });
	});

	it('registers every model with content storage and graph metadata',() => {
		const registry = buildBuiltinModelRegistry('/tmp/project');
		for (const model of ['agent_context_query','agent_context_query_set','agent_instruction_template','discussion_topic','assignment_plan','assignment_status','assignment_summary','agent_evaluation'] as const) {
			expect(registry[model]).toMatchObject({ name:model,storage:'content',operations:expect.arrayContaining(['read','create','update']),graph:expect.any(Object) });
		}
	});
});
