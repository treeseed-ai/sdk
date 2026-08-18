import { createHash } from 'node:crypto';
import { parseFrontmatterDocument,serializeFrontmatterDocument } from '../../content/frontmatter.ts';

export type AgentDeploymentEntityKind='agent'|'group'|'group-edge'|'context-query'|'context-query-set'|'instruction-template'|'discussion-topic'|'signal'|'proposal-type'|'agent-test';
export type AgentDeploymentSelector={sourceTeamId:string;sourceProjectId:string;sourceRepositoryId:string;sourceRef:string;agentId:string;groupId?:never}
	|{sourceTeamId:string;sourceProjectId:string;sourceRepositoryId:string;sourceRef:string;groupId:string;agentId?:never};
export interface AgentDeploymentBindings { targetProjectId:string;targetContentRoot:string;repositoryRoles?:Record<string,string>;paths?:Record<string,string>;books?:Record<string,string>;objectives?:Record<string,string>;topics?:Record<string,string>;groups?:Record<string,string>;providerCapabilities?:Record<string,string> }
export interface AgentForkProvenance { sourceTeamId:string;sourceProjectId:string;sourceEntityId:string;sourcePath:string;sourceRef:string;sourceDigest:string;deploymentId:string;generation:string;lastImportedSourceRef:string;targetBaseRef:string }
export interface PortableAgentDeploymentEntity { kind:AgentDeploymentEntityKind;id:string;path:string;source:string;digest:string;references:string[];groupIds?:string[];enabled?:boolean }
export interface AgentDeploymentTargetEntity extends PortableAgentDeploymentEntity { targetPath:string;action:'create'|'noop'|'conflict';provenance:AgentForkProvenance;sourceEnabled?:boolean;diagnostics:string[] }
export interface AgentDeploymentPlan { schemaVersion:'treeseed.agent-deployment-plan/v1';id:string;selector:AgentDeploymentSelector;bindings:AgentDeploymentBindings;sourceGeneration:string;targetBaseRef:string;selectedAgentIds:string[];entities:AgentDeploymentTargetEntity[];unresolvedBindings:string[];conflicts:string[];activationPrerequisites:string[];ok:boolean }
export interface AgentDeploymentReceipt { schemaVersion:'treeseed.agent-deployment-receipt/v1';deploymentId:string;targetProjectId:string;beforeRef:string;afterRef:string;changedPaths:string[];definitionDigests:Record<string,string>;tests:string[];readBackVerified:boolean;activationState:'dormant'|'active'|'blocked';createdAt:string }

function digest(value:string){return `sha256:${createHash('sha256').update(value).digest('hex')}`;}
function exact(value:string){return value.trim()&&!/^(?:HEAD|main|master|staging|latest)$/iu.test(value.trim());}
function targetPath(entity:PortableAgentDeploymentEntity,bindings:AgentDeploymentBindings){
	const content=bindings.targetContentRoot.replace(/^\/+|\/+$/gu,''); const marker='/src/content/'; const docsMarker='/docs/src/content/';
	const index=entity.path.indexOf(docsMarker)>=0?entity.path.indexOf(docsMarker)+docsMarker.length:entity.path.indexOf(marker)>=0?entity.path.indexOf(marker)+marker.length:-1;
	if(index>=0)return `${content}/${entity.path.slice(index)}`;
	return entity.path;
}
function requiredBindingRefs(entity:PortableAgentDeploymentEntity,bindings:AgentDeploymentBindings){
	return entity.references.filter((reference)=>reference.startsWith('book:')&&!bindings.books?.[reference]
		||reference.startsWith('objective:')&&!bindings.objectives?.[reference]
		||reference.startsWith('topic:')&&!bindings.topics?.[reference]
		||reference.startsWith('repository-role:')&&!bindings.repositoryRoles?.[reference]
		||reference.startsWith('provider-capability:')&&!bindings.providerCapabilities?.[reference]);
}

