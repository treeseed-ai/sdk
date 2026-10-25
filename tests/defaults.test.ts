import {spawnSync} from 'node:child_process';
import {test,expect} from 'bun:test';
import {z} from 'zod';
import {Context,CordisComposition,type ProviderRegistration} from '../src/composition.js';
import {CapabilityToken,ProviderV4Schemas} from '../src/schemas.js';
interface Value {read():string;}
class ValueValidation {parse(value:unknown):Value{if(!value||typeof Reflect.get(value,'read')!=='function')throw new Error('INVALID_VALUE');return value as Value;}}
const token=new CapabilityToken<Value>('fixture.value',ProviderV4Schemas.version,new ValueValidation());
class ValuePlugin {
 static readonly provide=['fixture.value'];static readonly inject:string[]=[];static readonly Config=z.strictObject({label:z.string().default('default')});static readonly declaration=ProviderV4Schemas.declaration.parse({id:'fixture.first',pluginId:'fixture',capability:token.id,contractVersion:ProviderV4Schemas.version,target:'cli',provide:this.provide,inject:this.inject});static live=0;
 constructor(context:Context,private readonly config:{label:string}){ValuePlugin.live++;context.provide(token.id,this);context.effect(this.effect.bind(this));}
 private effect():()=>void{return this.close.bind(this);}private close():void{ValuePlugin.live--;}
 read():string{return this.config.label;}
}
class NextPlugin extends ValuePlugin {static override readonly declaration={...ValuePlugin.declaration,id:'fixture.next'};}
class DefaultsTests {
 async run():Promise<void>{const authority={scopeId:'fixture',target:'cli' as const,principalId:'owner',resourceScope:'fixture'},selection={scopeId:'fixture',capability:token.id,providerId:ValuePlugin.declaration.id},registration={token,plugin:ValuePlugin,declaration:ValuePlugin.declaration,configuration:{},artifact:{kind:'bundled' as const,identity:'fixture'}};const first=await CordisComposition.start({registrations:[registration],selections:[selection]},authority),second=await CordisComposition.start({registrations:[{...registration,configuration:{label:'default'}}],selections:[selection]},authority);try{expect(first.generation).toBe(second.generation);}finally{await first.dispose();await second.dispose();}}
}
const suite=new DefaultsTests();test('unit: native defaults normalize provider identity',suite.run.bind(suite));
