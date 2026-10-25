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
class ScopeTests {
 private descriptor(next=false,configuration:unknown={}){const plugin=next?NextPlugin:ValuePlugin,registration:ProviderRegistration={token,plugin,declaration:plugin.declaration,configuration,artifact:{kind:'bundled',identity:next?'fixture-next':'fixture-first'}};return {registrations:[registration],selections:[{scopeId:'fixture',capability:token.id,providerId:plugin.declaration.id}]};}
 private authority(){return {scopeId:'fixture',target:'cli' as const,principalId:'fixture-owner',resourceScope:'fixture-owned'};}
 async defaults():Promise<void>{const first=await CordisComposition.start(this.descriptor(),this.authority()),second=await CordisComposition.start(this.descriptor(false,{label:'default'}),this.authority());try{expect(first.generation).toBe(second.generation);}finally{await first.dispose();await second.dispose();}}
 async replacement():Promise<void>{const {CordisScope}=await import('../src/composition.js');const scope=await CordisScope.start(this.descriptor(),this.authority()),old=scope.generation,lease=await scope.acquire(token);try{expect(lease.value.read()).toBe('default');const pending=await scope.beginReplacement(this.descriptor(true,{label:'next'}),old,1);expect(pending.state).toBe('pending');expect(ValuePlugin.live).toBe(1);await expect(scope.acquire(token)).rejects.toThrow('ADMISSION_CLOSED');await lease.release();const mounted=await scope.continueReplacement(100);expect(mounted.state).toBe('mounted');expect(ValuePlugin.live).toBe(1);const candidate=await scope.inspectCandidate(token);try{expect(candidate.value.read()).toBe('next');}finally{await candidate.release();}const generation=scope.commitReplacement();expect(generation).not.toBe(old);const current=await scope.acquire(token);try{expect(current.value.read()).toBe('next');}finally{await current.release();}}finally{await lease.release();await scope.dispose();}expect(ValuePlugin.live).toBe(0);}
}
const suite=new ScopeTests();test('unit: normalized native defaults have one generation',suite.defaults.bind(suite));test('integration: native replacement drains pinned leases disposes then mounts and awaits owner commit',suite.replacement.bind(suite));
class TransformValues {static prefix(value:string):string{return 'normalized:'+value;}}
class TransformPlugin {static readonly provide=ValuePlugin.provide;static readonly inject=ValuePlugin.inject;static readonly Config=z.strictObject({label:z.string().transform(TransformValues.prefix)});static readonly declaration={...ValuePlugin.declaration,id:'fixture.transform'};constructor(context:Context,private readonly config:{label:string}){context.provide(token.id,this);}read():string{return this.config.label;}}
class ScopeBoundaryTests {
 private descriptor(plugin:typeof ValuePlugin|typeof TransformPlugin=ValuePlugin){return {registrations:[{token,plugin,declaration:plugin.declaration,configuration:{label:'value'},artifact:{kind:'bundled' as const,identity:plugin.declaration.id}}],selections:[{scopeId:'fixture',capability:token.id,providerId:plugin.declaration.id}]};}
 private authority(){return {scopeId:'fixture',target:'cli' as const,principalId:'fixture-owner',resourceScope:'fixture-owned'};}
 async transform():Promise<void>{const {CordisScope}=await import('../src/composition.js');const scope=await CordisScope.start(this.descriptor(TransformPlugin),this.authority());try{const lease=await scope.acquire(token);try{expect(lease.value.read()).toBe('normalized:value');}finally{await lease.release();}}finally{await scope.dispose();}}
 async concurrent():Promise<void>{const {CordisScope}=await import('../src/composition.js');const scope=await CordisScope.start(this.descriptor(),this.authority()),lease=await scope.acquire(token);try{const first=scope.beginReplacement(this.descriptor(),scope.generation,100);await expect(scope.continueReplacement(100)).rejects.toThrow('COMPOSITION_BUSY');await lease.release();await first;}finally{await lease.release();await scope.dispose();}}
}
const boundaries=new ScopeBoundaryTests();test('unit: native Config transforms run once while generation uses normalized data',boundaries.transform.bind(boundaries));test('integration: concurrent scope replacement cannot mount two native writers',boundaries.concurrent.bind(boundaries));
