import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {nativePublishedGit,verifySdkCommittedTests} from './test-chain.ts';
import {nativeTestReport,sdkNativeTestCommand} from './release-output.ts';

const label='ACCEPTANCE_SDK_BASE_RED';
type Observation={commit:string;command:string;processCommand:string[];status:number;startedAt:string;completedAt:string;stdout:string;stderr:string;outputDigest:string};
/** Replay original committed source and tests independently. Only disposable
 * directories are written; every command comes from the held upstream package. */
export function verifySdkBaseRed(repository:string,base:string,tester:string,engineer:string){
 const approved=verifySdkCommittedTests(repository,base,tester,engineer),git=nativePublishedGit(repository);
 const root=mkdtempSync(join(tmpdir(),'sdk-native-base-red-')),observations:Observation[]=[];
 const env:NodeJS.ProcessEnv={PATH:dirname(process.execPath)+':/usr/bin:/bin',HOME:root,LANG:'C',CI:'true',
  NPM_CONFIG_CACHE:join(root,'npm-cache'),NPM_CONFIG_USERCONFIG:join(root,'user.npmrc'),NPM_CONFIG_GLOBALCONFIG:join(root,'global.npmrc'),
  ...(process.env.NODE_EXTRA_CA_CERTS?{NODE_EXTRA_CA_CERTS:process.env.NODE_EXTRA_CA_CERTS}:{})};
 const run=(commit:string,cwd:string,args:string[],mayFail=false)=>{
  const startedAt=new Date().toISOString(),result=spawnSync('/usr/bin/setsid',['npm',...args],{cwd,env,encoding:'utf8',timeout:120_000,maxBuffer:32*1024*1024});
  const observation={commit,command:['npm',...args].join(' '),processCommand:['/usr/bin/setsid','npm',...args],status:result.status??-1,startedAt,completedAt:new Date().toISOString(),stdout:result.stdout??'',stderr:result.stderr??'',outputDigest:'sha256:'+createHash('sha256').update(JSON.stringify({stderr:result.stderr??'',stdout:result.stdout??''})).digest('hex')};
  observations.push(observation);
  // Every process group is newly owned by this disposable command. Reap its
  // descendants on success or failure before another phase or directory cleanup.
  if(Number.isInteger(result.pid)&&result.pid>0){try{process.kill(-result.pid,'SIGKILL');}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error;}}
  assert.equal(result.error,undefined,label);assert.equal(result.signal,null,label);
  assert.ok(mayFail?result.status===0||result.status===1:result.status===0,label+': '+observation.command);
  return observation;
 };
 try{
  writeFileSync(join(root,'user.npmrc'),'');writeFileSync(join(root,'global.npmrc'),'');
  const reports=[];
  let baselinePackage:Buffer|undefined,baselineLock:Buffer|undefined,baselineConfig:Buffer|undefined;
  for(const [phase,commit]of [['base',base],['tester',tester],['engineer',engineer]]as const){
   const cwd=join(root,phase);mkdirSync(cwd);
   execFileSync('/usr/bin/tar',['-xf','-','-C',cwd],{input:git(['archive','--format=tar',commit]),timeout:5_000});
   const packageBytes=readFileSync(join(cwd,'package.json')),lock=readFileSync(join(cwd,'package-lock.json')),config=readFileSync(join(cwd,'vitest.contracts.config.ts'));
   if(phase==='base'){baselinePackage=packageBytes;baselineLock=lock;baselineConfig=config;}
   else {assert.deepEqual(packageBytes,baselinePackage,label+': runner package changed');assert.deepEqual(lock,baselineLock,label+': dependency lock changed');assert.deepEqual(config,baselineConfig,label+': assertion discovery changed');}
   const scripts=JSON.parse(packageBytes.toString('utf8')).scripts;assert.ok(typeof scripts?.build==='string'&&typeof scripts?.['test:contracts']==='string',label);
   run(commit,cwd,['ci','--ignore-scripts','--no-audit','--no-fund']);run(commit,cwd,['run','build']);
   const original=run(commit,cwd,['run','test:contracts','--','--reporter=default','--reporter=json'],true);
   assert.equal(original.command,sdkNativeTestCommand,label);
   reports.push(nativeTestReport(original.stdout,original.status===0));
   for(const candidate of [base,tester,engineer])assert.equal(git(['rev-parse','--verify',candidate+'^{commit}']).toString().trim(),candidate,label);
  }
  const [baseline,red,green]=reports;assert.ok(baseline&&red&&green,label);
  const changed=new Set(approved.map(file=>file.path)),introduced:string[]=[],unrelated:string[]=[];
  for(const[id,test]of baseline)if(test.status==='failed'){unrelated.push(id);assert.equal(red.get(id)?.status,'failed',label+': original BASE failure disappeared');}
  assert.deepEqual([...red.keys()].sort(),[...green.keys()].sort(),label+': Engineer omitted or replaced assertions');
  for(const[id,test]of red){assert.equal(green.get(id)?.status,'passed',label+': exact approved test is not GREEN');
   if(test.status==='failed'&&baseline.get(id)?.status!=='failed'){assert.ok(changed.has(test.path),label+': new failure outside approved tests');introduced.push(id);}
  }
  assert.ok(introduced.length>0,label+': a nonzero command or unchanged BASE failure is not intended test-first RED');
  for(const file of approved.filter(file=>/\.(?:test|spec)\.tsx?$/u.test(file.path)))assert.ok([...red.values()].some(test=>test.path===file.path),label+': committed test omitted');
  return{base,tester,engineer,approved,introducedFailures:introduced,unrelatedBaseFailures:unrelated,observations};
 }catch(failure){throw new Error(label+': independent frozen-source replay failed',{cause:{failure,observations}});}
 finally{rmSync(root,{recursive:true,force:true});assert.equal(existsSync(root),false,label+': disposable replay residue');}
}
