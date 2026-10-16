import {expect,it} from 'vitest';
import * as proof from '../../../acceptance/product/test-chain.ts';
import {documentationExamples} from './documentation-examples-fixture.ts';

it('requires literal normalized selections both omitted planning states generated command examples and API-only provenance in visible SDK reference documentation',()=>{
 const verify=Reflect.get(proof,'verifySdkDocumentationExamples');
 expect(typeof verify).toBe('function');if(typeof verify!=='function')throw new Error('SDK documentation example verification is missing');
 const exact=[documentationExamples()],held=[...exact];verify(exact);expect(exact).toEqual(held);
 verify([exact[0]+'\nThe SDK computes neither intentDigest nor preflightDigest.\nCaller-authored executionPlanId is not accepted.\n']);
 const mutations=[
  (s:string)=>s+'\nThe SDK computes intentDigest and preflightDigest before transport.\n',
  (s:string)=>s+'\nCaller-authored executionPlanId is accepted as caller input.\n',
  (s:string)=>'# decisionIds planningOnly workdays plan workdays schedules start intentDigest preflightDigest executionPlanId capacityPlanId executionInputId demandSetId',
  (s:string)=>'<!-- '+s+' -->',
  (s:string)=>s.replace('trsd workdays plan --decision Z,a --decision A','trsd workdays plan'),
  (s:string)=>s.replace('trsd workdays schedules start --decision Z --decision a,A','trsd workdays schedules start'),
  (s:string)=>s.replace("decisionIds: ['A', 'Z', 'a']","decisionIds: ['Z', 'A', 'a']"),
  (s:string)=>s.replace("decisionIds: ['A', 'Z', 'a']","decisionIds: ['A', 'Z', 'other']"),
  (s:string)=>s.replace("decisionIds: [' Z ', 'a', ' A']","decisionIds: ['A', 'Z', 'a']"),
  (s:string)=>s.replace('planningOnly: true','planningOnly: true, decisionIds: []'),
  (s:string)=>s.replace('planningOnly: false','planningOnly: true'),
  (s:string)=>s.replace('API alone computes intentDigest and preflightDigest and owns persistence','SDK computes intentDigest and preflightDigest and owns persistence'),
  (s:string)=>s.replace('are rejected before transport','are accepted as caller input').replace('are invalid and must be rejected','are accepted'),
  ...['executionPlanId','capacityPlanId','executionInputId','demandSetId'].map(field=>(s:string)=>s.replaceAll(field,'unrelatedField')),
 ];
 for(const [index,mutate]of mutations.entries()){const changed=[mutate(exact[0]!)],before=[...changed];expect(()=>verify(changed),String(index)).toThrow('ACCEPTANCE_SDK_DOCUMENTATION');expect(changed).toEqual(before);verify(exact);}
 for(const invalid of [[],[''],[undefined],null,{},'instructions'])expect(()=>verify(invalid)).toThrow('ACCEPTANCE_SDK_DOCUMENTATION');
});
