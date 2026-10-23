import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import * as runtime from '../../../acceptance/product/intent-runtime.ts';
import {expect,it} from 'vitest';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {ControlPlaneClient} from '@treeseed/sdk/control-plane-client';
import {CONTROL_PLANE_OPERATIONS} from '@treeseed/sdk/operator-contracts';
import * as replay from '../../../acceptance/product/base-red.ts';

it('native product inspection uses actual built public SDK exports and refuses hidden retired intent fields through the shared normalizer',async()=>{
 const inspect:unknown=Reflect.get(replay,'verifySdkIntentRuntime');expect(inspect).toBeTypeOf('function');if(typeof inspect!=='function')throw new Error('Independent public SDK product inspection is missing');
 // This control identifies the actual product state; it is not a passing SDK
 // product receipt. The inspector itself uses real disposable loopback HTTP.
 let calls=0;const client=new ControlPlaneClient({profile:{serverId:'local',label:'Local',baseUrl:'http://127.0.0.1:1'},fetchImpl:async()=>{calls++;return new Response(JSON.stringify({data:{}}),{headers:{'content-type':'application/json'}});}});
 const intent={profileId:'default',projects:['sdk'],groupIds:['portfolio-runtime'],startsAt:'2030-01-01T00:00:00Z',durationSeconds:600};Object.defineProperty(intent,'executionPlanId',{value:undefined,enumerable:false});
 try{await client.invoke(CONTROL_PLANE_OPERATIONS.workdays.preflight,{path:{teamId:'team'},query:{},body:intent});}catch{/* Original public rejection is the control observation. */}
 expect(calls).toBe(0);
 const result=await Reflect.apply(inspect,undefined,[fileURLToPath(new URL('../../../../',import.meta.url))]);
 expect(result.failures).toEqual([]);expect(result.normalizationPathFailures).toEqual([]);expect(result.directNormalizationFailures).toEqual([]);
 expect(result.cleanupConfirmed).toBe(true);expect(result.checks).toBeGreaterThan(100);
 console.log(JSON.stringify({sdkProductInspectorNative:{checks:result.checks,failures:result.failures,cleanupConfirmed:result.cleanupConfirmed},actualHiddenRetiredFieldTransmitted:false,managedProductPassed:false}));
});

it('rejects missing or relative built SDK custody before any product transport',async()=>{
 const inspect:unknown=Reflect.get(replay,'verifySdkIntentRuntime');expect(inspect).toBeTypeOf('function');if(typeof inspect!=='function')throw new Error('Independent public SDK product inspection is missing');
 for(const root of ['', '.', 'relative', '/missing-sdk-native-product-custody'])await expect(Reflect.apply(inspect,undefined,[root])).rejects.toThrow('ACCEPTANCE_SDK_INTENT_PRODUCT');
});

it('native owning SDK normalizer execution is measured exactly once across denial interruption concurrent observation refusal and clean reacquisition without altering compiled assets',async()=>{
 const Constructor=Reflect.get(runtime,'SdkIntentNormalizerObservation') as (new(root:string)=>{start():Promise<void>;read():Promise<number>;close():Promise<void>})|undefined;expect(Constructor).toBeTypeOf('function');if(!Constructor)throw new Error('Native normalization-path resource missing');
 const root=fileURLToPath(new URL('../../../../',import.meta.url)),asset=resolve(root,'dist/operator-contracts/workday-lifecycle.js'),held=readFileSync(asset),first=new Constructor(root),competing=new Constructor(root);
 const manifest=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8'));const publicContracts=await import(pathToFileURL(resolve(root,manifest.exports['./operator-contracts'].default)).href) as typeof import('@treeseed/sdk/operator-contracts');const normalizeWorkdayIntent=publicContracts.normalizeWorkdayIntent;
 const input={schemaVersion:'treeseed.workday-intent/v1' as const,teamId:'team',profileId:'default',projects:['sdk'],startsAt:'2030-01-01T00:00:00Z',durationSeconds:600,decisionIds:[' b ','A']};const original=structuredClone(input);
 try{await first.start();expect(await first.read()).toBe(0);expect(normalizeWorkdayIntent(input).decisionIds).toEqual(['A','b']);expect(await first.read()).toBe(1);
  await expect(competing.start()).rejects.toThrow('ACCEPTANCE_SDK_NORMALIZATION_PATH');expect(await first.read()).toBe(0);
  expect(()=>normalizeWorkdayIntent({...input,decisionIds:[]})).toThrow();expect(await first.read()).toBe(1);
  await first.close();await competing.start();expect(await competing.read()).toBe(0);normalizeWorkdayIntent(input);expect(await competing.read()).toBe(1);
 }finally{await first.close();await competing.close();}
 const resumed=new Constructor(root);try{await resumed.start();expect(await resumed.read()).toBe(0);}finally{await resumed.close();}
 expect(input).toEqual(original);expect(readFileSync(asset)).toEqual(held);
});
