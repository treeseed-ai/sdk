import{parseSdkResearchCitation,resolveSdkResearchCitation,declaredSdkResearchIntentFields}from'./research-source.ts';
import assert from'node:assert/strict';
import{createHash}from'node:crypto';
import{posix}from'node:path';
import{parseDocument,visit}from'yaml';
import{validatePortableContentData}from'@treeseed/sdk/content-validation';

type Row=Record<string,unknown>;
const code='ACCEPTANCE_SDK_RESEARCH_ARTIFACT';
function row(value:unknown):Row{assert.ok(value&&typeof value==='object'&&!Array.isArray(value),code+': Original public object required');return value as Row;}

/** Consume original independently read bytes, retaining the native content model and source authority. */
export function sdkResearchArtifact(reference:Row,returned:unknown){
 sdkResearchArtifactReference(reference);
 const observed=row(returned);
 assert.ok(observed.ok===true&&observed.repoId===reference.repository&&observed.resolvedRef===reference.commit
  &&Array.isArray(observed.files)&&observed.files.length===1,code+': One complete independent native artifact read required');
 const file=row(observed.files[0]);assert.ok(file.path===reference.path&&typeof file.content==='string'&&Buffer.byteLength(file.content)<=1_048_576,code+': Original exact path and raw bytes required');
 const content=file.content,sha256=createHash('sha256').update(content).digest('hex');
 if(reference.digest!==undefined)assert.equal(reference.digest,'sha256:'+sha256,code+': Original recorded digest differs from bytes');
 const match=content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/u);assert.ok(match,code+': Original native frontmatter required');
 const document=parseDocument(match[1]!);assert.ok(document.errors.length===0&&document.warnings.length===0,code+': Ambiguous native YAML denied');
 visit(document,(_key,node)=>{if(node&&typeof node==='object'&&'anchor'in node)assert.ok(!node.anchor,code+': Native aliases or anchored content denied');});
 const frontmatter=row(document.toJS({maxAliasCount:0})),body=match[2]!.trim();assert.deepEqual(frontmatter,file.frontmatter,code+': Parsed native view contradicts raw bytes');
 if(file.body!==undefined)assert.equal(file.body,body,code+': Native body differs from original bytes');
 if(frontmatter.body!==undefined)assert.equal(frontmatter.body,body,code+': Frontmatter body differs from original bytes');
 const model=frontmatter.schemaVersion==='treeseed.note/v1'?'note':frontmatter.schemaVersion==='treeseed.knowledge-page/v2'?'knowledge':frontmatter.schemaVersion==='treeseed.decision/v1'?'decision':undefined;
 assert.ok(model&&frontmatter.projectId===reference.projectId,code+': Original project-owned canonical artifact required');
 assert.ok(validatePortableContentData(model,model==='decision'?frontmatter:{...frontmatter,body}).ok,code+': Complete original canonical artifact required');
 return{model,frontmatter,body,content,sha256};
}

