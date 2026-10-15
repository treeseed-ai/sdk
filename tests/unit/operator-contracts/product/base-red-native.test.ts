import {testOutputFixture} from './test-output-fixture.ts';
import {verifySdkApprovedTestOutputs,sdkNativeTestCommand,nativeTestReport} from '../../../acceptance/product/release-output.ts';
import {expect,it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as chain from '../../../acceptance/product/test-chain.ts';

function nativeCase(mode:'new-red'|'retained-base-failure'|'no-new-red'|'omitted-base-assertion'){
 const root=mkdtempSync(join(tmpdir(),'sdk-base-replay-fixture-')),work=join(root,'work'),repository=join(root,'repository.git');
 const git=(args:string[])=>execFileSync('/usr/bin/git',['-C',work,...args],{encoding:'utf8',timeout:5000,env:{PATH:'/usr/bin:/bin',LANG:'C',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}}).trim();
 const commit=(message:string)=>{git(['add','.']);git(['-c','user.name=Native BASE fixture','-c','user.email=fixture@example.invalid','commit','-qm',message]);return git(['rev-parse','HEAD']);};
 try{
  mkdirSync(work);git(['init','--template=']);mkdirSync(join(work,'src'));mkdirSync(join(work,'tests'));
  const vitest=import.meta.resolve('vitest').replace(/dist\/index\.js$/u,'vitest.mjs');
  writeFileSync(join(work,'package.json'),JSON.stringify({name:'native-base-proof',version:'1.0.0',private:true,type:'module',scripts:{build:'node --check src/product.ts','test:contracts':'node '+new URL(vitest).pathname+' run --config ./vitest.contracts.config.ts'}}));
  writeFileSync(join(work,'package-lock.json'),JSON.stringify({name:'native-base-proof',version:'1.0.0',lockfileVersion:3,requires:true,packages:{'':{name:'native-base-proof',version:'1.0.0'}}}));
  writeFileSync(join(work,'vitest.contracts.config.ts'),"export default {test:{include:['tests/**/*.test.ts'],maxWorkers:1}};\n");
  const header=`import {it,expect} from ${JSON.stringify(import.meta.resolve('vitest'))};import {value} from '../src/product.ts';\n`;
  writeFileSync(join(work,'src/product.ts'),"export function value(){return 'original';}\n");
  writeFileSync(join(work,'tests/baseline.test.ts'),header+(mode==='retained-base-failure'?"it('original invariant',()=>expect(value()).toBe('implemented'));\n":"it('original invariant',()=>expect(typeof value()).toBe('string'));\n"));const base=commit('Controlled frozen BASE');
  if(mode==='omitted-base-assertion')writeFileSync(join(work,'tests/baseline.test.ts'),header+"it('substituted original name',()=>expect(typeof value()).toBe('string'));\n");
  writeFileSync(join(work,'tests/intent.test.ts'),header+(mode==='no-new-red'?"it('new approved intent',()=>expect(typeof value()).toBe('string'));\n":"it('new approved intent',()=>expect(value()).toBe('implemented'));\n"));const tester=commit('Controlled test-only candidate');
  writeFileSync(join(work,'src/product.ts'),"export function value(){return 'implemented';}\n");const engineer=commit('Controlled descendant implementation');git(['clone','--bare','--no-local',work,repository]);
  const inspect:unknown=Reflect.get(chain,'verifySdkBaseRed');expect(inspect).toBeTypeOf('function');
  if(typeof inspect!=='function')throw new Error('Independent frozen BASE replay is missing');
  if(mode==='no-new-red'||mode==='omitted-base-assertion'){let failure:unknown;try{Reflect.apply(inspect,undefined,[repository,base,tester,engineer]);}catch(error){failure=error;}expect(failure).toMatchObject({cause:{failure:{message:expect.stringContaining(mode==='no-new-red'?'a nonzero command or unchanged BASE failure is not intended test-first RED':'original BASE assertion omitted')}}});return;}
  let proof;try{proof=Reflect.apply(inspect,undefined,[repository,base,tester,engineer]);}catch(error){const original=error as {cause?:{failure?:Error;observations?:Array<{command:string;status:number;stderr:string;stdout:string}>}};console.error(JSON.stringify({nativeBaseFailure:original.cause?.failure?.message,observations:original.cause?.observations?.map(o=>({command:o.command,status:o.status,stderr:o.stderr.slice(-1800),stdout:o.stdout.slice(-1200)}))}));throw error;}
  expect(proof).toMatchObject({base,tester,engineer,introducedFailures:['tests/intent.test.ts\0new approved intent'],unrelatedBaseFailures:mode==='retained-base-failure'?['tests/baseline.test.ts\0original invariant']:[]});
  expect(proof.observations.filter((o:{command:string})=>o.command==='npm run test:contracts -- --reporter=default --reporter=json').map((o:{status:number})=>o.status)).toEqual([mode==='retained-base-failure'?1:0,1,0]);
  expect(proof.approved).toHaveLength(1);
  if(mode==='new-red'){
   const native=(commit:string)=>proof.observations.find((o:{commit:string;command:string})=>o.commit===commit&&o.command===sdkNativeTestCommand)!;
   const red=native(tester),green=native(engineer);
   const actor=testOutputFixture('native-tester',tester,'failed',red.stdout,red.stderr,Math.ceil((Date.parse(red.completedAt)-Date.parse(red.startedAt))/1000));
   const implementer=testOutputFixture('native-engineer',engineer,'passed',green.stdout,green.stderr,Math.ceil((Date.parse(green.completedAt)-Date.parse(green.startedAt))/1000));
   const replay={redAssertions:proof.redAssertions,greenAssertions:proof.greenAssertions};
   const verify=(...args:unknown[])=>Reflect.apply(verifySdkApprovedTestOutputs,undefined,args);
   const input=[actor.participant,implementer.participant,[actor.event,implementer.event],tester,engineer,proof.approved];
   verify(...input,replay);const retained=structuredClone({input,replay});
   const substituted=structuredClone(replay);substituted.redAssertions.get(proof.introducedFailures[0])!.status='passed';
   expect(()=>verify(...input,substituted)).toThrow('ACCEPTANCE_SDK_APPROVED_TESTS');
   expect({input,replay}).toEqual(retained);verify(...input,replay);
  }
expect(git(['rev-parse','HEAD'])).toBe(engineer);
  console.log(JSON.stringify({nativeBaseReplay:true,base,tester,engineer,introducedFailures:proof.introducedFailures,observations:proof.observations.map(({stdout,stderr,...o}:{stdout:string;stderr:string})=>o)}));
 }finally{rmSync(root,{recursive:true,force:true});}
}
it('native frozen BASE replay distinguishes a new approved assertion RED from original failures and proves identical Engineer GREEN',()=>nativeCase('new-red'));
it('native frozen BASE replay retains unrelated original assertion failures separately from new approved RED',()=>nativeCase('retained-base-failure'));
it('native frozen BASE replay rejects an all-green Tester candidate without a new failing approved assertion',()=>nativeCase('no-new-red'));
it('native frozen BASE replay denies omitted original passing assertion identities before unchanged retry',()=>nativeCase('omitted-base-assertion'));
