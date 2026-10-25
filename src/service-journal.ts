import {z} from 'zod';
import {PlatformSchemas,ServiceSchemas} from './schemas.js';
import {PluginManagementSchemas} from './management.js';
class RequestRecordValidation {
 static valid(value:{requestId:string;installationDirectory:string;operation:string;intent:{idempotencyKey:string;installationDirectory:string;expectedGeneration?:string|null};expectedGeneration:string|null;stage:string;resolution:unknown;sourceReceipt:{name:string;version:string;archiveDigest:string}|null;result:{requestId:string;state:string;artifact:{package:string;version:string;integrity:string}|null}|null}):boolean{
  if(value.requestId!==value.intent.idempotencyKey||value.installationDirectory!==value.intent.installationDirectory||(value.operation==='install')!==Object.hasOwn(value.intent,'source')||(value.intent.expectedGeneration!==undefined&&value.intent.expectedGeneration!==value.expectedGeneration))return false;
  if(value.result&&value.result.requestId!==value.requestId)return false;
  if(value.sourceReceipt!==null&&value.resolution===null)return false;
  if(value.stage==='resolved'&&value.resolution===null)return false;
  if(value.stage==='active'){if(!value.result||!['active','already-active'].includes(value.result.state)||!value.sourceReceipt||!value.result.artifact||value.result.artifact.package!==value.sourceReceipt.name||value.result.artifact.version!==value.sourceReceipt.version||value.result.artifact.integrity!==value.sourceReceipt.archiveDigest)return false;}
  return true;
 }
}
export class ServiceWorkerSchemas {
 static readonly submit=z.strictObject({protocol:z.literal(3),operation:z.literal('submit'),planId:PlatformSchemas.text,digest:PlatformSchemas.digest,idempotencyKey:PluginManagementSchemas.key});
 static readonly request=z.discriminatedUnion('operation',[this.submit,z.strictObject({protocol:z.literal(3),operation:z.literal('observation.context'),serviceId:ServiceSchemas.serviceId}),z.strictObject({protocol:z.literal(3),operation:z.literal('plan'),configuration:ServiceSchemas.configuration}),z.strictObject({protocol:z.literal(3),operation:z.literal('status')}),z.strictObject({protocol:z.literal(3),operation:z.literal('application'),id:PlatformSchemas.text}),z.strictObject({protocol:z.literal(3),operation:z.literal('plugin.install'),request:PluginManagementSchemas.install}),z.strictObject({protocol:z.literal(3),operation:z.literal('plugin.select'),request:PluginManagementSchemas.select}),z.strictObject({protocol:z.literal(3),operation:z.literal('plugin.list'),scope:PluginManagementSchemas.scope,target:PluginManagementSchemas.target.optional()}),z.strictObject({protocol:z.literal(3),operation:z.literal('plugin.inspect'),requestId:PluginManagementSchemas.key})]);
 static readonly response=z.discriminatedUnion('success',[z.strictObject({protocol:z.literal(3),success:z.literal(true),result:z.union([ServiceSchemas.observationContext,ServiceSchemas.plan,ServiceSchemas.status,ServiceSchemas.applicationRecord,PlatformSchemas.application,PlatformSchemas.apply,PluginManagementSchemas.result,z.array(PluginManagementSchemas.result)])}),z.strictObject({protocol:z.literal(3),success:z.literal(false),kind:z.enum(['blocked','runtime']),blockers:z.array(PlatformSchemas.blocker).min(1)})]);
 static readonly requestRecord=z.strictObject({formatVersion:z.literal(1),requestId:PluginManagementSchemas.key,installationId:PlatformSchemas.text,installationDirectory:PlatformSchemas.absolute,sequence:z.number().int().nonnegative(),operation:z.enum(['install','select']),intent:z.union([PluginManagementSchemas.install,PluginManagementSchemas.select]),intentDigest:PlatformSchemas.digest,expectedGeneration:PlatformSchemas.digest.nullable(),policyDigest:PlatformSchemas.digest,stage:z.enum(['received','resolving','resolved','acquired','prepared','pending','active','blocked','recovery-required']),resolution:PluginManagementSchemas.resolution.nullable(),sourceReceipt:PluginManagementSchemas.sourceReceipt.nullable(),result:PluginManagementSchemas.result.nullable()}).refine(RequestRecordValidation.valid);
}
export type ServiceWorkerRequest=z.infer<typeof ServiceWorkerSchemas.request>;
export type ServiceWorkerResponse=z.infer<typeof ServiceWorkerSchemas.response>;
export type PluginRequestRecord=z.infer<typeof ServiceWorkerSchemas.requestRecord>;
