import{expect,it,vi}from'vitest';import{researchRevisionFixture}from'./research-revision-fixture.ts';
import*as product from'../../../../acceptance/golden-product.ts';

// Source criteria have separate native Git proof; these unit cases own the actual artifact/review chain.
vi.mock('../../../../acceptance/product/research-source.ts',async importOriginal=>{
 const actual=await importOriginal<typeof import('../../../../acceptance/product/research-source.ts')>();
 return{...actual,resolveSdkResearchCitation:vi.fn((root:string,base:string,value:unknown,symbol?:string)=>{
  const ref=actual.parseSdkResearchCitation(value,base);if(root!=='/held/source')throw new Error('Controlled unit root denied');
  return{source:'export interface WorkdayIntent { schemaVersion:string;teamId:string;profileId:string;projects:string;executionMode:string;startsAt:string;planningOnly:boolean;proposalIds:string[];decisionIds:string[];agentSelection:unknown;allocation:unknown; }',blob:'b'.repeat(40),sourceSha256:'c'.repeat(64),symbol,line:Number(ref.anchor?.slice(1))};
 })};
});

it('requires actual preliminary bytes actionable independent findings a substantive source-complete correction and a separately approved exact artifact without fabricating or rewriting the revision chain',async()=>{
 const verify=Reflect.get(product,'verifySdkResearchRevision')as((items:Record<string,any>[],scope:Record<string,any>,root:string,base:string,read:(ref:Record<string,any>)=>unknown|Promise<unknown>)=>Promise<Record<string,unknown>>)|undefined;
 expect(verify,'genuine research revision must consume actual original artifacts and findings').toBeTypeOf('function');if(!verify)return;
 const f=researchRevisionFixture(),held=structuredClone({items:f.items,views:[...f.views]});
 await expect(verify(f.items,f.scope,'/held/source','a'.repeat(40),f.read)).resolves.toMatchObject({firstActorId:f.first.id,requestChangesId:f.requested.id,correctionActorId:f.corrected.id,approvalId:f.approval.id});expect({items:f.items,views:[...f.views]}).toEqual(held);
 for(const mode of ['missing-first','missing-request','missing-correction','missing-approval','duplicate-attempt','same-reviewer','foreign-workday','foreign-project','wrong-source','missing-source-context','missing-review-predecessor','missing-correction-predecessor','missing-finding-context','missing-finding-read-grant','mutable-candidate','early-correction','early-approval','wrong-request-disposition','wrong-approval-disposition','same-artifact','changed-readback','missing-finding','altered-finding']){
  const x=researchRevisionFixture();let read=x.read;
  if(mode.startsWith('missing-')&&['first','request','correction','approval'].includes(mode.slice(8)))x.items.splice(['first','request','correction','approval'].indexOf(mode.slice(8)),1);
  if(mode==='duplicate-attempt')x.items.push(structuredClone(x.first));
  if(mode==='same-reviewer')x.requested.assignmentAttempt.agentClass=x.first.assignmentAttempt.agentClass;
  if(mode==='foreign-workday')x.corrected.assignmentAttempt.workdayId='foreign';
  if(mode==='foreign-project')x.corrected.assignmentAttempt.projectId='foreign';
  if(mode==='wrong-source')x.corrected.assignmentAttempt.sourceRef.commit='e'.repeat(40);
  if(mode==='missing-source-context')x.corrected.assignmentAttempt.contextRefs=x.corrected.assignmentAttempt.contextRefs.filter((ref:any)=>ref.store!=='git');
  if(mode==='missing-review-predecessor')x.requested.assignmentAttempt.predecessorResultIds=[];
  if(mode==='missing-correction-predecessor')x.corrected.assignmentAttempt.predecessorResultIds=[];
  if(mode==='missing-finding-context')x.corrected.assignmentAttempt.contextRefs=x.corrected.assignmentAttempt.contextRefs.filter((ref:any)=>ref.id!=='review-findings');
  if(mode==='missing-finding-read-grant')x.corrected.assignmentAttempt.grant.contentRead=x.corrected.assignmentAttempt.grant.contentRead.filter((ref:any)=>ref.id!=='review-findings');
  if(mode==='mutable-candidate')x.requested.assignmentAttempt.workspace.writablePaths.push(x.firstPublication.reference.path);
  if(mode==='early-correction')x.corrected.assignmentAttempt.createdAt=x.first.assignmentAttempt.createdAt;
  if(mode==='early-approval')x.approval.assignmentAttempt.createdAt=x.requested.assignmentAttempt.createdAt;
  if(mode==='wrong-request-disposition')x.requested.lifecycleOutput.activityCompletion.reviewDisposition='approved';
  if(mode==='wrong-approval-disposition')x.approval.lifecycleOutput.activityCompletion.reviewDisposition='request-changes';
  if(mode==='same-artifact')x.corrected.assignmentResult.references=[x.firstPublication.reference];
  if(mode==='missing-finding')x.requested.assignmentResult.references=x.requested.assignmentResult.references.filter((ref:any)=>ref.path.startsWith('decisions/'));
  if(mode==='altered-finding'){const value=x.views.get(x.changes[0]!.reference.commit+':'+x.changes[0]!.reference.path)!;value.files[0].content+='Altered original findings.\n';value.files[0].body+='\nAltered original findings.';}
  if(mode==='changed-readback'){let count=0;read=(ref)=>{const value=x.read(ref);return++count>5?{...value,resolvedRef:'f'.repeat(40)}:value;};}
  const before=structuredClone({items:x.items,views:[...x.views]});await expect(verify(x.items,x.scope,'/held/source','a'.repeat(40),read),mode).rejects.toThrow();expect({items:x.items,views:[...x.views]}).toEqual(before);
 }
});