export function compileDormantAgentForkSource(entity:PortableAgentDeploymentEntity,provenance:AgentForkProvenance) {
	if(entity.kind!=='agent') return entity.source;
	const parsed=parseFrontmatterDocument(entity.source); const frontmatter={...parsed.frontmatter,enabled:false,forkProvenance:provenance};
	return serializeFrontmatterDocument(frontmatter,parsed.body);
}

export function planAgentDeployment(input:{selector:AgentDeploymentSelector;bindings:AgentDeploymentBindings;entities:PortableAgentDeploymentEntity[];targetBaseRef:string;targetEntities?:PortableAgentDeploymentEntity[];generation:string;deploymentId?:string}):AgentDeploymentPlan {
	if(!exact(input.selector.sourceRef)||!exact(input.targetBaseRef)) throw new Error('Agent deployment requires exact source and target refs.');
	if(Boolean(input.selector.agentId)===Boolean(input.selector.groupId)) throw new Error('Choose exactly one agent or group selector.');
	const byId=new Map(input.entities.map((entity)=>[entity.id,entity])); const selectedAgents=input.selector.agentId?[input.selector.agentId]:input.entities.filter((entity)=>entity.kind==='agent'&&entity.groupIds?.includes(input.selector.groupId!)).map((entity)=>entity.id).sort();
	if(!selectedAgents.length) throw new Error('The deployment selector resolved no agents.');
	const selected=new Set<string>(selectedAgents); if(input.selector.groupId)selected.add(input.selector.groupId);
	const queue=[...selected]; while(queue.length){const entity=byId.get(queue.shift()!);if(!entity)continue;for(const reference of entity.references)if(byId.has(reference)&&!selected.has(reference)){selected.add(reference);queue.push(reference);}}
	const deploymentId=input.deploymentId??`agent-deployment:${digest(`${input.selector.sourceProjectId}:${input.selector.sourceRef}:${selectedAgents.join(',')}:${input.bindings.targetProjectId}`).slice(7,31)}`;
	const targetByPath=new Map((input.targetEntities??[]).map((entity)=>[entity.path,entity])); const unresolvedBindings:string[]=[];const conflicts:string[]=[];
	const entities=[...selected].map((id)=>byId.get(id)).filter((entity):entity is PortableAgentDeploymentEntity=>Boolean(entity)).sort((a,b)=>a.path.localeCompare(b.path)).map((entity):AgentDeploymentTargetEntity=>{
		const path=targetPath(entity,input.bindings); const existing=targetByPath.get(path); const unresolved=requiredBindingRefs(entity,input.bindings); unresolvedBindings.push(...unresolved.map((binding)=>`${entity.id}:${binding}`));
		const provenance:AgentForkProvenance={sourceTeamId:input.selector.sourceTeamId,sourceProjectId:input.selector.sourceProjectId,sourceEntityId:entity.id,sourcePath:entity.path,sourceRef:input.selector.sourceRef,sourceDigest:entity.digest,deploymentId,generation:input.generation,lastImportedSourceRef:input.selector.sourceRef,targetBaseRef:input.targetBaseRef};
		const source=compileDormantAgentForkSource(entity,provenance); const sourceDigest=digest(source); const action=!existing?'create':existing.digest===sourceDigest?'noop':'conflict';if(action==='conflict')conflicts.push(path);
		return {...entity,source,digest:sourceDigest,targetPath:path,action,provenance,sourceEnabled:entity.enabled,diagnostics:unresolved};
	});
	const activationPrerequisites=['schema-and-reference-validation','dynamic-context-tests','permission-and-path-fit','signal-and-proposal-contracts','provider-capabilities','profile-forbidden-authority-tests','unchanged-source-and-target-refs'];
	return {schemaVersion:'treeseed.agent-deployment-plan/v1',id:deploymentId,selector:input.selector,bindings:input.bindings,sourceGeneration:input.generation,targetBaseRef:input.targetBaseRef,selectedAgentIds:selectedAgents,entities,unresolvedBindings:[...new Set(unresolvedBindings)].sort(),conflicts:[...new Set(conflicts)].sort(),activationPrerequisites,ok:unresolvedBindings.length===0&&conflicts.length===0};
}
