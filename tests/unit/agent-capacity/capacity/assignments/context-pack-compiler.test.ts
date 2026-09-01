import { describe,expect,it } from 'vitest';
import { compileAssignmentContextPack } from '../../../../../src/agent-capacity/contracts/capacity/assignments/context-pack-compiler.ts';

const source=(id:string,required:boolean,amount:number,priority=50)=>({source:{id,layer:'core' as const,kind:'file',teamId:'team',projectId:'project',path:id,digest:`sha256:${'a'.repeat(64)}`,required,metadata:{}},measurement:{unit:'tokens' as const,amount,provenance:'test'},priority});

describe('assignment context pack compiler',()=>{
	it('preserves mandatory sources and summarizes preferred overflow deterministically',()=>{
		const pack=compileAssignmentContextPack({assignmentId:'assignment',capacity:{mode:'bounded',measurement:'tokens',defaultInitial:10,maximum:20,reservedOutput:2,transportPayloadBytes:1000,measurementProvenance:{provider:'test-provider',implementation:'test',version:null}},candidates:[source('required',true,7),{...source('preferred',false,8),summaryMeasurement:{unit:'tokens',amount:3,provenance:'test-summary'}}]});
		expect(pack.sources.map(({id,disposition})=>({id,disposition}))).toEqual([{id:'required',disposition:'included'},{id:'preferred',disposition:'summarized'}]);
		expect(pack.totals.tokens).toBe(10);
	});
	it('expands the initial allowance for mandatory context without exceeding the advertised maximum',()=>{
		const pack=compileAssignmentContextPack({assignmentId:'assignment',capacity:{mode:'bounded',measurement:'tokens',defaultInitial:5,maximum:10,reservedOutput:1,transportPayloadBytes:1000,measurementProvenance:{provider:'test-provider',implementation:'test',version:null}},candidates:[source('required',true,6)]});
		expect(pack.totals.tokens).toBe(6);
	});
	it('rejects an offer that cannot fit mandatory context within its maximum and output reserve',()=>expect(()=>compileAssignmentContextPack({assignmentId:'assignment',capacity:{mode:'bounded',measurement:'tokens',defaultInitial:5,maximum:10,reservedOutput:2,transportPayloadBytes:1000,measurementProvenance:{provider:'test-provider',implementation:'test',version:null}},candidates:[{...source('required',true,9),mandatory:true}]})).toThrow(/Mandatory context/u));
	it('records deduplicated sources as explicit omissions',()=>{
		const pack=compileAssignmentContextPack({assignmentId:'assignment',capacity:{mode:'bounded',measurement:'tokens',defaultInitial:10,maximum:20,reservedOutput:2,transportPayloadBytes:1000,measurementProvenance:{provider:'test-provider',implementation:'test',version:null}},candidates:[source('core',true,5),{...source('activity-copy',false,5),omissionReason:'duplicate_of:core'}]});
		expect(pack.sources).toContainEqual(expect.objectContaining({id:'activity-copy',disposition:'omitted',reason:'duplicate_of:core',measurement:expect.objectContaining({amount:0})}));
	});
});