/** Required SDK research facts are read from the frozen owning Git objects; independent governed reviews still own the free-text assessment. */
export function verifySdkResearchCitations(artifact:Pick<ReturnType<typeof sdkResearchArtifact>,'body'|'frontmatter'>,
 sdkRoot:string,base:string,stage:'preliminary'|'corrected',otherSources:Readonly<Record<string,{root:string;base:string}>>={}){
 const label='ACCEPTANCE_SDK_RESEARCH_SOURCES';assert.ok(artifact&&typeof artifact.body==='string'&&artifact.body.trim()&&artifact.frontmatter&&typeof artifact.frontmatter==='object',label);
 assert.ok(stage==='preliminary'||stage==='corrected',label+': Exact original contribution stage required');
 const values:unknown[]=[...artifact.body.matchAll(/https?:\/\/[^\s<>()\]"'`]+/gu)].map(match=>match[0].replace(/[.,;:!?]+$/u,''));
 for(const name of ['relatedRefs','subjectRefs'])if(artifact.frontmatter[name]!==undefined)assert.ok(Array.isArray(artifact.frontmatter[name]),label+': Canonical original source references required');
 const collect=(value:unknown):void=>{
  if(typeof value==='string'){for(const match of value.matchAll(/https?:\/\/[^\s<>()\]"'`]+/gu))values.push(match[0].replace(/[.,;:!?]+$/u,''));return;}
  if(Array.isArray(value)){for(const item of value)collect(item);return;}
  if(!value||typeof value!=='object')return;const ref=value as Row;
  if(ref.store==='git'||ref.store==='url'){values.push(ref);return;}
  if(ref.store==='treedx'||ref.store==='postgresql')return;
  for(const[key,item]of Object.entries(ref))if(key!=='body')collect(item);
 };collect(artifact.frontmatter);

 const sources={...otherSources,'treeseed-ai/sdk':{root:sdkRoot,base}},cited=new Map<string,{value:unknown;reference:ReturnType<typeof parseSdkResearchCitation>;observed:ReturnType<typeof resolveSdkResearchCitation>}>();
 for(const value of values){
  let repository:unknown;if(typeof value==='string'){let url:URL;try{url=new URL(value);}catch(cause){throw new Error(label+': Malformed original source citation',{cause});}const parts=url.pathname.split('/');repository=parts[1]+'/'+parts[2];}else{const ref=row(value);if(ref.store==='url'&&typeof ref.url==='string'){const parts=new URL(ref.url).pathname.split('/');repository=parts[1]+'/'+parts[2];}else repository=ref.repository;}
  assert.ok(typeof repository==='string'&&Object.hasOwn(sources,repository),label+': Citation owner must have frozen source custody');
  const owner=sources[repository as keyof typeof sources]!;const reference=parseSdkResearchCitation(value,owner.base,repository);
  assert.ok(reference.anchor||reference.startLine!==undefined,label+': Exact original source location required');
  const observed=resolveSdkResearchCitation(owner.root,owner.base,value,undefined,repository),key=JSON.stringify(reference);
  cited.set(key,{value,reference,observed});
 }
 const entries=[...cited.values()],required=[
  ['src/operator-contracts/workday-lifecycle.ts','WorkdayIntent'],['src/entrypoints/clients/control-plane-client.ts','ControlPlaneClient.invoke'],
  ['src/operator-contracts/control-plane-operations.ts','workdays.plan'],['src/operator-contracts/control-plane-operations.ts','workdays.schedules.create'],
  ['src/operator-contracts/canonical-command-tree.ts','workdays.plan'],['src/operator-contracts/canonical-command-tree.ts','workdays.schedules.create'],
  ['src/operator-contracts/workday-lifecycle.ts','WorkdayPreflightReceipt'],['src/operator-contracts/catalog/workdays/selection-commands.ts','WORKDAY_PLAN_OPTIONS'],
 ]as const;
 const proves=(entry:typeof entries[number],path:string,symbol:string)=>{
  if(entry.reference.repository!=='treeseed-ai/sdk'||entry.reference.path!==path)return;
  try{return resolveSdkResearchCitation(sdkRoot,base,entry.value,symbol);}catch{return;}
 };
 for(const[path,symbol]of required.slice(0,stage==='preliminary'?2:required.length))assert.ok(entries.some(entry=>proves(entry,path,symbol)),label+': Missing exact source finding '+symbol+' at '+path);
 if(stage==='preliminary'){
  assert.ok(entries.every(entry=>required.slice(0,2).some(([path,symbol])=>proves(entry,path,symbol))),label+': First contribution may cite only WorkdayIntent and ControlPlaneClient.invoke');
  const paragraphs=artifact.body.split(/\n\s*\n/u);
  for(const subject of [/operation\s+bindings?/iu,/generated\s+descriptors?/iu,/per[- ]field\s+provenance/iu])assert.ok(paragraphs.some(paragraph=>subject.test(paragraph)&&/\bpending\b/iu.test(paragraph)),label+': Omitted findings must be explicitly pending');
 }else{
  const intent=entries.map(entry=>proves(entry,required[0][0],required[0][1])).find(value=>value!==undefined);assert.ok(intent,label);
  declaredSdkResearchIntentFields(intent.source);
  for(const name of ['executionPlanId','capacityPlanId','executionInputId','demandSetId'])assert.ok(new RegExp('\\b'+name+'\\b','u').test(artifact.body),label+': Each actual caller-field provenance finding is required');
 }
 return entries.map(({reference,observed})=>({reference,blob:observed.blob,sourceSha256:observed.sourceSha256,line:observed.line}));
}

/** Validate source authority before a supported read is invoked. */
export function sdkResearchArtifactReference(reference:Row):void{
 assert.ok(reference.kind==='treedx'&&typeof reference.projectId==='string'&&reference.projectId
  &&typeof reference.repository==='string'&&reference.repository&&typeof reference.commit==='string'&&/^[a-f0-9]{40}$/u.test(reference.commit)
  &&typeof reference.path==='string'&&reference.path&&!reference.path.startsWith('/')&&!/[\\\u0000-\u001f\u007f]/u.test(reference.path)
  &&posix.normalize(reference.path)===reference.path&&!reference.path.split('/').some(part=>part==='..'||part==='.'||!part),code+': Exact original returned artifact reference required');
}
