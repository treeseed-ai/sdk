import {z} from 'zod';
import {defineOperation} from '../../operation-builder.ts';
import {aiInstanceDraftSchema,aiNodeRegistrationSchema} from '../../../deployment/ai-instance.ts';
import {aiStorageBindingSchema} from '../../../deployment/ai/storage.ts';
const team=z.object({teamId:z.string().min(1)}).strict(),instance=team.extend({instanceId:z.string().uuid()});
const empty=z.object({}).strict(),record=z.record(z.unknown());
function descriptor(action:'list'|'show'|'put'|'remove'|'register'|'storageShow'|'storagePut'|'storageRemove',method:'GET'|'PUT'|'DELETE',path:`/v1/${string}`){const read=method==='GET';return {operationId:`ai.instances.${action}` as const,description:`${action} a team-owned AI configuration; no cloud provisioning.`,rest:{method,path},parameters:`treeseed.ai.instances.${action}.parameters/v1`,capability:read?'infrastructure.read':'infrastructure.write',authentication:'oauth' as const,oauthScopes:read?['treeseed:read']:['treeseed:admin'],kind:read?'read' as const:'mutation' as const,riskClass:'ordinary' as const,confirmation:'never' as const,surfaces:['rest','cli'] as ('rest'|'cli')[],cacheScope:read?'principal' as const:'none' as const,pagination:'none' as const,concurrencyRequired:!read};}
export const AI_INSTANCE_OPERATIONS={
 storageShow:defineOperation({...descriptor('storageShow','GET','/v1/teams/{teamId}/ai-instances/{instanceId}/storage'),operationId:'ai.instances.storage.show',parameters:'treeseed.ai.instances.storage.show.parameters/v1'},{path:instance,query:empty,body:z.undefined(),output:record}),
 storagePut:defineOperation({...descriptor('storagePut','PUT','/v1/teams/{teamId}/ai-instances/{instanceId}/storage'),operationId:'ai.instances.storage.put',parameters:'treeseed.ai.instances.storage.put.parameters/v1'},{path:instance,query:empty,body:aiStorageBindingSchema,output:record}),
 storageRemove:defineOperation({...descriptor('storageRemove','DELETE','/v1/teams/{teamId}/ai-instances/{instanceId}/storage'),operationId:'ai.instances.storage.remove',parameters:'treeseed.ai.instances.storage.remove.parameters/v1'},{path:instance,query:empty,body:empty,output:record}),
 register:defineOperation(descriptor('register','PUT','/v1/teams/{teamId}/ai-instances/{instanceId}/registration'),{path:instance,query:empty,body:aiNodeRegistrationSchema,output:record}),
 list:defineOperation({...descriptor('list','GET','/v1/teams/{teamId}/ai-instances'),pagination:'cursor'},{path:team,query:z.object({cursor:z.string().optional(),limit:z.coerce.number().int().min(1).max(100).optional()}).strict(),body:z.undefined(),output:record}),
 show:defineOperation(descriptor('show','GET','/v1/teams/{teamId}/ai-instances/{instanceId}'),{path:instance,query:empty,body:z.undefined(),output:record}),
 put:defineOperation(descriptor('put','PUT','/v1/teams/{teamId}/ai-instances/{instanceId}'),{path:instance,query:empty,body:aiInstanceDraftSchema,output:record}),
 remove:defineOperation(descriptor('remove','DELETE','/v1/teams/{teamId}/ai-instances/{instanceId}'),{path:instance,query:empty,body:empty,output:record}),
};
