import {Context,CordisScope,type CompositionDescriptor} from '@treeseed-cordis/sdk/composition';
import {CapabilityToken,ProviderV4Schemas,PlatformSchemas,PluginSource,PluginManagementSchemas} from '@treeseed-cordis/sdk/portable';
interface Value{read():string;}
class ValueValidation{parse(value:unknown):Value{if(!value||typeof Reflect.get(value,'read')!=='function')throw new Error('INVALID_VALUE');return value as Value;}}
const token=new CapabilityToken<Value>('fixture.value',ProviderV4Schemas.version,new ValueValidation());
class FirstPlugin implements Value{
 static live=0;static count():number{return this.live;}static readonly provide=['fixture.value'];static readonly inject:string[]=[];static readonly Config=PlatformSchemas.empty;
 static readonly declaration=ProviderV4Schemas.declaration.parse({id:'fixture.first',pluginId:'fixture',capability:token.id,target:'browser',contractVersion:ProviderV4Schemas.version,provide:this.provide,inject:this.inject});
 constructor(context:Context){FirstPlugin.live++;context.provide(token.id,this);context.effect(this.effect.bind(this));}
 private effect():()=>void{return this.stop.bind(this);}private stop():void{FirstPlugin.live--;}
 read():string{return 'first';}
}
class SecondPlugin extends FirstPlugin{static override readonly declaration={...FirstPlugin.declaration,id:'fixture.second'};override read():string{return 'second';}}
class BrowserProgram{
 static descriptor(next:boolean):CompositionDescriptor{const plugin=next?SecondPlugin:FirstPlugin;return {registrations:[{token,plugin,declaration:plugin.declaration,configuration:{},artifact:{kind:'bundled',identity:plugin.declaration.id}}],selections:[{scopeId:'browser-fixture',capability:token.id,providerId:plugin.declaration.id}]};}
 static assert(condition:unknown):asserts condition{if(!condition)throw new Error('BROWSER_COMPOSITION_ASSERTION');}
 static async run():Promise<string>{this.assert(PluginSource.parse('@fixture/plugin@^1').kind==='npm');this.assert(PluginManagementSchemas.source.safeParse('@fixture/plugin@latest random').success===false);const scope=await CordisScope.start(this.descriptor(false),{scopeId:'browser-fixture',target:'browser',principalId:'fixture',resourceScope:'browser-fixture'});let lease=await scope.acquire(token);try{this.assert(lease.value.read()==='first'&&FirstPlugin.count()===1);const generation=scope.generation;this.assert((await scope.beginReplacement(this.descriptor(true),generation,1)).state==='pending');await lease.release();this.assert((await scope.continueReplacement(1000)).state==='mounted');const candidate=await scope.inspectCandidate(token);try{this.assert(candidate.value.read()==='second'&&FirstPlugin.count()===1);}finally{await candidate.release();}scope.commitReplacement();this.assert(scope.generation!==generation);lease=await scope.acquire(token);this.assert(lease.value.read()==='second');}finally{await lease.release();await scope.dispose();}this.assert(FirstPlugin.count()===0);return 'native-browser-ok';}
}
declare global{interface Window{sdkQualification:Promise<string>;}}
window.sdkQualification=BrowserProgram.run();
