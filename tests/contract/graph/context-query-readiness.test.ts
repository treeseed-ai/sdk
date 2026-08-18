import { describe,expect,it } from 'vitest';
import { contextQueryReadiness,type ContextQueryCheck } from '../../../src/graph/context-query-readiness.ts';

const definition = {kind:'query-set' as const,id:'editorial',revision:2,commit:'a'.repeat(40)};
const check:ContextQueryCheck = {
	id:'check-a',teamId:'team-a',projectId:'project-a',testId:'test-a',testRef:'fixture:test-a',definition,
	status:'passing',checkedAt:'2026-08-13T20:00:00.000Z',expiresAt:'2026-08-14T20:00:00.000Z',latencyMs:100,
	stats:{itemCount:1,bytes:10,estimatedTokens:5,reportedTokens:5,identities:['knowledge:a'],relations:[]},
	assertions:[],resultDigest:'digest-a',
};

describe('context query readiness',()=>{
	it('distinguishes an unchecked definition from a stale prior check',()=>{
		expect(contextQueryReadiness({check:null,definition})).toEqual({status:'unchecked',selectable:false,reason:'never_checked'});
	});

	it('makes only an exact fresh passing check selectable',()=>{
		expect(contextQueryReadiness({check,definition,now:new Date('2026-08-14T00:00:00.000Z')})).toMatchObject({status:'passing',selectable:true,reason:'fresh_passing_check'});
	});

	it('treats expired or different definition revisions as stale',()=>{
		expect(contextQueryReadiness({check,definition,now:new Date('2026-08-15T00:00:00.000Z')})).toMatchObject({status:'stale',selectable:false,reason:'check_expired'});
		expect(contextQueryReadiness({check,definition:{...definition,revision:3}})).toMatchObject({status:'stale',selectable:false,reason:'definition_changed'});
	});

	it('keeps the query revision selectable across unrelated repository commits',()=>{
		expect(contextQueryReadiness({check,definition:{...definition,commit:'b'.repeat(40)},now:new Date('2026-08-14T00:00:00.000Z')}))
			.toMatchObject({status:'passing',selectable:true,reason:'fresh_passing_check'});
	});

	it('keeps a fresh failed check unselectable',()=>{
		expect(contextQueryReadiness({check:{...check,status:'failing'},definition,now:new Date('2026-08-14T00:00:00.000Z')})).toMatchObject({status:'failing',selectable:false,reason:'assertions_failed'});
	});
});
