import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {readFileSync,realpathSync,lstatSync} from 'node:fs';
import {createServer} from 'node:http';
import {isAbsolute,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const label='ACCEPTANCE_SDK_INTENT_PRODUCT';
type Request={method:string|undefined;path:string|undefined;body:string};
/** Inspect the original built public exports inside existing native replay
 * custody. Controlled replies are transport inputs, never API admission or
 * managed Tester/Engineer receipts. No source implementation is substituted. */
export async function verifySdkIntentRuntime(root:string){
 const requests:Request[]=[],failures:Array<{expectation:string;observed:string}>=[];
 const targets:Array<{specifier:string;path:string;sha256:string}>=[];
 let checks=0;
 try{
  assert.ok(typeof root==='string'&&isAbsolute(root)&&realpathSync(root)===resolve(root),label+': exact native package root required');
  const manifest=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8')) as {name?:unknown;exports?:Record<string,{default?:unknown}>};
  assert.equal(manifest.name,'@treeseed/sdk',label+': original SDK identity required');
  const load=async(specifier:string)=>{
   const target=manifest.exports?.[specifier]?.default;
   assert.ok(typeof target==='string'&&target.startsWith('./dist/')&&!target.split('/').includes('..'),label+': public built export required');
   const path=resolve(root,target);assert.equal(realpathSync(path),path,label+': workspace/source links are forbidden');assert.equal(lstatSync(path).isFile(),true,label);
   targets.push({specifier,path:target,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')});
   return import(pathToFileURL(path).href);
  };
  const sdk=await load('./control-plane-client') as typeof import('@treeseed/sdk/control-plane-client');
  const contracts=await load('./operator-contracts') as typeof import('@treeseed/sdk/operator-contracts');
  assert.equal(typeof sdk.ControlPlaneClient,'function',label);assert.ok(contracts.CONTROL_PLANE_OPERATIONS?.workdays,label);
  const server=createServer(async(request,response)=>{
   const chunks:Buffer[]=[];for await(const chunk of request)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk));
   requests.push({method:request.method,path:request.url,body:Buffer.concat(chunks).toString('utf8')});
   response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({data:{marker:'sdk-intent-inspection'}}));
  });
  let cleanupConfirmed=false;
  try{
   server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address!=='string',label);
   const client=new sdk.ControlPlaneClient({profile:{serverId:'local',label:'Local',baseUrl:'http://127.0.0.1:'+address.port}});
   const base={schemaVersion:'treeseed.workday-intent/v1',teamId:'team',profileId:'default',projects:['sdk'],startsAt:'2030-01-01T00:00:00Z',durationSeconds:600,
    proposalIds:['proposal-original'],agentSelection:{agentSlugs:['configured-arbitrary-agent'],activityTypes:['planning']},allocation:{planningPercent:20,allocationWeight:2}};
   const ordered=['A','Z','a','a-1','a.1','a/1','a:1'];
   const capture=async(expectation:string,action:()=>Promise<void>)=>{checks++;try{await action();}catch(error){failures.push({expectation,observed:String(error)});}};
   const observe=async(nested:boolean,intent:Record<string,unknown>,expected:Record<string,unknown>|null)=>{
    const body=nested?{intent,cadenceSeconds:3600}:intent;
    const originalIntent=structuredClone(Object.getOwnPropertyDescriptors(intent)),originalBody=structuredClone(Object.getOwnPropertyDescriptors(body));
    const before=requests.length,binding=nested?contracts.CONTROL_PLANE_OPERATIONS.workdays.createSchedule:contracts.CONTROL_PLANE_OPERATIONS.workdays.preflight;
    try{
     if(expected===null){let denied=false;try{await client.invoke(binding,{path:{teamId:'team'},query:{},body},{signal:AbortSignal.timeout(10_000)});}catch{denied=true;}
      assert.equal(denied,true,label+': invalid own intent accepted');assert.equal(requests.length,before,label+': invalid intent reached transport');
     }else{
      const result=await client.invoke(binding,{path:{teamId:'team'},query:{},body},{signal:AbortSignal.timeout(10_000)});
      assert.deepEqual(result,{data:{marker:'sdk-intent-inspection'}},label);assert.equal(requests.length,before+1,label);
      assert.deepEqual(requests.at(-1),{method:'POST',path:'/v1/teams/team/'+(nested?'workday-schedules':'workday-runs/preflight'),body:JSON.stringify(nested?{intent:expected,cadenceSeconds:3600}:expected)},label+': exact canonical bytes and independent controls required');
      const sent=JSON.parse(requests.at(-1)!.body) as Record<string,unknown>,transmitted=nested?sent.intent as Record<string,unknown>:sent;
      for(const key of ['intentDigest','preflightDigest'])assert.equal(Object.hasOwn(transmitted,key),false,label+': SDK must not invent API digests');
     }
    }finally{assert.deepEqual(Object.getOwnPropertyDescriptors(intent),originalIntent,label+': caller intent changed');assert.deepEqual(Object.getOwnPropertyDescriptors(body),originalBody,label+': caller body changed');}
   };
   const tree=contracts.TREESEED_COMMAND_TREE_V1,originalTree=structuredClone(tree);
   const leaves=new Map<string,Extract<(typeof tree.commands)[number],{nodeType:'leaf'}>>();
   const visit=(nodes:typeof tree.commands,parent:string[]=[])=>{for(const node of nodes){const path=[...parent,node.segment];if(node.nodeType==='branch')visit(node.children,path);else leaves.set(path.join(' '),node);}};
   visit(tree.commands);
   for(const [path,operationId,field]of [['workdays plan','workdays.plan','decisionIds'],['workdays schedules start','workdays.schedules.create','intent.decisionIds']])await capture('descriptor/'+operationId,async()=>{
    const leaf=leaves.get(path!);assert.ok(leaf&&leaf.execution.kind==='operation',label+': original generated operation required');assert.equal(leaf.execution.operationId,operationId,label);
    const options=leaf.options?.filter(option=>option.name==='--decision');assert.equal(options?.length,1,label);assert.equal(options![0]!.type,'string[]',label);
    assert.deepEqual(leaf.execution.input?.filter(input=>input.name==='decision'||input.field===field),[{target:'body',field,source:'option',name:'decision',required:false,transform:'csv'}],label);
    for(const prohibited of ['executionPlanId','capacityPlanId','executionInputId','demandSetId'])assert.ok(!leaf.execution.input?.some(input=>input.field===prohibited||input.field==='intent.'+prohibited||input.name===prohibited),label);
    assert.deepEqual(tree,originalTree,label+': original generated contracts changed');
   });
   for(const nested of [false,true]){
    const shape=nested?'nested':'direct';
    for(const planningOnly of [false,true]){
     const input={...base,planningOnly};await capture('omitted/'+shape+'/'+planningOnly,()=>observe(nested,input,input));
     for(const [index,decisionIds]of [ordered.map(id=>' '+id+' '),[...ordered].reverse(),[ordered[3]!,ordered[6]!,ordered[0]!,ordered[5]!,ordered[2]!,ordered[4]!,ordered[1]!]].entries())
      await capture('canonical/'+shape+'/'+planningOnly+'/'+index,()=>observe(nested,{...input,decisionIds},{...input,decisionIds:ordered}));
    }
    await capture('maximum-200/'+shape,()=>observe(nested,{...base,decisionIds:['x'.repeat(200)]},{...base,decisionIds:['x'.repeat(200)]}));
    const malformed:unknown[]=[[],[''],[' \t\n '],['one',' one '],['same','same'],[null],[1],'one',null,Array.from({length:65},(_,index)=>'decision-'+index),['x'.repeat(201)],['é'],['e\u0301'],['\uE000'],['\u{10000}'],['decision?']];
    for(const [index,decisionIds]of malformed.entries())await capture('invalid-decision/'+shape+'/'+index,()=>observe(nested,{...base,decisionIds},null));
    for(const field of ['executionPlanId','capacityPlanId','executionInputId','demandSetId'])for(const [index,value]of [undefined,null,'','derived-identity'].entries())for(const enumerable of [true,false]){
     const intent={...base};Object.defineProperty(intent,field,{value,enumerable,configurable:true,writable:true});
     await capture('retired/'+shape+'/'+field+'/'+index+'/'+(enumerable?'enumerable':'hidden'),()=>observe(nested,intent,null));
    }
   }
  }finally{server.closeAllConnections();if(server.listening)await new Promise<void>((done,reject)=>server.close(error=>error?reject(error):done()));cleanupConfirmed=!server.listening;}
  const observation={checks,failures,targets,requests,cleanupConfirmed};console.log(JSON.stringify({sdkIntentRuntimeObservation:observation}));
  assert.equal(cleanupConfirmed,true,label+': disposable transport residue');if(failures.length)throw new Error(label+': independent public intent behavior failed',{cause:observation});
  return observation;
 }catch(error){if(error instanceof Error&&error.message.startsWith(label))throw error;throw new Error(label+': exact public runtime inspection failed',{cause:error});}
}
