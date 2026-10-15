import {approvedOutputFixture} from './test-output-fixture.ts';
import {nativeTestReport,verifySdkApprovedTestOutputs} from '../../../acceptance/product/release-output.ts';
import {expect,it} from 'vitest';
import {verifySdkBaseAssertionProgress} from '../../../acceptance/product/base-red.ts';
type Assertion={path:string;status:string};
const original='tests/original.test.ts\0original',added='tests/intent.test.ts\0new intent';
const inputs=()=>({baseline:new Map<string,Assertion>([[original,{path:'tests/original.test.ts',status:'passed'}]]),red:new Map<string,Assertion>([[original,{path:'tests/original.test.ts',status:'passed'}],[added,{path:'tests/intent.test.ts',status:'failed'}]]),green:new Map<string,Assertion>([[original,{path:'tests/original.test.ts',status:'passed'}],[added,{path:'tests/intent.test.ts',status:'passed'}]]),approved:[{path:'tests/intent.test.ts'}]});
it('requires newly failing approved assertions and unchanged full GREEN identities while retaining original BASE failures without input repair',()=>{
 const f=inputs(),held=structuredClone(f);expect(verifySdkBaseAssertionProgress(f.baseline,f.red,f.green,f.approved)).toEqual({introducedFailures:[added],unrelatedBaseFailures:[]});expect(f).toEqual(held);
 const retained=inputs();retained.baseline.get(original)!.status='failed';retained.red.get(original)!.status='failed';expect(verifySdkBaseAssertionProgress(retained.baseline,retained.red,retained.green,retained.approved)).toEqual({introducedFailures:[added],unrelatedBaseFailures:[original]});
 for(const mode of ['empty-base','empty-red','empty-green','omitted-base-assertion','hidden-base-failure','no-new-red','foreign-failure','missing-green','failed-green','renamed-green','undiscovered-approved']){
  const changed=inputs();if(mode==='empty-base')changed.baseline.clear();if(mode==='empty-red')changed.red.clear();if(mode==='empty-green')changed.green.clear();
  if(mode==='omitted-base-assertion')changed.red.delete(original);if(mode==='hidden-base-failure'){changed.baseline.get(original)!.status='failed';}
  if(mode==='no-new-red')changed.red.get(added)!.status='passed';if(mode==='foreign-failure')changed.red.get(original)!.status='failed';
  if(mode==='missing-green')changed.green.delete(added);if(mode==='failed-green')changed.green.get(added)!.status='failed';
  if(mode==='renamed-green'){changed.green.delete(added);changed.green.set(added+' renamed',{path:'tests/intent.test.ts',status:'passed'});}
  if(mode==='undiscovered-approved')changed.approved.push({path:'tests/omitted.test.ts'});
  const before=structuredClone(changed);expect(()=>verifySdkBaseAssertionProgress(changed.baseline,changed.red,changed.green,changed.approved),mode).toThrow('ACCEPTANCE_SDK_BASE_RED');expect(changed).toEqual(before);
 }
});

it('requires independently replayed native assertion identities and statuses to match original protected Tester and Engineer observations without repair',()=>{
 const f=approvedOutputFixture(),replay={redAssertions:nativeTestReport(f.events[0]!.protectedPayload.verificationObservations[0]!.stdout,false),greenAssertions:nativeTestReport(f.events[1]!.protectedPayload.verificationObservations[0]!.stdout,true)};
 const verify=(input:unknown)=>Reflect.apply(verifySdkApprovedTestOutputs,undefined,[f.tester,f.engineer,f.events,f.testerCommit,f.engineerCommit,f.tests,input]);
 const original=structuredClone({f,replay});expect(()=>verify(replay)).not.toThrow();
 for(const phase of ['redAssertions','greenAssertions']as const)for(const mode of ['omitted','extra','path','status']){
  const changed=structuredClone(replay),first=[...changed[phase].keys()][0]!;
  if(mode==='omitted')changed[phase].delete(first);if(mode==='extra')changed[phase].set('extra',{path:'tests/foreign.test.ts',status:'passed'});
  if(mode==='path')changed[phase].get(first)!.path='tests/foreign.test.ts';if(mode==='status')changed[phase].get(first)!.status=changed[phase].get(first)!.status==='passed'?'failed':'passed';
  const held=structuredClone(changed);expect(()=>verify(changed),phase+'/'+mode).toThrow('ACCEPTANCE_SDK_APPROVED_TESTS');expect(changed).toEqual(held);
 }
 for(const malformed of [undefined,null,false,{},[],{redAssertions:replay.redAssertions,greenAssertions:[]}])expect(()=>verify(malformed)).toThrow('ACCEPTANCE_SDK_APPROVED_TESTS');
 expect({f,replay}).toEqual(original);expect(()=>verify(replay)).not.toThrow();
});
