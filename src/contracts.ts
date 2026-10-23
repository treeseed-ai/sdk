import { z } from 'zod';
import { createHash } from 'node:crypto';

export class PlatformSchemas {
  static readonly text=z.string().trim().min(1);
  static readonly digest=z.string().regex(/^[a-f0-9]{64}$/);
  static readonly absolute=z.string().regex(/^\//);
  static readonly phase=z.enum(['resolve','validate','stage','prepare','drain','activate','readiness','commit','completed','failed','cancelled']);
  static readonly blocker=z.strictObject({code:this.text,message:this.text});
  static readonly artifact=z.strictObject({package:this.text,version:this.text,integrity:this.digest});
  static readonly plugin=z.strictObject({id:this.text,package:this.text,version:this.text,integrity:this.digest});
  static readonly pluginStatus=z.strictObject({id:this.text,ready:z.boolean()});
  static readonly desired=z.strictObject({installationId:this.text,engineContext:this.text,installationDirectory:this.absolute,origin:z.url().regex(/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?\/?$/),runtimeState:z.enum(['running','stopped']),plugins:z.array(this.plugin).min(1),credentialReferences:z.array(z.string().regex(/^secret:\/\/[a-zA-Z0-9/_-]+$/))});
  static readonly describe=z.strictObject({contractVersion:this.text,platformVersion:this.text,schemaDigest:this.digest,plugins:z.array(this.pluginStatus),operations:z.array(this.text)});
  static readonly status=z.strictObject({installationId:this.text,engine:this.text,desiredComposition:this.digest.nullable(),activeComposition:this.digest.nullable(),ready:z.boolean(),plugins:z.array(this.pluginStatus),blockers:z.array(this.blocker),applicationId:this.text.nullable()});
  static readonly plan=z.strictObject({id:this.text,digest:this.digest,expectedComposition:this.digest.nullable(),artifacts:z.array(this.artifact),effects:z.array(this.text),blockers:z.array(this.blocker)});
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
  static readonly envelope=z.strictObject({command:this.text,success:z.boolean(),result:z.union([this.diagnostic,z.strictObject({version:this.text}),z.strictObject({help:this.text})]).nullable(),problem:this.problem.nullable(),blockers:z.array(this.blocker),references:z.array(this.text)});
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
      operations.push({...metadata,input:z.toJSONSchema(input),output:z.toJSONSchema(output)});
    }
    const contract={contractVersion:'0.1.0-cordis.1',operations};
    return {...contract,digest:createHash('sha256').update(JSON.stringify(contract)).digest('hex')};
  }
}
