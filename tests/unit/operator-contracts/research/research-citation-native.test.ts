import{declaredSdkResearchIntentFields}from'../../../acceptance/product/research-source.ts';
import {expect,it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,renameSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import * as product from '../../../acceptance/golden-product.ts';

it('native Git resolves actual SDK source citation symbols and bytes from the exact held commit while denying substituted missing and moved evidence before unchanged retry',()=>{
 const resolve=Reflect.get(product,'resolveSdkResearchCitation') as ((root:string,base:string,citation:unknown,symbol:string)=>{source:string;blob:string;sourceSha256:string;symbol:string;line:number})|undefined;
 expect(resolve,'native citation resolution is required').toBeTypeOf('function');if(!resolve)return;
 const root=mkdtempSync(join(tmpdir(),'sdk-research-citation-')),repository=join(root,'source.git'),env={...process.env};for(const name of Object.keys(env))if(name.startsWith('GIT_'))delete env[name];
 const upstream=(args:string[],input?:string)=>execFileSync('git',['--no-replace-objects',...args],{cwd:process.cwd(),env:process.env,input,encoding:'utf8',timeout:30_000,maxBuffer:32*1024*1024}).trim();
 try{
  const base=upstream(['rev-parse','HEAD^{commit}']),tree=upstream(['rev-parse',base+'^{tree}']),objects=[base,tree,...upstream(['ls-tree','-r','-t',base]).split('\n').map(line=>line.match(/^[0-7]{6} (?:tree|blob) ([a-f0-9]{40})\t/u)?.[1]).filter((value):value is string=>Boolean(value))];
  execFileSync('git',['init','--bare',repository],{env,stdio:'pipe',timeout:30_000});
  const pack=execFileSync('git',['--no-replace-objects','pack-objects','--stdout'],{cwd:process.cwd(),env:process.env,input:[...new Set(objects)].join('\n')+'\n',timeout:30_000,maxBuffer:128*1024*1024});
  execFileSync('git',['-C',repository,'index-pack','--stdin'],{env,input:pack,stdio:'pipe',timeout:30_000});writeFileSync(join(repository,'shallow'),base+'\n');
  const sources=[['src/operator-contracts/workday-lifecycle.ts','WorkdayIntent'],['src/entrypoints/clients/control-plane-client.ts','ControlPlaneClient.invoke']] as const;
  const observations=sources.map(([path,symbol])=>{
   const citation='https://github.com/treeseed-ai/sdk/blob/'+base+'/'+path,source=upstream(['cat-file','blob',base+':'+path]),expected=execFileSync('git',['-C',repository,'cat-file','blob',base+':'+path],{env,timeout:30_000});
   const found=resolve(repository,base,citation,symbol);expect(found.source.trim()).toBe(source);expect(found.sourceSha256).toBe(createHash('sha256').update(expected).digest('hex'));expect(found.blob).toBe(upstream(['rev-parse',base+':'+path]));expect(found.symbol).toBe(symbol);expect(found.line).toBeGreaterThan(0);
   expect(resolve(repository,base,citation+'#L'+found.line,symbol)).toEqual(found);
   const reference={store:'git',model:'repository',id:'sdk',repository:'treeseed-ai/sdk',commit:base,path,startLine:found.line,endLine:found.line};
   expect(resolve(repository,base,reference,symbol)).toEqual(found);
   expect(()=>resolve(repository,base,{...reference,startLine:1,endLine:1},symbol)).toThrow('ACCEPTANCE_SDK_RESEARCH_CITATION');
   expect(()=>resolve(repository,base,{...reference,anchor:'L1'},symbol)).toThrow('ACCEPTANCE_SDK_RESEARCH_CITATION');

   expect(()=>resolve(repository,base,citation+'#L1',symbol)).toThrow('ACCEPTANCE_SDK_RESEARCH_CITATION');expect(()=>resolve(repository,base,citation,symbol+'.missing')).toThrow('ACCEPTANCE_SDK_RESEARCH_CITATION');
   expect(()=>resolve(repository,base,citation.replace(base,'a'.repeat(40)),symbol)).toThrow('ACCEPTANCE_SDK_RESEARCH_CITATION');
   return{path,symbol,citation,found};
  });
  for(const path of ['src/operator-contracts/control-plane-operations.ts','src/operator-contracts/canonical-command-tree.ts'])for(const symbol of ['workdays.plan','workdays.schedules.create']){
   const citation='https://github.com/treeseed-ai/sdk/blob/'+base+'/'+path,found=resolve(repository,base,citation,symbol);
   expect(found.symbol).toBe(symbol);expect(found.line).toBeGreaterThan(0);expect(resolve(repository,base,citation+'#L'+found.line,symbol)).toEqual(found);
   expect(()=>resolve(repository,base,citation+'#L1',symbol)).toThrow('ACCEPTANCE_SDK_RESEARCH_CITATION');
   const other=symbol==='workdays.plan'?'workdays.schedules.create':'workdays.plan';expect(()=>resolve(repository,base,citation+'#L'+found.line,other)).toThrow('ACCEPTANCE_SDK_RESEARCH_CITATION');
  }
  const original=observations[0]!,declared=declaredSdkResearchIntentFields(original.found.source);
  for(const field of ['planningOnly','proposalIds','decisionIds','agentSelection','allocation'])expect(declared).toContain(field);
  const git=(args:string[],input?:string)=>execFileSync('git',['--no-replace-objects','-C',repository,...args],{env:{...env,GIT_INDEX_FILE:join(root,'source.index')},encoding:'utf8',input,timeout:30_000}).trim();
  for(const field of ['executionPlanId','capacityPlanId','executionInputId','demandSetId']){
   expect(declared).not.toContain(field);git(['read-tree',base]);
   const bytes=original.found.source.replace('export interface WorkdayIntent {','export interface WorkdayIntent {\n'+field+': string;'),blob=git(['hash-object','-w','--stdin'],bytes);
   git(['update-index','--cacheinfo','100644,'+blob+','+original.path]);const changedTree=git(['write-tree']),changed=git(['commit-tree',changedTree,'-p',base], 'Controlled source-citation negative fixture\n');
   const observed=resolve(repository,changed,original.citation.replace(base,changed),original.symbol);
   expect(observed.blob).toBe(blob);expect(()=>declaredSdkResearchIntentFields(observed.source)).toThrow('ACCEPTANCE_SDK_RESEARCH_INTENT');
   expect(resolve(repository,base,original.citation,original.symbol)).toEqual(original.found);
  }
  mkdirSync(join(repository,'src/operator-contracts'),{recursive:true});writeFileSync(join(repository,sources[0][0]),'A substituted working file must not replace the frozen Git object.');
  for(const value of observations)expect(resolve(repository,base,value.citation,value.symbol)).toEqual(value.found);
  const held=structuredClone(observations);renameSync(repository,repository+'.interrupted');try{expect(()=>resolve(repository,base,observations[0]!.citation,observations[0]!.symbol)).toThrow('ACCEPTANCE_SDK_RESEARCH_CITATION');}finally{renameSync(repository+'.interrupted',repository);}
  for(const value of observations)expect(resolve(repository,base,value.citation,value.symbol)).toEqual(value.found);expect(observations).toEqual(held);
  expect(readFileSync(join(repository,sources[0][0]),'utf8')).toBe('A substituted working file must not replace the frozen Git object.');
  console.log(JSON.stringify({nativeSdkSourceCitations:observations.map(value=>({commit:base,path:value.path,symbol:value.symbol,blob:value.found.blob,sha256:value.found.sourceSha256})),managedResearch:false}));
 }finally{rmSync(root,{recursive:true,force:true});}
},30_000);
