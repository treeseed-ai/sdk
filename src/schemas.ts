import {PluginSource} from './plugin-source.js';
import { z } from 'zod';

class PlanningValidation {
  static unique(values:string[]):boolean {return new Set(values).size===values.length;}
}
export class PlatformSchemas {
  static readonly text=z.string().trim().min(1);
  static readonly digest=z.string().regex(/^[a-f0-9]{64}$/);
  static readonly absolute=z.string().regex(/^\//);
  static readonly phase=z.enum(['resolve','validate','stage','prepare','drain','activate','readiness','commit','completed','failed','cancelled']);
  static readonly blocker=z.strictObject({code:this.text,message:this.text});
  static readonly artifact=z.strictObject({package:this.text,version:this.text,integrity:this.digest});
  static readonly plugin=z.strictObject({id:this.text,package:this.text,version:this.text,integrity:this.digest});
  static readonly pluginStatus=z.strictObject({id:this.text,ready:z.boolean()});
  static readonly slot=z.string().regex(/^[a-z][a-z0-9-]{0,62}$/);
  static readonly relative=z.string().regex(/^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[a-zA-Z0-9_@./-]+$/);
  static readonly packageName=z.string().regex(/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/);
  static readonly version=z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?(?:\+[a-zA-Z0-9.-]+)?$/);
  static readonly strings=z.array(this.text).refine(PlanningValidation.unique);
  static readonly desired=z.strictObject({installationId:this.text,engineContext:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/),installationDirectory:this.absolute,origin:z.url().regex(/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?\/?$/),runtimeState:z.enum(['running','stopped']),plugins:z.array(this.plugin).min(1),credentialReferences:z.array(z.string().regex(/^secret:\/\/[a-z][a-z0-9-]{0,62}$/)).refine(PlanningValidation.unique),release:z.strictObject({directory:this.absolute,manifestDigest:this.digest})});
  static readonly file=z.strictObject({path:this.relative,sha256:this.digest});
  static readonly imageReference=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*@sha256:[a-f0-9]{64}$/);
  static readonly pluginDefinition=z.strictObject({id:this.slot,contractVersion:z.literal('0.2.0-cordis.1'),provide:this.strings,inject:this.strings});
  static readonly release=z.strictObject({formatVersion:z.literal(1),packageJson:this.file,lockfile:this.file,recipe:this.file,requiredPluginIds:this.strings,requiredServices:this.strings,packages:z.array(z.strictObject({name:this.packageName,version:this.version,path:this.relative,sha256:this.digest})).min(1),images:z.array(z.strictObject({id:this.slot,reference:this.imageReference,layout:this.relative,indexSha256:this.digest,manifestDigest:this.digest})).min(1)});
  static readonly recipe=z.strictObject({services:z.record(this.slot,z.strictObject({image:this.imageReference,depends_on:z.array(this.slot).optional(),ports:z.array(z.strictObject({target:z.number().int().min(1).max(65535),published:z.number().int().min(1).max(65535),host_ip:z.enum(['127.0.0.1','::1']),protocol:z.literal('tcp')})).optional(),volumes:z.array(z.strictObject({type:z.literal('volume'),source:this.slot,target:z.string().regex(/^\/(?!.*(?:^|\/)\.\.?(?:\/|$))[^\x00]*$/),read_only:z.boolean().optional()})).optional(),secrets:z.array(this.slot).optional()})),volumes:z.record(this.slot,z.strictObject({})),secrets:z.record(this.slot,z.strictObject({file:this.relative}))});
  static readonly expectedEngine=z.strictObject({context:this.text,endpoint:z.string().regex(/^unix:\/\/\//),daemonId:this.text,os:z.literal('linux'),architecture:z.literal('amd64')});
  static readonly resolvedArtifact=z.discriminatedUnion('kind',[z.strictObject({kind:z.literal('package'),name:this.packageName,version:this.version,sha256:this.digest}),z.strictObject({kind:z.literal('image'),reference:this.imageReference,manifestDigest:this.digest,configDigest:this.digest,layerDigests:z.array(this.digest)})]);
  static readonly effect=z.strictObject({kind:z.enum(['stage-package','stage-image','prepare-credential','create-volume','create-network','configure-service','start-service']),target:this.text});
  static readonly describe=z.strictObject({contractVersion:this.text,platformVersion:this.text,schemaDigest:this.digest,plugins:z.array(this.pluginStatus),operations:z.array(this.text)});
  static readonly status=z.strictObject({installationId:this.text,engine:this.text,desiredComposition:this.digest.nullable(),activeComposition:this.digest.nullable(),ready:z.boolean(),plugins:z.array(this.pluginStatus),blockers:z.array(this.blocker),applicationId:this.text.nullable()});
  static readonly plan=z.strictObject({formatVersion:z.literal(1),id:z.string().regex(/^plan-[a-f0-9]{64}$/),digest:this.digest,configuration:this.desired,recipe:this.recipe,pluginBindings:z.array(this.pluginDefinition),configurationDigest:this.digest,releaseDigest:this.digest,recipeDigest:this.digest,lockDigest:this.digest,expectedEngine:this.expectedEngine,expectedComposition:z.null(),projectName:z.string().regex(/^cordis-[a-f0-9]{16}$/),artifacts:z.array(this.resolvedArtifact),effects:z.array(this.effect),blockers:z.array(this.blocker).max(0)});
  static readonly apply=z.strictObject({id:this.text,accepted:z.literal(true)});
  static readonly application=z.strictObject({id:this.text,phase:this.phase,desiredComposition:this.digest.nullable(),activeComposition:this.digest.nullable(),result:this.text.nullable(),recovery:this.text.nullable(),historyReference:this.text.nullable()});
  static readonly event=z.strictObject({sequence:z.number().int().nonnegative(),cursor:this.text,phase:this.phase,message:this.text});
  static readonly events=z.strictObject({events:z.array(this.event),nextCursor:this.text.nullable()});
  static readonly cancel=z.strictObject({id:this.text,cancellationRequested:z.boolean(),phase:this.phase});
  static readonly empty=z.strictObject({});
  static readonly configuration=z.strictObject({context:this.text.optional(),installationDirectory:this.absolute.optional(),port:z.number().int().min(1).max(65535).optional()});
  static readonly check=z.strictObject({id:this.text,status:z.enum(['pass','blocked']),code:this.text,message:this.text});
  static readonly diagnostic=z.strictObject({ready:z.boolean(),host:z.strictObject({os:this.text,architecture:this.text,distribution:this.text,release:this.text}),engine:z.strictObject({context:this.text.nullable(),endpoint:this.text.nullable(),serverVersion:this.text.nullable(),serverArchitecture:this.text.nullable(),composeVersion:this.text.nullable(),cpus:z.number().nonnegative().nullable(),memoryBytes:z.number().nonnegative().nullable()}),installation:z.strictObject({path:this.absolute,exists:z.boolean(),freeBytes:z.number().nonnegative().nullable()}),port:z.number().int().min(1).max(65535),checks:z.array(this.check)});
  static readonly problem=z.strictObject({code:this.text,title:this.text,detail:this.text});
  static readonly envelopeBase=z.strictObject({command:this.text,success:z.boolean(),result:z.union([this.plan,this.diagnostic,z.strictObject({version:this.text}),z.strictObject({help:this.text})]).nullable(),problem:this.problem.nullable(),blockers:z.array(this.blocker),references:z.array(this.text)});
  static readonly envelope=z.discriminatedUnion('success',[this.envelopeBase.extend({success:z.literal(true),problem:z.null()}),this.envelopeBase.extend({success:z.literal(false),problem:this.problem})]);
}
class SourceToolValidation {
 static helper(value:{url?:string;path?:string;entry:string;files:Array<{path:string;mode:number}>;libraryDirectories:string[];executableDirectory?:string}):boolean{if((value.url!==undefined)===(value.path!==undefined))return false;const paths=new Set<string>();let executable=false;for(const file of value.files){if(paths.has(file.path))return false;paths.add(file.path);if(file.path===value.entry&&file.mode===0o500)executable=true;}if(!executable||new Set(value.libraryDirectories).size!==value.libraryDirectories.length)return false;for(const directory of [...value.libraryDirectories,...value.executableDirectory?[value.executableDirectory]:[]]){let found=false;for(const path of paths)if(path.startsWith(directory+'/'))found=true;if(!found)return false;}return true;}
 static inventory(value:{helpers:Array<{id:string}>}):boolean{const ids=new Set<string>();for(const helper of value.helpers){if(ids.has(helper.id))return false;ids.add(helper.id);}return true;}
}
export class SourceToolSchemas {
 static readonly helper=z.strictObject({id:PlatformSchemas.slot,version:PlatformSchemas.version,platform:z.literal('linux-amd64'),url:z.string().refine(PluginSource.https).optional(),path:PlatformSchemas.relative.optional(),sha256:PlatformSchemas.digest,size:z.number().int().positive().max(512*1024*1024),entry:PlatformSchemas.relative,files:z.array(PlatformSchemas.file.extend({mode:z.union([z.literal(0o400),z.literal(0o500)])})).min(1).max(8192),libraryDirectories:z.array(PlatformSchemas.relative).max(64),executableDirectory:PlatformSchemas.relative.optional()}).refine(SourceToolValidation.helper);
 static readonly helperInventory=z.strictObject({formatVersion:z.literal(1),releaseIdentity:PlatformSchemas.digest,helpers:z.array(this.helper).min(1).max(16)}).refine(SourceToolValidation.inventory);
}
export type SourceToolInventory=z.infer<typeof SourceToolSchemas.helperInventory>;
export type SourceToolDefinition=z.infer<typeof SourceToolSchemas.helper>;
export type DiagnosticConfiguration=z.infer<typeof PlatformSchemas.configuration>;
export type DiagnosticReport=z.infer<typeof PlatformSchemas.diagnostic>;
export type CliEnvelope=z.infer<typeof PlatformSchemas.envelope>;
export type ApplicationPhase=z.infer<typeof PlatformSchemas.phase>;
export interface OperationMetadata<I extends z.ZodType=z.ZodType,O extends z.ZodType=z.ZodType> {
  readonly id:string; readonly input:I; readonly output:O; readonly scope:'platform.read'|'platform.manage';
  readonly effect:'read'|'write'; readonly rest:Readonly<{method:'GET'|'POST';path:string}>;
  readonly cli:string; readonly mcp:string; readonly exposure:readonly ['rest','cli','mcp'];
  readonly idempotency:boolean; readonly expectedState:boolean;
}
export class OperationDefinition<I extends z.ZodType=z.ZodType,O extends z.ZodType=z.ZodType> {
  private constructor(readonly definition:OperationMetadata<I,O>) {}
  static define<I extends z.ZodType,O extends z.ZodType>(definition:OperationMetadata<I,O>):OperationDefinition<I,O> {
    for(const schema of [definition.input,definition.output]) {
      this.strict(schema);
    }
    const write=definition.effect==='write';
    if(!/^platform\.[a-z]+(\.[a-z]+)?$/.test(definition.id)||definition.mcp!==definition.id.replaceAll('.','_')||!definition.cli.trim()||!definition.rest.path.startsWith('/v1/platform')||definition.scope!==(write?'platform.manage':'platform.read')||definition.rest.method!==(write?'POST':'GET')||definition.idempotency!==write||definition.expectedState!==write||definition.exposure.join(',')!=='rest,cli,mcp') throw new Error('Invalid operation policy');
    return new OperationDefinition(Object.freeze({...definition,rest:Object.freeze({...definition.rest}),exposure:Object.freeze([...definition.exposure]) as readonly ['rest','cli','mcp']}));
  }
  private static strict(schema:z.ZodType):void {
    if(schema instanceof z.ZodUnion){for(const option of schema.options)this.strict(option as z.ZodType);return;}
    if(!(schema instanceof z.ZodObject)||z.toJSONSchema(schema,{io:'input'}).additionalProperties!==false)throw new Error('Operation schemas must be strict objects');
  }
  parseInput(value:unknown):z.infer<I> { return this.definition.input.parse(value); }
  parseOutput(value:unknown):z.infer<O> { return this.definition.output.parse(value); }
}

export type DeploymentConfiguration=z.infer<typeof PlatformSchemas.desired>;
export type DeploymentPlan=z.infer<typeof PlatformSchemas.plan>;
export type ReleaseInventory=z.infer<typeof PlatformSchemas.release>;
export type DeploymentRecipe=z.infer<typeof PlatformSchemas.recipe>;
export type PluginMetadata=z.infer<typeof PlatformSchemas.pluginDefinition>;
export class PluginDefinition {
  static define(input:PluginMetadata):Readonly<PluginMetadata> {
    const value=PlatformSchemas.pluginDefinition.parse(input);
    return Object.freeze({...value,provide:Object.freeze([...value.provide].sort()) as unknown as string[],inject:Object.freeze([...value.inject].sort()) as unknown as string[]});
  }
}
export class PlanningBlockedError extends Error {
  readonly blockers:z.infer<typeof PlatformSchemas.blocker>[];
  constructor(blockers:z.infer<typeof PlatformSchemas.blocker>[]) {
    super('Deployment planning is blocked.');this.name='PlanningBlockedError';
    this.blockers=z.array(PlatformSchemas.blocker).min(1).parse(blockers);
  }
}
export class CanonicalJson {
  static stringify(value:unknown):string {return JSON.stringify(this.normalize(value));}
  private static normalize(value:unknown):unknown {
    if(value===null||typeof value==='string'||typeof value==='boolean')return value;
    if(typeof value==='number'&&Number.isFinite(value))return value;
    if(Array.isArray(value)){const result:unknown[]=[];for(const item of value)result.push(this.normalize(item));return result;}
    if(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype){const result:Record<string,unknown>={};for(const key of Object.keys(value).sort())Object.defineProperty(result,key,{value:this.normalize((value as Record<string,unknown>)[key]),enumerable:true});return result;}
    throw new Error('Unsupported canonical JSON value');
  }
}

/** Runtime composition declarations are separate from historical format-1 planning metadata. */
export class ProviderSchemas {
  static readonly version='0.3.0-cordis.1';
  static readonly id=z.string().regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/);
  static readonly target=z.enum(['cli','api','deployment','agent']);
  static readonly declaration=z.strictObject({id:this.id,pluginId:this.id,capability:this.id,contractVersion:z.literal('0.3.0-cordis.1'),target:this.target,provide:z.array(this.id).min(1).refine(PlanningValidation.unique),inject:z.array(this.id).refine(PlanningValidation.unique)});
  static readonly scope=z.strictObject({scopeId:PlatformSchemas.text,target:this.target,principalId:PlatformSchemas.text,resourceScope:PlatformSchemas.text});
  static readonly selection=z.strictObject({scopeId:PlatformSchemas.text,capability:this.id,providerId:this.id});
  static readonly artifact=z.discriminatedUnion('kind',[z.strictObject({kind:z.literal('bundled'),identity:PlatformSchemas.text}),z.strictObject({kind:z.literal('prepared'),digest:PlatformSchemas.digest})]);
  static readonly manifest=z.strictObject({formatVersion:z.literal(1),contractVersion:z.literal('0.3.0-cordis.1'),target:this.target,scopeId:PlatformSchemas.text,providerId:this.id,package:z.strictObject({name:PlatformSchemas.packageName,version:PlatformSchemas.version}),entry:PlatformSchemas.relative,configuration:z.record(z.string(),z.json()),files:z.array(PlatformSchemas.file).min(1).max(4096)});
}
export type ProviderDeclaration=z.infer<typeof ProviderSchemas.declaration>;
export type ProviderSelection=z.infer<typeof ProviderSchemas.selection>;
export type ProviderArtifact=z.infer<typeof ProviderSchemas.artifact>;
export type PreparedProviderManifest=z.infer<typeof ProviderSchemas.manifest>;
export interface AdapterValidator<T extends object> {parse(value:unknown):T;}
export class CapabilityToken<T extends object=object> {
  constructor(readonly id:string,readonly contractVersion:string,private readonly validator:AdapterValidator<T>){ProviderSchemas.id.parse(id);if(![ProviderSchemas.version,'0.4.0-cordis.1'].includes(contractVersion))throw new Error('Unsupported capability contract');Object.freeze(this);}
  parse(value:unknown):T {return this.validator.parse(value);}
}

/** New declarations are explicit; historical format-1/2 schemas remain unchanged. */
export class ProviderV4Schemas {
  static readonly version='0.4.0-cordis.1';
  static readonly target=z.enum(['cli','api','deployment','agent','browser']);
  static readonly declaration=ProviderSchemas.declaration.extend({contractVersion:z.literal('0.4.0-cordis.1'),target:this.target});
  static readonly scope=ProviderSchemas.scope.extend({target:this.target});
  static readonly manifest=ProviderSchemas.manifest.extend({formatVersion:z.literal(2),contractVersion:z.literal('0.4.0-cordis.1'),target:this.target,classExport:z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/)});
}
export class CompositionProviderSchemas {
  static readonly declaration=z.union([ProviderSchemas.declaration,ProviderV4Schemas.declaration]);
  static readonly scope=ProviderV4Schemas.scope;
}
export type NativePreparedProviderManifest=z.infer<typeof ProviderSchemas.manifest>|z.infer<typeof ProviderV4Schemas.manifest>;
export type NativeProviderDeclaration=z.infer<typeof CompositionProviderSchemas.declaration>;

