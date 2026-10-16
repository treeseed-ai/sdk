import{expect,it}from'vitest';
import*as source from'../../../acceptance/product/research-source.ts';

it('proves prohibited SDK caller fields absent from the actual complete intent declaration instead of accepting narrative keywords or unrelated receipts',()=>{
 const fields=Reflect.get(source,'declaredSdkResearchIntentFields') as ((value:string)=>string[])|undefined;
 expect(fields,'request-boundary absence requires parsed declaration evidence').toBeTypeOf('function');if(!fields)return;
 const members=['schemaVersion','teamId','profileId','projects','executionMode','startsAt','planningOnly','proposalIds','decisionIds','agentSelection','allocation'];
 const declaration='export interface WorkdayIntent { '+members.map(name=>name+'?: unknown;').join(' ')+' }';
 expect(fields(declaration)).toEqual(members);expect(fields('// executionPlanId capacityPlanId executionInputId demandSetId\n'+declaration+'\ninterface ApiReceipt { capacityPlanId: string; }')).toEqual(members);
 for(const name of ['executionPlanId','capacityPlanId','executionInputId','demandSetId']){
  for(const member of [name+': string;',JSON.stringify(name)+'?: string;'])expect(()=>fields(declaration.replace(' }',' '+member+' }'))).toThrow('ACCEPTANCE_SDK_RESEARCH_INTENT');
 }
 for(const denied of ['', 'WorkdayIntent decisionIds forbidden fields absent', 'export type WorkdayIntent = Record<string,unknown>;',declaration+'\ninterface WorkdayIntent { extra: string; }',declaration.replace('WorkdayIntent {','WorkdayIntent extends Other {'),declaration.replace(' }',' [field: string]: unknown; }'),declaration.replace(' }',' '+members[0]+': string; }'),declaration.replace('decisionIds?: unknown;',''),declaration.replace(' }',' ["capacity"+"PlanId"]: string; }'),declaration.replace(' }',' unfinished')])expect(()=>fields(denied)).toThrow('ACCEPTANCE_SDK_RESEARCH_INTENT');
});
