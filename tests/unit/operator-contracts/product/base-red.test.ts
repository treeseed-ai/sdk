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