class InstalledValidation {
  static slot(value:{kind:string;value?:unknown}):boolean {if(value.kind==='random'||value.kind==='uuid')return value.value===undefined;if(value.value===undefined)return false;if(value.kind==='properties')return value.value!==null&&typeof value.value==='object'&&!Array.isArray(value.value);return true;}
  static environment(values:Record<string,string>):boolean {for(const [key,value] of Object.entries(values))if((/(PASSWORD|SECRET|TOKEN|CREDENTIAL)/.test(key)&&!key.endsWith('_FILE'))||/[\r\n\0$]/.test(value)||value.includes('secret://'))return false;return true;}

  static services(values:Array<{role:string;provider:ProviderDeclaration;definition:{role:string};package:string|null;entry:string|null}>):boolean {
    const roles=new Set<string>();
    for(const value of values){if(value.definition.role!==value.role||roles.has(value.role)||value.provider.target!=='deployment'||value.provider.capability!=='container.'+value.role||value.provider.provide.length!==1||value.provider.provide[0]!==value.provider.capability||(value.package===null)!==(value.entry===null))return false;roles.add(value.role);}
    return roles.size===4;
  }
}
/** Explicit activation boundary. Historical format-1 schemas above are immutable contracts. */
export class InstalledSchemas {
  static readonly role=z.enum(['database','identity','api','edge']);
  static readonly slotDefinition=z.strictObject({kind:z.enum(['random','uuid','json','properties','text']),value:z.json().optional()}).refine(InstalledValidation.slot);
  static readonly definition=z.strictObject({role:this.role,service:z.strictObject({command:z.array(PlatformSchemas.text.max(4096)).min(1).max(64).optional(),environment:z.record(z.string().regex(/^[A-Z_][A-Z0-9_]*$/),z.string().max(4096)).refine(InstalledValidation.environment).optional(),user:z.enum(['image-default','installation-owner']),workerSocket:z.boolean(),volumes:z.array(z.strictObject({source:PlatformSchemas.slot,target:PlatformSchemas.absolute,readOnly:z.boolean()})),secrets:z.array(z.strictObject({source:PlatformSchemas.slot,target:PlatformSchemas.absolute})),portTarget:z.number().int().min(1).max(65535).nullable()}),slots:z.record(PlatformSchemas.slot,this.slotDefinition),readiness:z.discriminatedUnion('kind',[z.strictObject({kind:z.literal('postgres-query')}),z.strictObject({kind:z.literal('http-json'),path:z.string().regex(/^\/[a-zA-Z0-9_./-]+$/),expected:z.record(z.string(),z.json())}),z.strictObject({kind:z.literal('https-json'),path:z.string().regex(/^\/[a-zA-Z0-9_./-]+$/),expected:z.record(z.string(),z.json()),asset:z.boolean()})])});
  static readonly service=z.strictObject({role:this.role,definition:this.definition,provider:ProviderSchemas.declaration,imageId:PlatformSchemas.slot,package:PlatformSchemas.packageName.nullable(),entry:PlatformSchemas.relative.nullable()});
  static readonly worker=z.strictObject({path:PlatformSchemas.relative,sha256:PlatformSchemas.digest,size:z.number().int().min(1).max(512*1024*1024)});
  static readonly composition=z.strictObject({profile:z.literal('first-installed'),assetDigest:PlatformSchemas.digest,worker:this.worker,services:z.array(this.service).length(4).refine(InstalledValidation.services)});
  static readonly release=PlatformSchemas.release.extend({formatVersion:z.literal(2),composition:this.composition});
  static readonly plan=PlatformSchemas.plan.extend({formatVersion:z.literal(2),composition:this.composition,pluginBindings:z.array(ProviderSchemas.declaration),expectedComposition:PlatformSchemas.digest.nullable()});
  static readonly applyOptions=z.strictObject({installationDirectory:PlatformSchemas.absolute,idempotencyKey:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/)});
  static readonly receipt=z.strictObject({formatVersion:z.literal(2),installationId:PlatformSchemas.text,installationDirectory:PlatformSchemas.absolute,ownerUid:z.number().int().nonnegative(),expectedEngine:PlatformSchemas.expectedEngine,migration:z.strictObject({from:z.literal(1),receiptSha256:PlatformSchemas.digest}).nullable()});
  static readonly applicationRecord=z.strictObject({formatVersion:z.literal(2),id:z.string().regex(/^app-[a-f0-9]{64}$/),planId:z.string().regex(/^plan-[a-f0-9]{64}$/),digest:PlatformSchemas.digest,idempotencyKey:this.applyOptions.shape.idempotencyKey,requestDigest:PlatformSchemas.digest,sequence:z.number().int().nonnegative(),phase:PlatformSchemas.phase,desiredComposition:PlatformSchemas.digest,activeComposition:PlatformSchemas.digest.nullable(),result:z.enum(['accepted','ready','stopped','blocked','failed']).nullable(),recovery:z.enum(['repair-required']).nullable(),historyReference:PlatformSchemas.text});
  static readonly submit=z.strictObject({protocol:z.literal(2),operation:z.literal('submit'),planId:z.string().regex(/^plan-[a-f0-9]{64}$/),digest:PlatformSchemas.digest,idempotencyKey:this.applyOptions.shape.idempotencyKey});
  static readonly statusRequest=z.strictObject({protocol:z.literal(2),operation:z.literal('status')});
  static readonly applicationRequest=z.strictObject({protocol:z.literal(2),operation:z.literal('application'),id:z.string().regex(/^app-[a-f0-9]{64}$/)});
  static readonly request=z.discriminatedUnion('operation',[this.submit,this.statusRequest,this.applicationRequest]);
  static readonly response=z.discriminatedUnion('success',[z.strictObject({protocol:z.literal(2),success:z.literal(true),result:z.union([PlatformSchemas.apply,PlatformSchemas.status,PlatformSchemas.application])}),z.strictObject({protocol:z.literal(2),success:z.literal(false),code:PlatformSchemas.slot})]);
  static readonly envelope=z.discriminatedUnion('success',[PlatformSchemas.envelopeBase.extend({success:z.literal(true),problem:z.null(),result:z.union([this.plan,PlatformSchemas.plan,PlatformSchemas.apply,PlatformSchemas.status,PlatformSchemas.application,PlatformSchemas.diagnostic,z.strictObject({help:PlatformSchemas.text}),z.strictObject({version:PlatformSchemas.text})])}),PlatformSchemas.envelopeBase.extend({success:z.literal(false),problem:PlatformSchemas.problem})]);
  static readonly principal=z.strictObject({issuer:z.url(),subject:PlatformSchemas.text,principalId:PlatformSchemas.text,scopes:z.array(z.enum(['platform.read','platform.manage']))});
  static readonly serverConfiguration=z.strictObject({installationId:PlatformSchemas.text,origin:z.url().regex(/^https:\/\/(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?$/),issuer:z.url(),identityInternalOrigin:z.url(),clientId:PlatformSchemas.text,clientSecret:PlatformSchemas.text,databaseUrl:PlatformSchemas.text,bootstrapSubject:PlatformSchemas.text,workerSocket:PlatformSchemas.absolute,assetDigest:PlatformSchemas.digest});
}
export type InstalledPlan=z.infer<typeof InstalledSchemas.plan>;
export type InstalledRelease=z.infer<typeof InstalledSchemas.release>;
export type ContainerDefinition=z.infer<typeof InstalledSchemas.definition>;
export type InstalledService=z.infer<typeof InstalledSchemas.service>;
export type ApplicationRecord=z.infer<typeof InstalledSchemas.applicationRecord>;
export type ApplyOptions=z.infer<typeof InstalledSchemas.applyOptions>;
export type WorkerRequest=z.infer<typeof InstalledSchemas.request>;
export type WorkerResponse=z.infer<typeof InstalledSchemas.response>;
export type TrustedPrincipal=z.infer<typeof InstalledSchemas.principal>;
export type ServerConfiguration=z.infer<typeof InstalledSchemas.serverConfiguration>;
/** Bounded Docker operations; implementations own validation, never accept a shell command. */
export interface ContainerEngine {
  start(role:z.infer<typeof InstalledSchemas.role>,definition:ContainerDefinition):Promise<void>;
  ready(role:z.infer<typeof InstalledSchemas.role>):Promise<boolean>;
  identity():Readonly<{installationId:string;composition:string}>;
}
export interface ReadyContainer {identity():Readonly<{installationId:string;composition:string}>;ready():Promise<boolean>;}
export interface PlatformInvoker {invoke(operation:string,input:unknown,principal:TrustedPrincipal):Promise<unknown>;}
export class InstalledDeclarations {
  static service(id:string,capability:string,inject:string[]):ProviderDeclaration {return ProviderSchemas.declaration.parse({id,pluginId:id,capability,contractVersion:ProviderSchemas.version,target:'deployment',provide:[capability],inject});}
}

