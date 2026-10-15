import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {realpathSync} from 'node:fs';
import {isAbsolute,resolve,posix} from 'node:path';
import ts from 'typescript';
import {exactEntityReferenceSchema} from '@treeseed/sdk/agent-capacity';

const code='ACCEPTANCE_SDK_RESEARCH_CITATION';
type SourceLocation={repository:string;commit:string;path:string;anchor?:string};
function anchor(value:string):{first:number;last:number}|undefined{
 const match=value.match(/^L([1-9][0-9]*)(?:-L([1-9][0-9]*))?$/u);if(!match)return;
 const first=Number(match[1]),last=Number(match[2]??match[1]);assert.ok(Number.isSafeInteger(first)&&Number.isSafeInteger(last)&&first<=last,code+': Exact source line range required');return{first,last};
}
/** Existing exact Git refs and ordinary source URLs retain one frozen source authority. */
export function parseSdkResearchCitation(value:unknown,base:string,repository='treeseed-ai/sdk'):SourceLocation{
 assert.match(base,/^[a-f0-9]{40}$/u,code+': Exact frozen base required');assert.match(repository,/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u,code);
 let reference:SourceLocation;
 if(typeof value==='string'){
  let url:URL;try{url=new URL(value);}catch(cause){throw new Error(code+': Source URL required',{cause});}
  assert.ok(value===url.href&&url.protocol==='https:'&&url.hostname==='github.com'&&!url.port&&!url.username&&!url.password&&!url.search,code+': Exact public source URL required');
  const parts=url.pathname.split('/');assert.ok(parts[0]===''&&parts[1]+'/'+parts[2]===repository&&parts[3]==='blob'&&parts.length>5,code+': Foreign source repository or location');
  let path:string;try{path=decodeURIComponent(parts.slice(5).join('/'));}catch(cause){throw new Error(code+': Invalid encoded source path',{cause});}
  reference={repository,commit:parts[4]!,path,...(url.hash?{anchor:url.hash.slice(1)}:{})};if(reference.anchor)assert.ok(anchor(reference.anchor),code+': Source URL anchor must resolve to exact lines');
 }else{
  const checked=exactEntityReferenceSchema.safeParse(value);assert.ok(checked.success,code+': Canonical exact Git reference required');assert.deepEqual(checked.data,value,code+': Source reference cannot be normalized');
  assert.equal(checked.data.store,'git',code);assert.ok(checked.data.repository&&checked.data.commit&&checked.data.path,code+': Complete exact source location required');
  reference={repository:checked.data.repository,commit:checked.data.commit,path:checked.data.path,...(checked.data.anchor!==undefined?{anchor:checked.data.anchor}:{})};
 }
 assert.equal(reference.repository,repository,code+': Foreign source repository');assert.equal(reference.commit,base,code+': Citation differs from frozen source');
 assert.ok(reference.path.startsWith('src/')&&reference.path.endsWith('.ts')&&!reference.path.includes('\\')&&!/[\u0000-\u001f\u007f]/u.test(reference.path)&&posix.normalize(reference.path)===reference.path&&!reference.path.split('/').includes('..'),code+': Canonical owning source path required');
 if(reference.anchor!==undefined){assert.ok(reference.anchor&&reference.anchor.trim()===reference.anchor,code);if(reference.anchor.startsWith('L')&&/^L[0-9]/u.test(reference.anchor))assert.ok(anchor(reference.anchor),code);else assert.match(reference.anchor,/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/u,code+': Exact source symbol required');}
 return reference;
}

