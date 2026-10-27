import { test, expect } from 'bun:test';
import { z } from 'zod';
import { spawnSync } from 'node:child_process';
import { CapabilityToken, ProviderSchemas, type ProviderDeclaration } from '../../src/contracts.js';
import { SourcePolicy } from '../../src/source-policy.js';
import { Context, CordisComposition, CordisServiceLocator, CompositionError, type ProviderRegistration, type TrustedCompositionContext } from '../../src/runtime.js';

export interface Probe {read():string;}
export class ProbeValidation {parse(value:unknown):Probe {if(!value||typeof (value as Probe).read!=='function')throw new Error('bad adapter');return value as Probe;}}
export const token=new CapabilityToken<Probe>('probe','0.3.0-cordis.1',new ProbeValidation());
export class ProbeProvider {
  static readonly declaration:ProviderDeclaration={id:'first',pluginId:'probe-plugin',capability:'probe',contractVersion:'0.3.0-cordis.1',target:'cli',provide:['probe'],inject:[]};
  static readonly provide=['probe'];static readonly inject:string[]=[];
  static readonly Config=z.strictObject({label:z.string()});
  static active=0;
  constructor(readonly ctx:Context,readonly configuration:{label:string}) {ProbeProvider.active++;ctx.provide('probe',this);ctx.effect(this.effect.bind(this));}
  effect():()=>void {return this.close.bind(this);}close():void {ProbeProvider.active--;}
  read():string {return this.configuration.label;}
}
export class IdentityConfiguration {static validate(value:unknown):{value:unknown} {return {value};}}
export class SharedConfigurationProvider {
  static readonly declaration=ProbeProvider.declaration;static readonly provide=ProbeProvider.provide;static readonly inject=ProbeProvider.inject;
  static readonly Config={'~standard':{version:1 as const,vendor:'fixture',validate:IdentityConfiguration.validate.bind(IdentityConfiguration)}};
  constructor(context:Context,readonly configuration:{label:string}){context.provide('probe',this);}
  read():string{return this.configuration.label;}
}
export class OtherProvider extends ProbeProvider {static override readonly declaration={...ProbeProvider.declaration,id:'second'};}
export class BadCleanupProvider extends ProbeProvider {override close():void {super.close();throw new Error('secret-cleanup-canary');}}
export class ThrowingProvider extends ProbeProvider {constructor(context:Context,configuration:{label:string}){super(context,configuration);throw new Error('secret-constructor-canary');}}
export class MissingDependency extends ProbeProvider {static override readonly inject=['absent'];static override readonly declaration={...ProbeProvider.declaration,inject:['absent']};}
export class CycleFirst extends ProbeProvider {static override readonly inject=['cycle'];static override readonly declaration={...ProbeProvider.declaration,inject:['cycle']};}
export class CycleSecond extends ProbeProvider {static override readonly provide=['cycle'];static override readonly inject=['probe'];static override readonly declaration={...ProbeProvider.declaration,id:'cycle',capability:'cycle',provide:['cycle'],inject:['probe']};}
export class DependentProvider {
  static readonly declaration:ProviderDeclaration={...ProbeProvider.declaration,id:'dependent',capability:'aa-dependent',provide:['aa-dependent'],inject:['probe']};
  static readonly provide=this.declaration.provide;static readonly inject=this.declaration.inject;static readonly Config=ProbeProvider.Config;
  constructor(private readonly context:Context){context.provide('aa-dependent',this);}
  read():string {return (Reflect.get(this.context,'probe') as Probe).read();}
}
export class Receiver {context:Context|null=null;accept(context:Context):void {this.context=context;}}
export class Consumer {static readonly inject=['cordis.composition','probe'];constructor(ctx:Context,receiver:Receiver){receiver.accept(ctx);}}
export class Uninjected {static readonly inject:string[]=[];constructor(ctx:Context,receiver:Receiver){receiver.accept(ctx);}}
export class RuntimeTests {
  authority(scopeId='scope'):TrustedCompositionContext {return {scopeId,target:'cli',principalId:'fixture-owner',resourceScope:'fixture-resource'};}
  registration(second=false,plugin:typeof ProbeProvider=ProbeProvider):ProviderRegistration {return {token,declaration:second?OtherProvider.declaration:ProbeProvider.declaration,plugin:second?OtherProvider:plugin,configuration:{label:second?'second':'first'},artifact:{kind:'bundled',identity:'fixture-probe@1'}};}
  descriptor(second=false):{registrations:ProviderRegistration[];selections:Array<{scopeId:string;capability:string;providerId:string}>} {return {registrations:[this.registration(),this.registration(true)],selections:[{scopeId:'scope',capability:'probe',providerId:second?'second':'first'}]};}
  static call(method:()=>unknown):unknown {return method();}
  static selected(value:{selected:boolean}):boolean {return value.selected;}
}