class ServiceValidation {
  static graph(graph:{services:ServiceInstance[];profile:{requiredBindings:string[];workerSocketServiceId?:string}}):boolean {
    const ids=new Set<string>(),bindings=new Map<string,{service:string;contractId:string;contractVersion:string}>(),edges=new Map<string,string[]>();
    for(const item of graph.services){
      if(item.definition.workerSocket&&(graph.profile.workerSocketServiceId!==item.serviceId||item.definition.user!=='installation-owner'))return false;
      if(item.definition.command&&['sh','bash','dash','zsh','powershell','pwsh'].includes(item.definition.command[0]!.split('/').at(-1)!))return false;
      if(ids.has(item.serviceId))return false;ids.add(item.serviceId);edges.set(item.serviceId,[]);
      const ports=new Set<string>(),mounts=new Set<string>();
      for(const port of item.definition.ports){if(ports.has(port.id))return false;ports.add(port.id);}
      for(const binding of item.bindings){if(bindings.has(binding.bindingId))return false;bindings.set(binding.bindingId,{service:item.serviceId,contractId:binding.contractId,contractVersion:binding.contractVersion});}
      for(const volume of item.definition.volumes){if(!item.resources.volumes.includes(volume.source)||mounts.has(volume.target))return false;mounts.add(volume.target);}
      for(const secret of item.definition.secrets){if(!Object.hasOwn(item.resources.slots,secret.slot)||mounts.has(secret.target))return false;mounts.add(secret.target);}
    }
    for(const binding of graph.profile.requiredBindings)if(!bindings.has(binding))return false;
    for(const item of graph.services){
      const inputs=new Set<string>();
      for(const dependency of item.dependencies){const supplied=bindings.get(dependency.bindingId);if(inputs.has(dependency.port)||!supplied||supplied.contractId!==dependency.contractId||supplied.contractVersion!==dependency.contractVersion)return false;inputs.add(dependency.port);edges.get(item.serviceId)!.push(supplied.service);}
      const granted=new Set<string>();for(const grant of item.resources.grants){const source=graph.services.find(ServiceValidation.named.bind(null,grant.serviceId)),key='secret://'+grant.serviceId+'/'+grant.slot;if(!source||source.serviceId===item.serviceId||!edges.get(item.serviceId)!.includes(source.serviceId)||granted.has(key)||(!Object.hasOwn(source.resources.slots,grant.slot)&&!source.resources.authorities.some(ServiceValidation.authority.bind(null,grant.slot))))return false;granted.add(key);}
      const authorities=new Set<string>();for(const authority of item.resources.authorities){if(authorities.has(authority.id)||Object.hasOwn(item.resources.slots,authority.id)||!item.resources.volumes.includes(authority.volume))return false;authorities.add(authority.id);}
      for(const reference of item.readiness.credentialReferences){const [sourceId,slot]=reference.slice('secret://'.length).split('/');if(sourceId===item.serviceId){if(!Object.hasOwn(item.resources.slots,slot!)&&!authorities.has(slot!))return false;}else if(!granted.has(reference))return false;}
      const target=graph.services.find(ServiceValidation.named.bind(null,item.readiness.endpoint.serviceId));
      if(!target||!target.definition.ports.some(ServiceValidation.port.bind(null,item.readiness.endpoint.portId)))return false;
      if(target.serviceId!==item.serviceId)edges.get(item.serviceId)!.push(target.serviceId);
      for(const value of Object.values(item.definition.environment))if(typeof value!=='string'){
        const endpoint=graph.services.find(ServiceValidation.named.bind(null,value.serviceId));
        if(!endpoint||!endpoint.definition.ports.some(ServiceValidation.port.bind(null,value.portId)))return false;
        if(endpoint.serviceId!==item.serviceId&&!edges.get(item.serviceId)!.includes(endpoint.serviceId))return false;
      }
    }
    for(const id of ids)if(!this.visit(id,edges,new Set(),new Set()))return false;
    return true;
  }
  private static authority(id:string,value:{id:string}):boolean{return value.id===id;}
  private static named(id:string,item:ServiceInstance):boolean{return item.serviceId===id;}
  private static port(id:string,item:{id:string}):boolean{return item.id===id;}
  private static visit(id:string,edges:Map<string,string[]>,visiting:Set<string>,visited:Set<string>):boolean {if(visiting.has(id))return false;if(visited.has(id))return true;visiting.add(id);for(const next of edges.get(id)??[])if(!this.visit(next,edges,visiting,visited))return false;visiting.delete(id);visited.add(id);return true;}
  static environment(values:Record<string,string|{serviceId:string;portId:string;scheme:'http'|'https'|'tcp';path:string}>):boolean {for(const [key,value] of Object.entries(values))if((typeof value==='string'&&(/[\r\n\0$]/.test(value)||value.includes('secret://')))||(/PASSWORD|SECRET|TOKEN|CREDENTIAL/.test(key)&&!key.endsWith('_FILE')))return false;return true;}
}
class ObservationValidation {
  static endpoint(value:string):boolean {try{const url=new URL(value);return ['http:','https:','tcp:'].includes(url.protocol)&&!url.username&&!url.password&&!url.search&&!url.hash&&!value.includes('secret://');}catch{return false;}}
  static origin(value:string):boolean {try{return new URL(value).origin===value;}catch{return false;}}
  static endpoints(value:Record<string,string>):boolean{return Object.keys(value).length<=32;}
  static context(value:{identity:{installationId:string;serviceId:string;compositionGeneration:string;assetDigest:string;origin:string};dependencies:Array<{port:string;identity:{installationId:string;serviceId:string;compositionGeneration:string;assetDigest:string;origin:string}}> }):boolean {
    const ports=new Set<string>();for(const dependency of value.dependencies){if(ports.has(dependency.port)||dependency.identity.serviceId===value.identity.serviceId)return false;ports.add(dependency.port);for(const field of ['installationId','compositionGeneration','assetDigest','origin'] as const)if(dependency.identity[field]!==value.identity[field])return false;}return true;
  }
}
export class ServiceSchemas {
  static readonly serviceId=z.string().regex(/^[a-z][a-z0-9-]{0,47}$/);
  static readonly id=ProviderSchemas.id;
  static readonly secretReference=z.string().regex(/^secret:\/\/[a-z][a-z0-9-]{0,47}\/[a-z][a-z0-9-]{0,62}$/);
  static readonly configuration=PlatformSchemas.desired.extend({credentialReferences:z.array(this.secretReference).refine(PlanningValidation.unique)});
  static readonly containerPath=z.string().regex(/^\/(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*[\r\n\0])[a-zA-Z0-9_./-]+$/);
  static readonly provider=z.strictObject({pluginId:this.id,providerId:this.id,target:z.literal('deployment'),package:z.strictObject({name:PlatformSchemas.packageName,version:PlatformSchemas.version,sha256:PlatformSchemas.digest}),entry:PlatformSchemas.relative,classExport:z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/),contractVersion:z.literal('0.4.0-cordis.1')});
  static readonly binding=z.strictObject({port:this.id,bindingId:this.id,contractId:this.id,contractVersion:PlatformSchemas.version});
  static readonly dependency=this.binding.extend({port:this.id});
  static readonly endpoint=z.strictObject({serviceId:this.serviceId,portId:this.serviceId,scheme:z.enum(['http','https','tcp']),path:z.string().regex(/^\/[a-zA-Z0-9_./-]*$/)});
  static readonly definition=z.strictObject({imageId:ProviderSchemas.id,user:z.enum(['image-default','installation-owner']).optional(),command:z.array(PlatformSchemas.text.max(4096)).min(1).max(64).optional(),environment:z.record(z.string().regex(/^[A-Z_][A-Z0-9_]*$/),z.union([z.string().max(4096),this.endpoint])).refine(ServiceValidation.environment),ports:z.array(z.strictObject({id:this.serviceId,target:z.number().int().min(1).max(65535),publication:z.strictObject({host:z.enum(['127.0.0.1','::1']),port:z.number().int().min(1).max(65535)}).optional()})).max(32),volumes:z.array(z.strictObject({source:PlatformSchemas.slot,target:this.containerPath,readOnly:z.boolean()})).max(64),secrets:z.array(z.strictObject({slot:PlatformSchemas.slot,target:this.containerPath})).max(64),workerSocket:z.boolean()});
  static readonly service=z.strictObject({serviceId:this.serviceId,provider:this.provider,configuration:z.record(z.string(),z.json()),definition:this.definition,bindings:z.array(this.binding).min(1).max(64),dependencies:z.array(this.dependency).max(256),readiness:z.strictObject({provider:this.provider,scheme:z.enum(['http','https','tcp']).default('http'),configuration:z.record(z.string(),z.json()),endpoint:z.strictObject({serviceId:this.serviceId,portId:this.serviceId}),deadlineMs:z.number().int().min(1).max(120000),observationContract:this.id,credentialReferences:z.array(this.secretReference).refine(PlanningValidation.unique).default([])}),resources:z.strictObject({volumes:z.array(PlatformSchemas.slot).refine(PlanningValidation.unique),slots:z.record(PlatformSchemas.slot,InstalledSchemas.slotDefinition),grants:z.array(z.strictObject({serviceId:this.serviceId,slot:PlatformSchemas.slot})).max(256).default([]),authorities:z.array(z.strictObject({id:PlatformSchemas.slot,volume:PlatformSchemas.slot,path:PlatformSchemas.relative})).max(16).default([])}),transitionPolicy:z.strictObject({kind:z.enum(['additive','restart-required','live']),stateVersion:z.number().int().positive()})});
  static readonly profile=z.strictObject({id:this.id,version:PlatformSchemas.version,requiredBindings:z.array(this.id).refine(PlanningValidation.unique),workerSocketServiceId:this.serviceId.optional()});
  static readonly graph=z.strictObject({profile:this.profile,assetDigest:PlatformSchemas.digest,worker:InstalledSchemas.worker,services:z.array(this.service).min(1).max(256)}).refine(ServiceValidation.graph.bind(ServiceValidation));
  static readonly resourceKind=z.enum(['container','network','volume','secret','configuration','authority']);
  static readonly resourceReceipt=z.strictObject({formatVersion:z.literal(3),installationId:PlatformSchemas.text,installationDirectory:PlatformSchemas.absolute,resourceId:PlatformSchemas.digest,kind:this.resourceKind,serviceId:this.serviceId.nullable(),name:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,254}$/),creatingGeneration:PlatformSchemas.digest,definitionDigest:PlatformSchemas.digest,references:z.array(PlatformSchemas.digest).min(1).max(4096).refine(PlanningValidation.unique),actualId:PlatformSchemas.text.nullable(),contentDigest:PlatformSchemas.digest.nullable(),imageDigest:PlatformSchemas.digest.nullable(),path:PlatformSchemas.relative.nullable(),ownerUid:z.number().int().nonnegative(),legacy:z.strictObject({formatVersion:z.literal(2),planDigest:PlatformSchemas.digest,serviceId:InstalledSchemas.role.nullable()}).nullable()});
  static readonly resourceBinding=z.strictObject({resourceId:PlatformSchemas.digest,kind:this.resourceKind,serviceId:this.serviceId.nullable(),creatingGeneration:PlatformSchemas.digest,receiptDigest:PlatformSchemas.digest});
  static readonly acknowledgement=z.strictObject({target:ProviderV4Schemas.target,scopeId:PlatformSchemas.text,generation:PlatformSchemas.digest,runtimeGeneration:PlatformSchemas.digest,observationDigest:PlatformSchemas.digest,ready:z.boolean()});
  static readonly runtimeContent=z.strictObject({packageSetDigest:PlatformSchemas.digest,entryDigest:PlatformSchemas.digest});
  static readonly runtimeBinding=this.runtimeContent.extend({imageManifestDigest:PlatformSchemas.digest});
  static readonly observationIdentity=z.strictObject({installationId:PlatformSchemas.text,serviceId:this.serviceId,compositionGeneration:PlatformSchemas.digest,serviceGeneration:PlatformSchemas.digest,assetDigest:PlatformSchemas.digest,origin:PlatformSchemas.desired.shape.origin.refine(ObservationValidation.origin),runtime:this.runtimeBinding.nullable()});
  static readonly observationDependency=this.binding.extend({identity:this.observationIdentity,endpoints:z.record(this.serviceId,z.url().refine(ObservationValidation.endpoint)).refine(ObservationValidation.endpoints)});
  static readonly observationContext=z.strictObject({formatVersion:z.literal(1),identity:this.observationIdentity,dependencies:z.array(this.observationDependency).max(256)}).refine(ObservationValidation.context);
  static readonly runtimeEvidence=z.strictObject({formatVersion:z.literal(1),installationId:PlatformSchemas.text,serviceId:this.serviceId,compositionGeneration:PlatformSchemas.digest,serviceGeneration:PlatformSchemas.digest,runtimeGeneration:PlatformSchemas.digest,assetDigest:PlatformSchemas.digest,ready:z.boolean(),content:this.runtimeContent.optional()});
  static readonly snapshot=z.strictObject({formatVersion:z.literal(3),installationId:PlatformSchemas.text,installationDirectory:PlatformSchemas.absolute,compositionGeneration:PlatformSchemas.digest,resources:z.array(this.resourceBinding).max(32768),acknowledgements:z.array(this.acknowledgement).max(512)});
  static readonly serviceStatus=z.strictObject({serviceId:this.serviceId,providerId:this.id,serviceGeneration:PlatformSchemas.digest,resourceId:PlatformSchemas.digest,ready:z.boolean(),observations:z.array(PlatformSchemas.text).max(64)});
  static readonly status=PlatformSchemas.status.extend({formatVersion:z.literal(3),services:z.array(this.serviceStatus).max(256),resourceSetDigest:PlatformSchemas.digest.nullable(),acknowledgements:z.array(this.acknowledgement).max(512)});
  static readonly applicationRecord=InstalledSchemas.applicationRecord.extend({formatVersion:z.literal(3),expectedComposition:PlatformSchemas.digest.nullable(),resourceSetDigest:PlatformSchemas.digest.nullable(),acknowledgements:z.array(this.acknowledgement).max(512)});
  static readonly change=z.strictObject({serviceId:this.serviceId,kind:z.enum(['add','retain','replace','reconfigure','retire']),serviceGeneration:PlatformSchemas.digest,previousGeneration:PlatformSchemas.digest.nullable(),requiredActions:z.array(z.enum(['restart','migration','removal-unsupported'])),affectedDependencies:z.array(this.serviceId)});
  static readonly release=PlatformSchemas.release.extend({formatVersion:z.literal(3),composition:this.graph,helpers:SourceToolSchemas.helperInventory.optional(),images:z.array(PlatformSchemas.release.shape.images.element.extend({id:ProviderSchemas.id})).min(1)});
  static readonly effect=PlatformSchemas.effect.extend({kind:z.enum([...PlatformSchemas.effect.shape.kind.options,'stage-helper'])});
  static readonly plan=PlatformSchemas.plan.extend({formatVersion:z.literal(3),helpers:SourceToolSchemas.helperInventory.optional(),effects:z.array(this.effect),configuration:this.configuration,composition:this.graph,pluginBindings:z.array(ProviderV4Schemas.declaration),compositionGeneration:PlatformSchemas.digest,expectedComposition:PlatformSchemas.digest.nullable(),expectedResourceSet:PlatformSchemas.digest.nullable(),retainedResources:z.array(this.resourceBinding).max(32768),changes:z.array(this.change)});
  static readonly envelope=z.discriminatedUnion('success',[PlatformSchemas.envelopeBase.extend({success:z.literal(true),problem:z.null(),result:z.union([this.plan,InstalledSchemas.plan,PlatformSchemas.plan,this.status,PlatformSchemas.status,this.applicationRecord,PlatformSchemas.application,PlatformSchemas.apply,PlatformSchemas.diagnostic,z.strictObject({help:PlatformSchemas.text}),z.strictObject({version:PlatformSchemas.text})])}),PlatformSchemas.envelopeBase.extend({success:z.literal(false),result:z.null(),problem:PlatformSchemas.problem})]);
  static readonly receipt=InstalledSchemas.receipt.extend({formatVersion:z.literal(3),migration:z.strictObject({from:z.literal(2),receiptSha256:PlatformSchemas.digest,previousComposition:PlatformSchemas.digest,nonServingProof:PlatformSchemas.digest,compatibilityProof:PlatformSchemas.digest}).nullable()});
}
export type ServiceInstance=z.infer<typeof ServiceSchemas.service>;
export type ServiceGraph=z.infer<typeof ServiceSchemas.graph>;
export type ServicePlan=z.infer<typeof ServiceSchemas.plan>;
export type ServiceRelease=z.infer<typeof ServiceSchemas.release>;
export type ServiceChange=z.infer<typeof ServiceSchemas.change>;
export type ServiceApplicationRecord=z.infer<typeof ServiceSchemas.applicationRecord>;
export type ServiceResourceReceipt=z.infer<typeof ServiceSchemas.resourceReceipt>;
export type ServiceSnapshot=z.infer<typeof ServiceSchemas.snapshot>;
export type ServiceStatus=z.infer<typeof ServiceSchemas.status>;
export type ServiceEnvelope=z.infer<typeof ServiceSchemas.envelope>;
export type ServiceRuntimeEvidence=z.infer<typeof ServiceSchemas.runtimeEvidence>;
export type ServiceRuntimeContent=z.infer<typeof ServiceSchemas.runtimeContent>;
export type ServiceRuntimeBinding=z.infer<typeof ServiceSchemas.runtimeBinding>;
export type ServiceObservationContext=z.infer<typeof ServiceSchemas.observationContext>;
export type TargetAcknowledgement=z.infer<typeof ServiceSchemas.acknowledgement>;
export type ServiceProviderRef=z.infer<typeof ServiceSchemas.provider>;
export interface ServiceIdentity {installationId:string;serviceId:string;providerId:string;serviceGeneration:string;resourceId:string;}
export interface ServiceReadiness {ready:boolean;serviceId:string;observations:readonly string[];acknowledgements?:readonly TargetAcknowledgement[];}
export interface ContainerService {identity():ServiceIdentity;ready():Promise<ServiceReadiness>;}
export interface ServiceEngine {start(serviceId:string,definition:ServiceInstance['definition']):Promise<void>;ready(serviceId:string):Promise<ServiceReadiness>;identity(serviceId:string):ServiceIdentity;}

