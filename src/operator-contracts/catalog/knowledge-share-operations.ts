import { z } from 'zod';
import { defineOperation as define } from '../operation-builder.ts';
import { knowledgeShareGrantInputSchema, knowledgeShareSchema, teamKnowledgeRequestSchema } from '../knowledge/contracts.ts';

const none=z.undefined(),empty=z.object({}).strict(),teamPath=z.object({teamId:z.string().min(1)}).strict();
const sharePath=z.object({teamId:z.string().min(1),shareId:z.string().min(1)}).strict();
const parameters=(operationId:string)=>`treeseed.${operationId}.parameters/v1`;
const readDescriptor=(operationId:`${string}.${string}`,path:`/v1/${string}`)=>({operationId,description:`Read ${operationId}.`,rest:{method:'GET' as const,path},parameters:parameters(operationId),capability:'knowledge.read',authentication:'oauth' as const,oauthScopes:['treeseed:read' as const],kind:'read' as const,riskClass:'ordinary' as const,confirmation:'never' as const,surfaces:['rest' as const,'cli' as const,'mcp_tool' as const],cacheScope:'principal' as const,pagination:'none' as const});
const execute=(operationId:`${string}.${string}`,path:`/v1/${string}`)=>define({operationId,description:`Execute ${operationId} across authorized team knowledge.`,rest:{method:'POST',path},parameters:parameters(operationId),capability:'knowledge.read',authentication:'oauth',oauthScopes:['treeseed:read'],kind:'read',riskClass:'ordinary',confirmation:'never',surfaces:['rest','mcp_tool'],cacheScope:'none',pagination:'none'}, {path:teamPath,query:empty,body:teamKnowledgeRequestSchema,output:z.record(z.unknown())});

export function knowledgeShareOperations(){return {
	shares:{
		list:define(readDescriptor('knowledge.shares.list','/v1/teams/{teamId}/knowledge/shares'),{path:teamPath,query:empty,body:none,output:z.object({items:z.array(knowledgeShareSchema)}).strict()}),
		show:define(readDescriptor('knowledge.shares.show','/v1/teams/{teamId}/knowledge/shares/{shareId}'),{path:sharePath,query:empty,body:none,output:knowledgeShareSchema}),
		grant:define({operationId:'knowledge.shares.grant',description:'Grant bounded read-only knowledge access to another team.',rest:{method:'POST',path:'/v1/teams/{teamId}/knowledge/shares'},parameters:parameters('knowledge.shares.grant'),capability:'knowledge.share',authentication:'oauth',oauthScopes:['treeseed:projects:write'],kind:'mutation',riskClass:'authority',confirmation:'input_required',surfaces:['rest','cli','mcp_tool'],cacheScope:'none',pagination:'none'}, {path:teamPath,query:empty,body:knowledgeShareGrantInputSchema,output:knowledgeShareSchema}),
		revoke:define({operationId:'knowledge.shares.revoke',description:'Revoke a cross-team knowledge share.',rest:{method:'DELETE',path:'/v1/teams/{teamId}/knowledge/shares/{shareId}'},parameters:parameters('knowledge.shares.revoke'),capability:'knowledge.share',authentication:'oauth',oauthScopes:['treeseed:projects:write'],kind:'mutation',riskClass:'authority',confirmation:'input_required',surfaces:['rest','cli','mcp_tool'],cacheScope:'none',pagination:'none'}, {path:sharePath,query:empty,body:empty,output:knowledgeShareSchema}),
	},
	teamSearch:execute('knowledge.team.search','/v1/teams/{teamId}/knowledge/search'),
	teamQuery:execute('knowledge.team.query','/v1/teams/{teamId}/knowledge/query'),
	teamContext:execute('knowledge.team.context','/v1/teams/{teamId}/knowledge/context'),
	teamGraph:execute('knowledge.team.graph','/v1/teams/{teamId}/knowledge/graph'),
};}
