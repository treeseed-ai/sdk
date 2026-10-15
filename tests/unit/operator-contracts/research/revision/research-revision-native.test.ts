import{expect,it}from'vitest';import{researchRevisionFixture}from'./research-revision-fixture.ts';
import{mkdtempSync,rmSync,realpathSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{execFileSync}from'node:child_process';import{createServer}from'node:http';import{once}from'node:events';import{parse}from'yaml';
import{ControlPlaneClient}from'@treeseed/sdk/control-plane-client';import{CONTROL_PLANE_OPERATIONS}from'@treeseed/sdk/operator-contracts';
import{resolveSdkResearchCitation}from'../../../../acceptance/product/research-source.ts';
import*as product from'../../../../acceptance/golden-product.ts';

it('native SDK research revision reads immutable published artifact and governed review bytes against actual frozen SDK source and retains missing altered denied interrupted evidence before unchanged retry',async()=>{
 const verify=Reflect.get(product,'verifySdkResearchRevision')as((items:Record<string,any>[],scope:Record<string,any>,root:string,base:string,read:(ref:Record<string,any>)=>Promise<unknown>)=>Promise<Record<string,unknown>>)|undefined;
 expect(verify,'native SDK research revision consumer is required').toBeTypeOf('function');if(!verify)return;
 const root=mkdtempSync(join(tmpdir(),'sdk-native-research-revision-')),library=join(root,'library.git'),env={...process.env};for(const name of Object.keys(env))if(name.startsWith('GIT_'))delete env[name];Object.assign(env,{GIT_INDEX_FILE:join(root,'library.index'),GIT_AUTHOR_NAME:'Native controlled input',GIT_AUTHOR_EMAIL:'native@treeseed.invalid',GIT_COMMITTER_NAME:'Native controlled input',GIT_COMMITTER_EMAIL:'native@treeseed.invalid',GIT_OPTIONAL_LOCKS:'0'});
 const upstream=(args:string[])=>execFileSync('git',args,{env:process.env,encoding:'utf8',timeout:30_000}).trim(),sourceRoot=realpathSync(upstream(['rev-parse','--absolute-git-dir'])),base=upstream(['rev-parse','HEAD^{commit}']);
 const git=(args:string[],input?:string)=>execFileSync('git',['--no-replace-objects','-C',library,...args],{env,encoding:'utf8',input,timeout:30_000}).trim();let parent:string|undefined,mode='complete';
 let allowed=new Set<string>();const server=createServer(async(request,response)=>{
  let body='';for await(const chunk of request)body+=String(chunk);const value=JSON.parse(body),path=Array.isArray(value.paths)&&value.paths.length===1?value.paths[0]:undefined;
  if(request.url!=='/v1/dx/projects/project/repos/repo_sdk/files/read'||!allowed.has(value.ref+':'+path)||mode==='denied'){response.writeHead(403,{'content-type':'application/json'});response.end(JSON.stringify({title:'Controlled denied original read',status:403,code:'research_read_denied'}));return;}
  if(mode==='interrupted'){response.destroy();return;}
  let content=execFileSync('git',['--no-replace-objects','-C',library,'cat-file','blob',value.ref+':'+path],{env,encoding:'utf8',timeout:30_000});
  if(mode==='altered-findings'&&path==='notes/review-findings.md')content+='Altered original feedback.\n';
  if(mode==='wrong-disposition'&&path==='decisions/request-changes.md')content=content.replace('disposition: request-changes','disposition: approved');
  const match=content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/u)!;
  const result={ok:true,repoId:'repo_sdk',resolvedRef:mode==='foreign-ref'?'f'.repeat(40):value.ref,files:mode==='missing'?[]:[{path,content,frontmatter:parse(match[1]!),body:match[2]!.trim()}]};
  response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({data:result}));
 });
 try{
  execFileSync('git',['init','--bare',library],{env,stdio:'pipe',timeout:30_000});
  const publish=(files:Array<{path:string;content:string}>)=>{git(['read-tree',...(parent?[parent]:['--empty'])]);for(const file of files){const blob=git(['hash-object','-w','--stdin'],file.content);git(['update-index','--add','--cacheinfo','100644,'+blob+','+file.path]);}const tree=git(['write-tree']);parent=git(['commit-tree',tree,...(parent?['-p',parent]:[])],'Controlled native artifact inputs; not managed Actor or Reviewer output\n');return parent;};
  const locations=[['src/operator-contracts/workday-lifecycle.ts','WorkdayIntent'],['src/entrypoints/clients/control-plane-client.ts','ControlPlaneClient.invoke'],['src/operator-contracts/control-plane-operations.ts','workdays.plan'],['src/operator-contracts/control-plane-operations.ts','workdays.schedules.create'],['src/operator-contracts/canonical-command-tree.ts','workdays.plan'],['src/operator-contracts/canonical-command-tree.ts','workdays.schedules.create'],['src/operator-contracts/workday-lifecycle.ts','WorkdayPreflightReceipt'],['src/operator-contracts/catalog/workdays/selection-commands.ts','WORKDAY_PLAN_OPTIONS']];
  const citations=locations.map(([path,symbol])=>{const url='https://github.com/treeseed-ai/sdk/blob/'+base+'/'+path,observed=resolveSdkResearchCitation(sourceRoot,base,url,symbol);return url+'#L'+observed.line;});
  const f=researchRevisionFixture(base,citations,publish),held=structuredClone(f.items),original=parent!;allowed=new Set(f.views.keys());
  server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw new Error('Native loopback address required');const client=new ControlPlaneClient({profile:{serverId:'local',label:'Controlled native read',baseUrl:'http://127.0.0.1:'+address.port}});
  const read=async(reference:Record<string,any>)=>{const value=await client.invoke(CONTROL_PLANE_OPERATIONS.treedx.repositories.readFiles,{path:{projectId:reference.projectId,repoId:reference.repository},query:{},body:{ref:reference.commit,paths:[reference.path],encoding:'utf8',parseFrontmatter:true,allowProtected:true}})as{data:unknown};return value.data;};
  const proof=await verify(f.items,f.scope,sourceRoot,base,read);expect(proof).toMatchObject({firstActorId:f.first.id,requestChangesId:f.requested.id,correctionActorId:f.corrected.id,approvalId:f.approval.id});
  for(const failure of ['missing','foreign-ref','altered-findings','wrong-disposition','denied','interrupted']){mode=failure;await expect(verify(f.items,f.scope,sourceRoot,base,read),failure).rejects.toThrow();}
  mode='complete';expect(await verify(f.items,f.scope,sourceRoot,base,read)).toEqual(proof);expect(f.items).toEqual(held);expect(parent).toBe(original);expect(git(['cat-file','-t',original])).toBe('commit');
  console.log(JSON.stringify({nativeSdkResearchRevision:true,frozenSdkSource:base,libraryCandidate:original,managedResearch:false,proof}));
 }finally{server.closeAllConnections();if(server.listening)await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));rmSync(root,{recursive:true,force:true});}
 expect(server.listening).toBe(false);
},30_000);
