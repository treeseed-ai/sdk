import {expect,it} from 'vitest';
import {pathToFileURL} from 'node:url';
import * as product from '../../../../acceptance/product/intent-runtime.ts';
const root='/held/sdk',url=pathToFileURL(root+'/dist/operator-contracts/workday-lifecycle.js').href;
const decode=(input:unknown)=>{const fn=Reflect.get(product,'sdkNormalizerCoverageCount');expect(fn).toBeTypeOf('function');if(typeof fn!=='function')throw new Error('Original native normalization-path observation missing');return Reflect.apply(fn,undefined,[root,input]);};
const observation=(count:number)=>({result:[{scriptId:'1',url,functions:[{functionName:'normalizeWorkdayIntent',isBlockCoverage:true,ranges:[{startOffset:10,endOffset:30,count}]}]}]});
it('reads exactly the owning compiled shared normalizer entry count without treating other scripts functions or branch counts as SDK execution proof',()=>{
 expect(decode(observation(1))).toBe(1);expect(decode(observation(0))).toBe(0);expect(decode(observation(2))).toBe(2);
 expect(decode({result:[{...observation(1).result[0],url:'file:///foreign/sdk/dist/operator-contracts/workday-lifecycle.js'}]})).toBe(0);
 expect(decode({result:[{...observation(1).result[0],functions:[{functionName:'unrelated',ranges:[{count:1}]}]}]})).toBe(0);
 const branches=observation(1);branches.result[0]!.functions[0]!.ranges.push({startOffset:20,endOffset:25,count:0});expect(decode(branches)).toBe(1);
});
it('rejects absent malformed duplicate or unmeasured native normalizer entry observations without rewriting the original failure',()=>{
 for(const value of [undefined,null,{},[],{result:null},{result:[]},{result:[...observation(1).result,...observation(1).result]}]){
  const before=structuredClone(value);if(value&&typeof value==='object'&&!Array.isArray(value)&&'result'in value&&Array.isArray(value.result)&&value.result.length===0){expect(decode(value)).toBe(0);}else expect(()=>decode(value)).toThrow();expect(value).toEqual(before);
 }
 for(const count of [-1,1.5,NaN,Infinity,'1',null,undefined]){const value=observation(1);Reflect.set(value.result[0]!.functions[0]!.ranges[0]!,'count',count);const before=structuredClone(value);expect(()=>decode(value)).toThrow();expect(value).toEqual(before);}
});
