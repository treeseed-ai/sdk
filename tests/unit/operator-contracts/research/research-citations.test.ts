import{afterEach,expect,it,vi}from'vitest';
import*as product from'../../../acceptance/golden-product.ts';

// Controlled unit source observations. The native case resolves original SDK Git blobs.
vi.mock('../../../acceptance/product/research-source.ts',async importOriginal=>{
 const actual=await importOriginal<typeof import('../../../acceptance/product/research-source.ts')>();
 const locations=[['src/operator-contracts/workday-lifecycle.ts','WorkdayIntent',54],['src/entrypoints/clients/control-plane-client.ts','ControlPlaneClient.invoke',188],['src/operator-contracts/control-plane-operations.ts','workdays.plan',290],['src/operator-contracts/control-plane-operations.ts','workdays.schedules.create',296],['src/operator-contracts/canonical-command-tree.ts','workdays.plan',157],['src/operator-contracts/canonical-command-tree.ts','workdays.schedules.create',165],['src/operator-contracts/workday-lifecycle.ts','WorkdayPreflightReceipt',115],['src/operator-contracts/catalog/workdays/selection-commands.ts','WORKDAY_PLAN_OPTIONS',24]]as const;
 return{...actual,resolveSdkResearchCitation:vi.fn((root:string,base:string,value:unknown,symbol?:string)=>{
  const ref=actual.parseSdkResearchCitation(value,base),found=locations.find(([path,name,line])=>ref.path===path&&ref.anchor==='L'+line&&(!symbol||symbol===name));
  if(!found||root!=='/held/source')throw new Error('ACCEPTANCE_SDK_RESEARCH_CITATION: Controlled unit source location denied');
  return{source:'export interface WorkdayIntent { schemaVersion:string;teamId:string;profileId:string;projects:string;executionMode:string;startsAt:string;planningOnly:boolean;proposalIds:string[];decisionIds:string[];agentSelection:unknown;allocation:unknown; }',blob:'b'.repeat(40),sourceSha256:'c'.repeat(64),symbol:found[1],line:found[2]};
 })};
});
afterEach(()=>vi.restoreAllMocks());

it('requires only the two native preliminary source findings with explicit pending boundaries and complete corrected source proof instead of keyword-only coverage',()=>{
 const verify=Reflect.get(product,'verifySdkResearchCitations')as((artifact:{body:string;frontmatter:Record<string,unknown>},root:string,base:string,stage:'preliminary'|'corrected')=>unknown)|undefined;
 expect(verify,'actual research source claims require executable native proof').toBeTypeOf('function');if(!verify)return;
 const base='a'.repeat(40),urls=[['src/operator-contracts/workday-lifecycle.ts',54],['src/entrypoints/clients/control-plane-client.ts',188],['src/operator-contracts/control-plane-operations.ts',290],['src/operator-contracts/control-plane-operations.ts',296],['src/operator-contracts/canonical-command-tree.ts',157],['src/operator-contracts/canonical-command-tree.ts',165],['src/operator-contracts/workday-lifecycle.ts',115],['src/operator-contracts/catalog/workdays/selection-commands.ts',24]].map(([path,line])=>'https://github.com/treeseed-ai/sdk/blob/'+base+'/'+path+'#L'+line);
 const pending='Operation bindings: pending.\n\nGenerated descriptors: pending.\n\nPer-field provenance: pending.';
 const initial={frontmatter:{},body:urls.slice(0,2).join('\n\n')+'\n\n'+pending},corrected={frontmatter:{},body:urls.join('\n\n')+'\n\nexecutionPlanId, capacityPlanId, executionInputId and demandSetId are absent SDK caller fields. API-owned receipt declarations remain separate.'},held=structuredClone({initial,corrected});
 expect(()=>verify({...initial,frontmatter:{documentationUrls:[urls[2]]}},'/held/source',base,'preliminary')).toThrow('ACCEPTANCE_SDK_RESEARCH_SOURCES');
 expect(()=>verify(initial,'/held/source',base,'preliminary')).not.toThrow();expect(()=>verify(corrected,'/held/source',base,'corrected')).not.toThrow();expect({initial,corrected}).toEqual(held);
 for(const line of pending.split('\n\n'))expect(()=>verify({...initial,body:initial.body.replace(line,'')},'/held/source',base,'preliminary')).toThrow('ACCEPTANCE_SDK_RESEARCH_SOURCES');
 for(const value of [initial.body.replace(urls[0]!,''),initial.body+'\n'+urls[2],initial.body+'\nhttps://example.test/unverified',initial.body.replace(base,'staging'),pending, 'WorkdayIntent ControlPlaneClient.invoke pending operation bindings generated descriptors per-field provenance'])expect(()=>verify({...initial,body:value},'/held/source',base,'preliminary')).toThrow();
 for(const url of urls)expect(()=>verify({...corrected,body:corrected.body.replace(url,'')},'/held/source',base,'corrected')).toThrow('ACCEPTANCE_SDK_RESEARCH_SOURCES');
 for(const name of ['executionPlanId','capacityPlanId','executionInputId','demandSetId'])expect(()=>verify({...corrected,body:corrected.body.replace(name,'')},'/held/source',base,'corrected')).toThrow('ACCEPTANCE_SDK_RESEARCH_SOURCES');
 expect(()=>verify({...corrected,body:corrected.body.replace('#L290','#L1')},'/held/source',base,'corrected')).toThrow();
 expect(()=>verify({...corrected,frontmatter:{relatedRefs:[{store:'git',model:'repository',id:'foreign',repository:'treeseed-ai/foreign',commit:base,path:'src/unknown.ts',anchor:'L1'}]}},'/held/source',base,'corrected')).toThrow();
});
