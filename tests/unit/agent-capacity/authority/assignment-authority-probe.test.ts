import { describe,expect,it } from 'vitest';
import { evaluateAssignmentAuthorityProbe } from '../../../../src/agent-capacity/authority/assignment-authority-probe.ts';

describe('assignment authority probe',()=>{
	it('proves five concrete denials against an exact frozen profile snapshot',()=>{
		const result=evaluateAssignmentAuthorityProbe({ assignmentId:'assignment-1',activityType:'planning',definitionRevision:'a'.repeat(40),
			contextQueryRefs:[{id:'context',revision:1}],instructionTemplateRefs:[{id:'plan',revision:1}],
			permissions:{ content:{ decision:{ operations:['read'] } },repository:{ writePaths:[],forbiddenPaths:['.github/**'] } },
			tools:{ allowed:['treeseed.content.read'] },signals:{ publishes:['evidence-ready'] },outputContract:{ modelMutations:['note:create'] },
			branchPolicy:{ kind:'staging-content',base:'staging' },upstreamMutationPolicy:'denied' });
		expect(result.passed).toBe(true);
		expect(result.denials).toEqual(expect.arrayContaining([
			expect.objectContaining({category:'model',denied:true}),expect.objectContaining({category:'tool',denied:true}),
			expect.objectContaining({category:'path',denied:true}),expect.objectContaining({category:'branch',denied:true}),
			expect.objectContaining({category:'governance',denied:true}),
		]));
		expect(result.selection).toMatchObject({ requestedType:'planning',definitionRevision:'a'.repeat(40) });
	});

	it('fails closed if the supposedly forbidden path is writable',()=>{
		const result=evaluateAssignmentAuthorityProbe({ assignmentId:'assignment-1',activityType:'acting',definitionRevision:'b'.repeat(40),
			contextQueryRefs:[],instructionTemplateRefs:[],permissions:{ content:{},repository:{writePaths:['.github/**']} },tools:{allowed:[]},
			signals:{},outputContract:{},branchPolicy:{kind:'assignment-feature'},upstreamMutationPolicy:'checkpoint-only' });
		expect(result.passed).toBe(false);
		expect(result.denials.find((probe)=>probe.category==='path')).toMatchObject({denied:false});
	});
});
