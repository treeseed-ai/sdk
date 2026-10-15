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
 assert.ok(reference.kind==='treedx'&&typeof reference.projectId==='string'&&reference.projectId
  &&typeof reference.repository==='string'&&reference.repository&&typeof reference.commit==='string'&&/^[a-f0-9]{40}$/u.test(reference.commit)
  &&typeof reference.path==='string'&&reference.path&&!reference.path.startsWith('/')&&!/[\\\u0000-\u001f\u007f]/u.test(reference.path)
  &&posix.normalize(reference.path)===reference.path&&!reference.path.split('/').some(part=>part==='..'||part==='.'||!part),code+': Exact original returned artifact reference required');
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
 const model=frontmatter.schemaVersion==='treeseed.note/v1'?'note':frontmatter.schemaVersion==='treeseed.knowledge-page/v2'?'knowledge':undefined;
 assert.ok(model&&frontmatter.projectId===reference.projectId,code+': Original project-owned Note or Knowledge required');
 assert.ok(validatePortableContentData(model,{...frontmatter,body}).ok,code+': Complete original canonical artifact required');
 return{model,frontmatter,body,content,sha256};
}
