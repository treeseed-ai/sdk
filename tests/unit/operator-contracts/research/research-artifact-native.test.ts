import{expect,it}from'vitest';import{createServer}from'node:http';import{once}from'node:events';import{execFileSync}from'node:child_process';
import{mkdtempSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{parse,stringify}from'yaml';
import{ControlPlaneClient}from'@treeseed/sdk/control-plane-client';import{CONTROL_PLANE_OPERATIONS}from'@treeseed/sdk/operator-contracts';
import*as product from'../../../acceptance/golden-product.ts';

it('native public SDK repository-file reads retain independently committed research bytes through concurrency denial interruption and unchanged retry without source fallback',async()=>{
 const inspect=Reflect.get(product,'sdkResearchArtifact') as ((reference:Record<string,unknown>,value:unknown)=>Record<string,unknown>)|undefined;
 expect(inspect,'native SDK artifact readback is required').toBeTypeOf('function');if(!inspect)return;
 const root=mkdtempSync(join(tmpdir(),'sdk-research-artifact-')),repository=join(root,'library.git'),env={...process.env};for(const name of Object.keys(env))if(name.startsWith('GIT_'))delete env[name];
 Object.assign(env,{GIT_INDEX_FILE:join(root,'library.index'),GIT_AUTHOR_NAME:'Controlled native test',GIT_AUTHOR_EMAIL:'native@treeseed.invalid',GIT_COMMITTER_NAME:'Controlled native test',GIT_COMMITTER_EMAIL:'native@treeseed.invalid',GIT_OPTIONAL_LOCKS:'0'});
 const git=(args:string[],input?:string)=>execFileSync('git',['--no-replace-objects','-C',repository,...args],{env,encoding:'utf8',input,timeout:30_000}).trim();
 const frontmatter={schemaVersion:'treeseed.note/v1',id:'native-research',projectId:'project',classification:'research',subjectRefs:[{store:'treedx',model:'proposal',id:'original-proposal',repository:'repo_sdk',commit:'b'.repeat(40),path:'proposals/original.md'}],createdAt:'2030-01-01T00:00:01.000Z'},body='Controlled preliminary source findings.\nOperation bindings, generated descriptors and per-field provenance remain pending.\n',content='---\n'+stringify(frontmatter)+'---\n'+body;
 let mode='complete',requests=0;const server=createServer(async(request,response)=>{
  requests++;let bytes='';for await(const chunk of request)bytes+=String(chunk);
  if(mode==='interrupted'){response.destroy();return;}
  if(mode==='denied'){response.writeHead(403,{'content-type':'application/json'});response.end(JSON.stringify({title:'Original native denial',status:403,code:'research_read_denied'}));return;}
  const input=JSON.parse(bytes);expect(request.url).toBe('/v1/dx/projects/project/repos/repo_sdk/files/read');expect(input).toEqual({ref:reference.commit,paths:[reference.path],encoding:'utf8',parseFrontmatter:true,allowProtected:true});
  const raw=execFileSync('git',['--no-replace-objects','-C',repository,'cat-file','blob',reference.commit+':'+reference.path],{env,encoding:'utf8',timeout:30_000}),match=raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/u)!;
  const file={path:reference.path,content:raw,frontmatter:parse(match[1]!),body:match[2]!.trim()};
  if(mode==='substituted')file.frontmatter.id='substituted';
  response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({data:{ok:true,repoId:reference.repository,resolvedRef:reference.commit,files:mode==='missing'?[]:mode==='duplicate'?[file,file]:[file]}}));
 });
 const reference={kind:'treedx',projectId:'project',repository:'repo_sdk',commit:'',path:'notes/research.md'};
 try{
  execFileSync('git',['init','--bare',repository],{env,stdio:'pipe',timeout:30_000});git(['read-tree','--empty']);const blob=git(['hash-object','-w','--stdin'],content);git(['update-index','--add','--cacheinfo','100644,'+blob+','+reference.path]);const tree=git(['write-tree']);reference.commit=git(['commit-tree',tree],'Controlled native research input; not a managed Researcher result\n');
  const held={reference:structuredClone(reference),tree,blob,content};
  server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw new Error('Native loopback address required');
  const client=new ControlPlaneClient({profile:{serverId:'local',label:'Controlled native input',baseUrl:'http://127.0.0.1:'+address.port}}),input={path:{projectId:reference.projectId,repoId:reference.repository},query:{},body:{ref:reference.commit,paths:[reference.path],encoding:'utf8',parseFrontmatter:true,allowProtected:true}},before=structuredClone(input);
  const read=async()=>{const observed=await client.invoke(CONTROL_PLANE_OPERATIONS.treedx.repositories.readFiles,input) as {data:unknown};return inspect(reference,observed.data);};
  const original=await read();expect(original).toMatchObject({model:'note',frontmatter,body:body.trim(),content});expect(await Promise.all([read(),read()])).toEqual([original,original]);
  for(const failure of ['substituted','missing','duplicate','denied','interrupted']){
   mode=failure;await expect(read()).rejects.toThrow();mode='complete';expect(await read()).toEqual(original);
  }
  const abort=new AbortController();abort.abort();const count=requests;await expect(client.invoke(CONTROL_PLANE_OPERATIONS.treedx.repositories.readFiles,input,{signal:abort.signal})).rejects.toThrow();expect(requests).toBe(count);
  expect(input).toEqual(before);expect(reference).toEqual(held.reference);expect(git(['rev-parse',reference.commit+'^{tree}'])).toBe(held.tree);expect(git(['rev-parse',reference.commit+':'+reference.path])).toBe(held.blob);expect(git(['cat-file','blob',reference.commit+':'+reference.path])).toBe(held.content.trim());
  console.log(JSON.stringify({nativeSdkRepositoryRead:true,commit:reference.commit,blob,managedResearch:false}));
 }finally{server.closeAllConnections();if(server.listening)await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));rmSync(root,{recursive:true,force:true});}
 expect(server.listening).toBe(false);
},30_000);