/** Read native immutable Git objects; no checked-out source or network fallback. */
export function resolveSdkResearchCitation(root:string,base:string,citation:unknown,symbol:string,repository='treeseed-ai/sdk'){
 const reference=parseSdkResearchCitation(citation,base,repository);assert.match(symbol,/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/u,code);
 try{
  assert.ok(isAbsolute(root)&&realpathSync(root)===resolve(root),code+': Exact owning repository required');
  const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('GIT_'))delete env[key];env.GIT_OPTIONAL_LOCKS='0';env.GIT_NO_REPLACE_OBJECTS='1';
  const git=(args:string[])=>execFileSync('git',['--no-replace-objects','-C',root,...args],{env,timeout:30_000,maxBuffer:8*1024*1024});
  assert.equal(git(['cat-file','-t',base]).toString('utf8').trim(),'commit',code);const bytes=git(['cat-file','blob',base+':'+reference.path]),source=bytes.toString('utf8');assert.ok(Buffer.from(source,'utf8').equals(bytes),code+': Exact UTF-8 source required');
  const parsed=ts.createSourceFile(reference.path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),diagnostics:unknown=Reflect.get(parsed,'parseDiagnostics');assert.ok(Array.isArray(diagnostics)&&diagnostics.length===0,code+': Source must parse without repair');
  const matches:ts.Node[]=[];const inspect=(node:ts.Node)=>{let name:string|undefined;
   if(ts.isInterfaceDeclaration(node)||ts.isTypeAliasDeclaration(node)||ts.isFunctionDeclaration(node)||ts.isClassDeclaration(node)||ts.isVariableDeclaration(node))name=node.name&&ts.isIdentifier(node.name)?node.name.text:undefined;
   if(ts.isMethodDeclaration(node)&&ts.isClassDeclaration(node.parent)&&node.parent.name&&ts.isIdentifier(node.name))name=node.parent.name.text+'.'+node.name.text;
   if(name===symbol)matches.push(node);ts.forEachChild(node,inspect);
  };inspect(parsed);assert.ok(matches.length>0,code+': Cited source symbol missing');
  const range=reference.anchor?anchor(reference.anchor):undefined;if(reference.anchor&&!range)assert.equal(reference.anchor,symbol,code+': Foreign source symbol');
  const lines=source.split('\n').length;if(range)assert.ok(range.last<=lines,code+': Cited lines are absent');
  const located=matches.filter(node=>!range||parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line+1<=range.last&&parsed.getLineAndCharacterOfPosition(node.end).line+1>=range.first);assert.ok(located.length>0,code+': Citation does not locate its claimed symbol');
  const line=parsed.getLineAndCharacterOfPosition(located[0]!.getStart(parsed)).line+1;
  return{source,blob:git(['rev-parse',base+':'+reference.path]).toString('utf8').trim(),sourceSha256:createHash('sha256').update(bytes).digest('hex'),symbol,line};
 }catch(cause){if(cause instanceof Error&&cause.message.startsWith(code))throw cause;throw new Error(code+': Native frozen source resolution failed',{cause});}
}

/** Absence is established from a complete native declaration, never a prose assertion or a receipt with a different owner. */
export function declaredSdkResearchIntentFields(source:string):string[]{
 const label='ACCEPTANCE_SDK_RESEARCH_INTENT';assert.ok(typeof source==='string'&&source.length>0,label);
 const parsed=ts.createSourceFile('workday-lifecycle.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),diagnostics:unknown=Reflect.get(parsed,'parseDiagnostics');
 assert.ok(Array.isArray(diagnostics)&&diagnostics.length===0,label+': Complete original source required');
 const declarations:ts.InterfaceDeclaration[]=[];
 const inspect=(node:ts.Node)=>{if(ts.isInterfaceDeclaration(node)&&node.name.text==='WorkdayIntent')declarations.push(node);ts.forEachChild(node,inspect);};inspect(parsed);
 assert.equal(declarations.length,1,label+': One unambiguous original interface required');const declaration=declarations[0]!;
 assert.ok(!declaration.heritageClauses?.length,label+': Inherited caller fields require their own complete proof');
 const fields=declaration.members.map(member=>{
  assert.ok(ts.isPropertySignature(member)&&member.name&&(ts.isIdentifier(member.name)||ts.isStringLiteral(member.name)),label+': Every original member must be statically declared');
  return member.name.text;
 });
 assert.equal(new Set(fields).size,fields.length,label+': Duplicate or merged declarations denied');
 for(const name of ['schemaVersion','teamId','profileId','projects','executionMode','startsAt','planningOnly','proposalIds','decisionIds','agentSelection','allocation'])assert.ok(fields.includes(name),label+': Missing original independent intent control '+name);
 for(const name of ['executionPlanId','capacityPlanId','executionInputId','demandSetId'])assert.ok(!fields.includes(name),label+': Prohibited field is declared as SDK caller input: '+name);
 return fields;
}
