import assert from'node:assert/strict';
import{assignmentAttemptSchema,assignmentResultSchema}from'@treeseed/sdk/agent-capacity';
import{sdkResearchArtifact,verifySdkResearchCitations}from'./research-artifact.ts';

type Row=Record<string,unknown>;
const code='ACCEPTANCE_SDK_RESEARCH_REVISION';
const row=(value:unknown):Row=>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value),code+': Original public object required');return value as Row;};
const clock=(value:unknown)=>{assert.ok(typeof value==='string'&&Number.isFinite(Date.parse(value)),code+': Original native clock required');return Date.parse(value);};

/** Read and compare actual products and classed reviews; this does not dispatch a model, prescribe its findings, or synthesize an approval. */
export async function verifySdkResearchRevision(items:readonly Row[],scopeInput:unknown,sdkRoot:string,base:string,
 read:(reference:Row)=>unknown|Promise<unknown>,otherSources:Readonly<Record<string,{root:string;base:string}>>={}){
 const scope=assignmentAttemptSchema.parse(scopeInput);assert.ok(Array.isArray(items),code);
 const selected=items.filter(item=>row(item.assignmentAttempt).workItemId==='research-context'&&item.projectId===scope.projectId
  &&['acting','reviewing'].includes(String(row(row(item.assignmentAttempt).effectiveProfile).activity))).map(item=>{
  const attempt=assignmentAttemptSchema.parse(item.assignmentAttempt),result=assignmentResultSchema.parse(item.assignmentResult);
  assert.deepEqual(attempt,item.assignmentAttempt,code+': Issued authority must not be normalized');assert.deepEqual(result,item.assignmentResult,code+': Original result must not be normalized');
  assert.ok(item.id===attempt.id&&result.assignmentId===attempt.id&&item.status==='completed'&&attempt.status==='completed'&&result.status==='completed',code+': Original completed owning attempts required');
  for(const field of ['teamId','projectId','workdayId']as const)assert.equal(attempt[field],scope[field],code+': Foreign revision scope');
  assert.deepEqual(attempt.sourceRef,scope.sourceRef,code+': Frozen proposal authority changed');
  assert.ok(clock(attempt.createdAt)<=clock(result.completedAt)&&clock(result.completedAt)<=clock(attempt.deadline),code+': Result escaped original deadline');
  assert.equal(clock(item.completedAt),clock(result.completedAt),code+': Public owning result clock differs');
  return{item,attempt,result};
 });
 assert.equal(new Set(selected.map(value=>value.attempt.id)).size,selected.length,code+': Duplicate attempt');assert.equal(new Set(selected.map(value=>value.result.id)).size,selected.length,code+': Duplicate result');
 const actors=selected.filter(value=>value.attempt.effectiveProfile.activity==='acting').sort((a,b)=>clock(a.attempt.createdAt)-clock(b.attempt.createdAt)),reviews=selected.filter(value=>value.attempt.effectiveProfile.activity==='reviewing');
 assert.equal(actors.length,2,code+': One preliminary contribution and one later correction required');assert.equal(reviews.length,2,code+': Actual request-changes and later approval required');
 const first=actors[0]!,corrected=actors[1]!;assert.equal(first.attempt.nodeId,corrected.attempt.nodeId,code+': Another work item cannot replace the original contribution');assert.equal(corrected.attempt.nodeRevision,first.attempt.nodeRevision+1,code+': Correction requires the original advanced node revision');
 const requested=reviews.filter(value=>value.result&&value.attempt.predecessorResultIds.includes(first.result.id)),approved=reviews.filter(value=>value.attempt.predecessorResultIds.includes(corrected.result.id));
 assert.equal(requested.length,1,code+': One original paired request-changes required');assert.equal(approved.length,1,code+': One later paired approval required');
 const request=requested[0]!,approval=approved[0]!;assert.notEqual(request.attempt.id,approval.attempt.id,code+': Separate review attempts required');assert.equal(request.attempt.nodeId,approval.attempt.nodeId,code+': Same original paired Reviewer node required');
 assert.ok(corrected.attempt.predecessorResultIds.includes(request.result.id),code+': Correction must consume the actual request-changes result');
 assert.ok(clock(first.result.completedAt)<clock(request.attempt.createdAt)&&clock(request.result.completedAt)<clock(corrected.attempt.createdAt)&&clock(corrected.result.completedAt)<clock(approval.attempt.createdAt),code+': Original independent review and correction chronology required');
 const retained=new Map<string,{reference:Row;returned:unknown;artifact:ReturnType<typeof sdkResearchArtifact>}>();
 const content=async(reference:Row)=>{
  assert.equal(reference.projectId,scope.projectId,code+': Foreign output owner');const key=JSON.stringify(reference);let found=retained.get(key);
  if(!found){const returned=await read(reference),artifact=sdkResearchArtifact(reference,returned);found={reference,returned,artifact};retained.set(key,found);}return found;
 };
 const actorProduct=async(actor:typeof first)=>{
  assert.ok(actor.attempt.contextRefs.some(ref=>ref.store==='git'&&ref.repository==='treeseed-ai/sdk'&&ref.commit===base),code+': Original frozen SDK source must be consumed');
  const references=actor.result.references.filter(ref=>ref.kind==='treedx');assert.equal(references.length,1,code+': One original primary research artifact required');
  const found=await content(references[0]!);assert.ok(found.artifact.model==='note'||found.artifact.model==='knowledge',code+': Researcher must return original Note or Knowledge');
  assert.ok(actor.attempt.grant.contentWrite.some(ref=>ref.id===found.artifact.frontmatter.id&&ref.model===found.artifact.model&&ref.repository===found.reference.repository&&ref.path===found.reference.path),code+': Exact original authored content grant required');
  if(found.artifact.model==='note')assert.ok(clock(actor.attempt.createdAt)<=clock(found.artifact.frontmatter.createdAt)&&clock(found.artifact.frontmatter.createdAt)<=clock(actor.result.completedAt),code+': Artifact predates or escapes its owning contribution');
  return found;
 };
 const preliminary=await actorProduct(first),correction=await actorProduct(corrected);
 assert.notEqual(preliminary.artifact.sha256,correction.artifact.sha256,code+': Reusing the original bytes is not a correction');
 assert.notEqual(preliminary.artifact.body,correction.artifact.body,code+': A metadata-only rewrite is not substantive research');
 const candidate=(subject:unknown,artifact:typeof preliminary)=>{const ref=row(subject);return ref.store==='treedx'&&ref.model===artifact.artifact.model&&ref.id===artifact.artifact.frontmatter.id
  &&ref.repository===artifact.reference.repository&&ref.commit===artifact.reference.commit&&ref.path===artifact.reference.path
  &&(ref.digest===undefined||ref.digest==='sha256:'+artifact.artifact.sha256);};
 const reviewProduct=async(review:typeof request,actor:typeof first,artifact:typeof preliminary,disposition:'request-changes'|'approved')=>{
  assert.notEqual(review.attempt.agentClass,actor.attempt.agentClass,code+': Actor cannot review itself');assert.notDeepEqual(review.attempt.effectiveProfile.profileRef,actor.attempt.effectiveProfile.profileRef,code+': Independent assigned reviewing profile required');
  assert.equal(row(row(review.item.lifecycleOutput).activityCompletion).reviewDisposition,disposition,code+': Exact original review disposition required');
  assert.ok(review.attempt.grant.sourceWrite.length===0&&!review.attempt.grant.tools.includes('source.write'),code+': Reviewer cannot mutate source');
  assert.ok(review.attempt.contextRefs.some(ref=>candidate(ref,artifact))&&review.attempt.grant.contentRead.some(ref=>candidate(ref,artifact)),code+': Reviewer must read the exact original candidate');
  assert.ok(!review.attempt.grant.contentWrite.some(ref=>ref.repository===artifact.reference.repository&&ref.path===artifact.reference.path),code+': Reviewer candidate writes denied');
  const workspace=review.attempt.workspace;if(workspace.mode==='treedx'&&workspace.repository===artifact.reference.repository)assert.ok(!workspace.writablePaths.some(path=>path==='.'||path===artifact.reference.path||String(artifact.reference.path).startsWith(path.replace(/\/$/u,'')+'/')),code+': Reviewer candidate workspace must remain read-only');
  const observed=await Promise.all(review.result.references.filter(ref=>ref.kind==='treedx').map(ref=>content(ref))),decisions=observed.filter(value=>value.artifact.model==='decision'&&value.artifact.frontmatter.decisionClass==='work-review');
  assert.equal(decisions.length,1,code+': One genuine classed work-review Decision required');const decision=decisions[0]!,value=decision.artifact.frontmatter;
  assert.equal(value.disposition,disposition,code+': Lifecycle flag cannot replace classed authority');assert.ok(candidate(value.subjectRef,artifact),code+': Classed review must bind exact actual artifact bytes');
  assert.ok(Array.isArray(value.authorityRefs)&&value.authorityRefs.some(ref=>JSON.stringify(ref)===JSON.stringify(scope.sourceRef)),code+': Exact original proposal authority required');
  assert.ok(Array.isArray(value.decidedByRefs)&&value.decidedByRefs.some(ref=>JSON.stringify(ref)===JSON.stringify(review.attempt.effectiveProfile.profileRef)),code+': Original assigned reviewing profile must decide');
  assert.ok(clock(review.attempt.createdAt)<=clock(value.decidedAt)&&clock(value.decidedAt)<=clock(review.result.completedAt),code+': Original independent decision clock required');
  return{decision,observed};
 };
 const changes=await reviewProduct(request,first,preliminary,'request-changes'),acceptance=await reviewProduct(approval,corrected,correction,'approved'),findingRefs=changes.decision.artifact.frontmatter.findingRefs;
 assert.ok(Array.isArray(findingRefs)&&findingRefs.length>0,code+': Actual actionable original findings required');const findingDigests:string[]=[];
 for(const value of findingRefs){const ref=row(value),found=changes.observed.filter(item=>item.artifact.model==='note'&&item.artifact.frontmatter.classification==='feedback'&&item.artifact.frontmatter.id===ref.id&&item.reference.repository===ref.repository&&item.reference.path===ref.path&&item.reference.commit===(ref.commit??changes.decision.reference.commit));
  assert.equal(found.length,1,code+': Every original finding must have one actual returned native Note');const finding=found[0]!;assert.equal(ref.digest,'sha256:'+finding.artifact.sha256,code+': Findings bytes differ from original Decision');
  assert.deepEqual(finding.artifact.frontmatter.subjectRefs,[changes.decision.artifact.frontmatter.subjectRef],code+': Feedback must address the same original artifact');
  assert.ok(corrected.attempt.contextRefs.some(context=>context.store==='treedx'&&context.repository===finding.reference.repository&&context.commit===finding.reference.commit&&context.path===finding.reference.path)
   &&corrected.attempt.grant.contentRead.some(context=>context.store==='treedx'&&context.repository===finding.reference.repository&&context.commit===finding.reference.commit&&context.path===finding.reference.path),code+': Correction must consume actual original feedback with exact read authority');
  findingDigests.push(finding.artifact.sha256);
 }
 const preliminarySources=verifySdkResearchCitations(preliminary.artifact,sdkRoot,base,'preliminary',otherSources),correctedSources=verifySdkResearchCitations(correction.artifact,sdkRoot,base,'corrected',otherSources);
 for(const found of retained.values())assert.deepEqual(await read(found.reference),found.returned,code+': Original artifacts and failed review observations changed during read-back');
 assert.ok(acceptance.decision.artifact.frontmatter.rationale,code+': Actual later independent approval rationale required');
 return{firstActorId:first.attempt.id,requestChangesId:request.attempt.id,correctionActorId:corrected.attempt.id,approvalId:approval.attempt.id,preliminarySha256:preliminary.artifact.sha256,correctedSha256:correction.artifact.sha256,findingDigests,preliminarySources,correctedSources};
}