export class PlatformOperations {
  private static binding<I extends z.ZodType,O extends z.ZodType>(id:string,input:I,output:O,path:string,cli:string,write=false):OperationDefinition<I,O> {
    return OperationDefinition.define({id,input,output,rest:{method:write?'POST':'GET',path},cli,mcp:id.replaceAll('.','_'),effect:write?'write':'read',scope:write?'platform.manage':'platform.read',exposure:['rest','cli','mcp'],idempotency:write,expectedState:write});
  }
  static readonly describe=this.binding('platform.describe',PlatformSchemas.empty,PlatformSchemas.describe,'/v1/platform','platform describe');
  static readonly status=this.binding('platform.status',PlatformSchemas.empty,z.union([PlatformSchemas.status,ServiceSchemas.status]),'/v1/platform/status','platform status');
  static readonly plan=this.binding('platform.plan',z.union([PlatformSchemas.desired,ServiceSchemas.configuration]),z.discriminatedUnion('formatVersion',[PlatformSchemas.plan,InstalledSchemas.plan,ServiceSchemas.plan]),'/v1/platform/plans','platform plan',true);
  static readonly apply=this.binding('platform.apply',z.strictObject({planId:PlatformSchemas.text,digest:PlatformSchemas.digest}),PlatformSchemas.apply,'/v1/platform/applications','platform apply',true);
  static readonly get=this.binding('platform.applications.get',z.strictObject({id:PlatformSchemas.text}),PlatformSchemas.application,'/v1/platform/applications/{id}','platform application');
  static readonly events=this.binding('platform.applications.events',z.strictObject({id:PlatformSchemas.text,cursor:PlatformSchemas.text.optional(),limit:z.number().int().min(1).max(1000).optional()}),PlatformSchemas.events,'/v1/platform/applications/{id}/events','platform events');
  static readonly cancel=this.binding('platform.applications.cancel',z.strictObject({id:PlatformSchemas.text,expectedState:PlatformSchemas.phase}),PlatformSchemas.cancel,'/v1/platform/applications/{id}/cancel','platform cancel',true);
  static readonly all=Object.freeze([this.describe,this.status,this.plan,this.apply,this.get,this.events,this.cancel] as const);
  static validate(bindings:readonly OperationDefinition[]):void {
    const ids=new Set<string>(), routes=new Set<string>(), tools=new Set<string>();
    for(const binding of bindings) {
      const d=binding.definition, route=`${d.rest.method} ${d.rest.path}`;
      if(ids.has(d.id)||routes.has(route)||tools.has(d.mcp)) throw new Error('Duplicate operation exposure');
      OperationDefinition.define(d); ids.add(d.id);routes.add(route);tools.add(d.mcp);
    }
  }
}

