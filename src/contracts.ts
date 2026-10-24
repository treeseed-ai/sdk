import { z } from 'zod';
import { createHash } from 'node:crypto';

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
  private static readonly envelopeBase=z.strictObject({command:this.text,success:z.boolean(),result:z.union([this.plan,this.diagnostic,z.strictObject({version:this.text}),z.strictObject({help:this.text})]).nullable(),problem:this.problem.nullable(),blockers:z.array(this.blocker),references:z.array(this.text)});
  static readonly envelope=z.discriminatedUnion('success',[this.envelopeBase.extend({success:z.literal(true),problem:z.null()}),this.envelopeBase.extend({success:z.literal(false),problem:this.problem})]);
}
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
      if(!(schema instanceof z.ZodObject)||z.toJSONSchema(schema,{io:'input'}).additionalProperties!==false)throw new Error('Operation schemas must be strict objects');
    }
    const write=definition.effect==='write';
    if(!/^platform\.[a-z]+(\.[a-z]+)?$/.test(definition.id)||definition.mcp!==definition.id.replaceAll('.','_')||!definition.cli.trim()||!definition.rest.path.startsWith('/v1/platform')||definition.scope!==(write?'platform.manage':'platform.read')||definition.rest.method!==(write?'POST':'GET')||definition.idempotency!==write||definition.expectedState!==write||definition.exposure.join(',')!=='rest,cli,mcp') throw new Error('Invalid operation policy');
    return new OperationDefinition(Object.freeze({...definition,rest:Object.freeze({...definition.rest}),exposure:Object.freeze([...definition.exposure]) as readonly ['rest','cli','mcp']}));
  }
  parseInput(value:unknown):z.infer<I> { return this.definition.input.parse(value); }
  parseOutput(value:unknown):z.infer<O> { return this.definition.output.parse(value); }
}
export class PlatformOperations {
  private static binding<I extends z.ZodType,O extends z.ZodType>(id:string,input:I,output:O,path:string,cli:string,write=false):OperationDefinition<I,O> {
    return OperationDefinition.define({id,input,output,rest:{method:write?'POST':'GET',path},cli,mcp:id.replaceAll('.','_'),effect:write?'write':'read',scope:write?'platform.manage':'platform.read',exposure:['rest','cli','mcp'],idempotency:write,expectedState:write});
  }
  static readonly describe=this.binding('platform.describe',PlatformSchemas.empty,PlatformSchemas.describe,'/v1/platform','platform describe');
  static readonly status=this.binding('platform.status',PlatformSchemas.empty,PlatformSchemas.status,'/v1/platform/status','platform status');
  static readonly plan=this.binding('platform.plan',PlatformSchemas.desired,PlatformSchemas.plan,'/v1/platform/plans','platform plan',true);
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
export class ContractProjection {
  static generate():object {
    PlatformOperations.validate(PlatformOperations.all);
    const operations=[];
    for(const binding of PlatformOperations.all) {
      const {input,output,...metadata}=binding.definition;
      operations.push({...metadata,input:z.toJSONSchema(input,{io:'input'}),output:z.toJSONSchema(output)});
    }
    const contract={contractVersion:'0.3.0-cordis.1',operations,schemas:{configuration:z.toJSONSchema(PlatformSchemas.desired,{io:'input'}),release:z.toJSONSchema(PlatformSchemas.release),recipe:z.toJSONSchema(PlatformSchemas.recipe),plugin:z.toJSONSchema(PlatformSchemas.pluginDefinition),provider:z.toJSONSchema(ProviderSchemas.declaration),selection:z.toJSONSchema(ProviderSchemas.selection),preparedProvider:z.toJSONSchema(ProviderSchemas.manifest)}};
    return {...contract,digest:createHash('sha256').update(JSON.stringify(contract)).digest('hex')};
  }
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
  static digest(value:unknown):string {return createHash('sha256').update(this.stringify(value)).digest('hex');}
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
  constructor(readonly id:string,readonly contractVersion:string,private readonly validator:AdapterValidator<T>){ProviderSchemas.id.parse(id);if(contractVersion!==ProviderSchemas.version)throw new Error('Unsupported capability contract');Object.freeze(this);}
  parse(value:unknown):T {return this.validator.parse(value);}
}
