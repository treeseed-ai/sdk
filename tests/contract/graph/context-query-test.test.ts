import { describe,expect,it } from 'vitest';
import { executeContextQuerySetTest,executeContextQueryTest } from '../../../src/graph/context-query-test.ts';

describe('context query test execution',()=>{
	it('reports bounded results, provenance identities, relations, latency, and budgets',async()=>{
		const report=await executeContextQueryTest({
			query:{ id:'query-a',revision:2,purpose:'research',query:'agent workday',relations:['references'],resultLimit:3,contextBudget:{maxItems:3},tokenBudget:500 },
			test:{ queryRef:{id:'query-a',revision:2},testRef:'commit-a',expectedIdentities:['objective:a'],expectedRelations:['references'],expectedPaths:['content/objectives/a.mdx'],expectedSchemaVersions:['treeseed.objective/v1'],resultBounds:{min:1,max:3},budget:{maxContextItems:3,maxTokens:500},maxLatencyMs:0.01 },
			execute:async()=>({payload:{seedIds:['objective:a'],totalTokenEstimate:42,includedNodeIds:['objective:a'],nodes:[{node:{id:'objective:a',nodeType:'Objective',path:'content/objectives/a.mdx',data:{frontmatter:{schemaVersion:'treeseed.objective/v1'}}},score:1,depth:0,text:'Goal',tokenEstimate:42,reasons:[],provenance:{seedIds:['objective:a'],viaEdgeTypes:[]}}],edges:[{id:'edge-a',type:'REFERENCES',sourceId:'note:a',targetId:'objective:a'}]}}),
			now:()=>new Date('2026-08-13T20:00:00.000Z'),
		});
		expect(report).toMatchObject({ok:true,status:'passing',phase:'executed',checkedAt:'2026-08-13T20:00:00.000Z',stats:{itemCount:1,estimatedTokens:42,reportedTokens:42,identities:['content/objectives/a.mdx','objective:a'],relations:['references'],paths:['content/objectives/a.mdx'],schemaVersions:['treeseed.objective/v1']}});
		expect(report.assertions).toEqual(expect.arrayContaining([expect.objectContaining({id:'latency-target',gating:false})]));
	});

	it('fails before execution when the immutable query revision differs',async()=>{
		const report=await executeContextQueryTest({query:{id:'query-a',revision:1,purpose:'plan',query:'a'},test:{queryRef:{id:'query-a',revision:2},testRef:'commit-a',expectedIdentities:[],expectedRelations:[],resultBounds:{min:0,max:1},budget:{maxContextItems:1,maxTokens:100},maxLatencyMs:100},execute:async()=>({})});
		expect(report).toMatchObject({ok:false,status:'stale',phase:'identity'});
	});

	it('fails semantic and budget assertions against the returned context pack',async()=>{
		const report=await executeContextQueryTest({
			query:{id:'query-a',revision:1,purpose:'review',query:'evidence'},
			test:{queryRef:{id:'query-a',revision:1},testRef:'commit-a',expectedIdentities:['decision:missing'],expectedRelations:[],resultBounds:{min:1,max:1},budget:{maxContextItems:1,maxTokens:2},maxLatencyMs:500},
			execute:async()=>({nodes:[],edges:[],totalTokenEstimate:3}),
		});
		expect(report).toMatchObject({ok:false,status:'failing',assertions:expect.arrayContaining([
			expect.objectContaining({id:'result-minimum',passed:false}),
			expect.objectContaining({id:'token-budget',passed:false}),
			expect.objectContaining({id:'identity:decision:missing',passed:false}),
		])});
	});

	it('tests an exact query set and deduplicates its composed context',async()=>{
		const report=await executeContextQuerySetTest({
			querySet:{id:'set-a',revision:3,mergePolicy:'append',queryRefs:[{id:'root',revision:1},{id:'children',revision:2}]},
			queries:[
				{id:'root',revision:1,purpose:'research',query:'root'},
				{id:'children',revision:2,purpose:'research',query:'children'},
			],
			test:{querySetRef:{id:'set-a',revision:3},testRef:'fixture:set-a',expectedIdentities:['guide.work','guide.work.agents'],expectedRelations:[],resultBounds:{min:2,max:2},budget:{maxContextItems:2,maxTokens:1000},maxLatencyMs:500},
			execute:async(query)=>({nodes:[{node:{id:query.id === 'root' ? 'guide.work' : 'guide.work.agents',nodeType:'File'},score:1,depth:0}],edges:[],totalTokenEstimate:20}),
			now:()=>new Date('2026-08-13T21:00:00.000Z'),
		});
		expect(report).toMatchObject({ok:true,status:'passing',checkedAt:'2026-08-13T21:00:00.000Z',stats:{itemCount:2},querySetRef:{id:'set-a',revision:3}});
	});
});