export type InstalledEnvelope=z.infer<typeof InstalledSchemas.envelope>;
class InstalledAdapter<T extends object> implements AdapterValidator<T> {
  constructor(private readonly methods:string[]){}
  parse(value:unknown):T {if(!value||typeof value!=='object')throw new Error('Invalid installed adapter');for(const method of this.methods)if(typeof Reflect.get(value,method)!=='function')throw new Error('Invalid installed adapter');return value as T;}
}
export class InstalledTokens {
  static readonly engine=new CapabilityToken<ContainerEngine>('deployment.engine',ProviderSchemas.version,new InstalledAdapter(['start','ready','identity']));
  static readonly database=new CapabilityToken<ReadyContainer>('container.database',ProviderSchemas.version,new InstalledAdapter(['ready','identity']));
  static readonly identity=new CapabilityToken<ReadyContainer>('container.identity',ProviderSchemas.version,new InstalledAdapter(['ready','identity']));
  static readonly api=new CapabilityToken<ReadyContainer>('container.api',ProviderSchemas.version,new InstalledAdapter(['ready','identity']));
  static readonly edge=new CapabilityToken<ReadyContainer>('container.edge',ProviderSchemas.version,new InstalledAdapter(['ready','identity']));
  static readonly invoker=new CapabilityToken<PlatformInvoker>('platform.invoker',ProviderSchemas.version,new InstalledAdapter(['invoke']));
}

export interface ProbeContext {readonly serviceId:string;readonly endpoint:string;readonly deadline:number;readonly signal:AbortSignal;readonly expected:Readonly<{installationId:string;compositionGeneration:string;serviceGeneration:string;assetDigest:string}>;readonly observation?:Readonly<ServiceObservationContext>;readonly credentialReferences:readonly string[];readonly authorityIds:readonly string[];credential(reference:string):Promise<Uint8Array>;authority(id:string):Promise<Uint8Array>;}
export interface ServiceDependency {serviceId:string;bindingId:string;contractId:string;contractVersion:string;endpoints:Readonly<Record<string,string>>;}
export interface ServiceExecutionContext {readonly service:ServiceInstance;dependency(port:string):ServiceDependency;}
export interface ServiceProbe {observe(context:ProbeContext):Promise<ServiceReadiness>;}
export class ServiceTokens {
  static readonly invoker=new CapabilityToken<PlatformInvoker>('platform.invoker','0.4.0-cordis.1',new InstalledAdapter(['invoke']));
  static readonly context=new CapabilityToken<ServiceExecutionContext>('service.context','0.4.0-cordis.1',new InstalledAdapter(['dependency']));
  static readonly engine=new CapabilityToken<ServiceEngine>('deployment.services','0.4.0-cordis.1',new InstalledAdapter(['start','ready','identity']));
  static container(bindingId='service'):CapabilityToken<ContainerService> {ProviderSchemas.id.parse(bindingId);return new CapabilityToken('container.'+bindingId,'0.4.0-cordis.1',new InstalledAdapter(['ready','identity']));}
  static probe(bindingId='service'):CapabilityToken<ServiceProbe> {ProviderSchemas.id.parse(bindingId);return new CapabilityToken('probe.'+bindingId,'0.4.0-cordis.1',new InstalledAdapter(['observe']));}
}
