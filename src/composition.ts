import { Context, FiberState, type Plugin, type Fiber, type Message } from 'cordis';
import { CapabilityToken, ProviderSchemas, CompositionProviderSchemas, CanonicalJson, type NativeProviderDeclaration as ProviderDeclaration, type ProviderSelection, type ProviderArtifact } from './schemas.js';
export { Context } from 'cordis';
class CompositionHash {
  static async digest(value:unknown):Promise<string> {const bytes=new TextEncoder().encode(CanonicalJson.stringify(value));const digest=new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes));let hex='';for(const byte of digest)hex+=byte.toString(16).padStart(2,'0');return hex;}
}
export interface ProviderRegistration {token:CapabilityToken;declaration:unknown;plugin:Plugin.Constructor;configuration:unknown;artifact:ProviderArtifact;}
export interface TrustedCompositionContext {scopeId:string;target:'cli'|'api'|'deployment'|'agent'|'browser';principalId:string;resourceScope:string;}
export interface CompositionDescriptor {registrations:readonly ProviderRegistration[];selections:readonly ProviderSelection[];}
export interface ProviderDescription {id:string;capability:string;selected:boolean;ready:boolean;artifact:ProviderArtifact;}
export class CompositionError extends Error {
  constructor(readonly code:string){super(code);this.name='CompositionError';}
  static require(condition:unknown,code:string):asserts condition {if(!condition)throw new CompositionError(code);}
}
interface ValidatedRegistration extends ProviderRegistration {declaration:ProviderDeclaration;identityConfiguration:unknown;}
class CompositionValidation {
  static safe(descriptor:CompositionDescriptor,authority:TrustedCompositionContext):ValidatedRegistration[]{try{return this.validate(descriptor,authority);}catch(error){if(error instanceof CompositionError)throw error;throw new CompositionError('INVALID_COMPOSITION');}}
  private static ignoredFailure(_error:unknown):void{}

  static validate(descriptor:CompositionDescriptor,authority:TrustedCompositionContext):ValidatedRegistration[] {
    CompositionError.require(CompositionProviderSchemas.scope.safeParse(authority).success,'INVALID_SCOPE');
    const registrations:ValidatedRegistration[]=[],identities=new Set<string>();
    for(const item of descriptor.registrations){
      const parsed=CompositionProviderSchemas.declaration.safeParse(item.declaration);CompositionError.require(parsed.success,'INVALID_PROVIDER_DECLARATION');
      const declaration=parsed.data,artifact=ProviderSchemas.artifact.safeParse(item.artifact);CompositionError.require(artifact.success,'INVALID_PROVIDER_ARTIFACT');
      CompositionError.require(declaration.capability!=='cordis.composition','RESERVED_CAPABILITY');
      CompositionError.require(declaration.capability===item.token.id&&declaration.contractVersion===item.token.contractVersion&&declaration.target===authority.target,'INCOMPATIBLE_PROVIDER');
      CompositionError.require(!identities.has(declaration.capability+':'+declaration.id),'DUPLICATE_PROVIDER');identities.add(declaration.capability+':'+declaration.id);
      const provide=typeof item.plugin.provide==='string'?[item.plugin.provide]:item.plugin.provide,inject=item.plugin.inject;
      CompositionError.require(Array.isArray(provide)&&Array.isArray(inject)&&CanonicalJson.stringify([...provide].sort())===CanonicalJson.stringify([...declaration.provide].sort())&&CanonicalJson.stringify([...inject].sort())===CanonicalJson.stringify([...declaration.inject].sort())&&declaration.provide.length===1&&declaration.provide[0]===declaration.capability,'DECLARATION_DRIFT');
      CompositionError.require(item.plugin.Config&&typeof item.plugin.Config['~standard']?.validate==='function','INVALID_PROVIDER_CONFIGURATION');
      const accepted:unknown=JSON.parse(CanonicalJson.stringify(item.configuration)),configuration=item.plugin.Config['~standard'].validate(accepted);if('then' in configuration){void Promise.resolve(configuration).catch(CompositionValidation.ignoredFailure);throw new CompositionError('INVALID_PROVIDER_CONFIGURATION');}CompositionError.require(!configuration.issues,'INVALID_PROVIDER_CONFIGURATION');
      registrations.push({...item,configuration:accepted,identityConfiguration:JSON.parse(CanonicalJson.stringify(configuration.value)),declaration,artifact:artifact.data});
    }
    const selected:ValidatedRegistration[]=[],capabilities=new Set<string>(['cordis.composition']);
    for(const value of descriptor.selections){const selection=ProviderSchemas.selection.safeParse(value);CompositionError.require(selection.success,'INVALID_SELECTION');CompositionError.require(selection.data.scopeId===authority.scopeId,'SCOPE_MISMATCH');CompositionError.require(!capabilities.has(selection.data.capability),'DUPLICATE_SELECTION');capabilities.add(selection.data.capability);let found:ValidatedRegistration|undefined;for(const item of registrations)if(item.declaration.capability===selection.data.capability&&item.declaration.id===selection.data.providerId)found=item;CompositionError.require(found,'MISSING_PROVIDER');selected.push(found);}
    for(const item of selected)for(const dependency of item.declaration.inject)CompositionError.require(capabilities.has(dependency),'MISSING_DEPENDENCY');
    for(const item of selected)this.visit(item.declaration.capability,selected,new Set(),new Set());
    return registrations;
  }
  static text(value:unknown):boolean {return typeof value==='string'&&value.length>0;}
  private static visit(name:string,selected:ValidatedRegistration[],visiting:Set<string>,visited:Set<string>):void {CompositionError.require(!visiting.has(name),'DEPENDENCY_CYCLE');if(visited.has(name))return;visiting.add(name);for(const item of selected)if(item.declaration.capability===name)for(const dependency of item.declaration.inject)this.visit(dependency,selected,visiting,visited);visiting.delete(name);visited.add(name);}
}
export class CordisComposition {
  private static selection(value:ProviderSelection):ProviderSelection {return Object.freeze(ProviderSchemas.selection.parse(value));}
  private static order(a:ProviderSelection,b:ProviderSelection):number {return a.capability<b.capability?-1:a.capability>b.capability?1:0;}
  private static registrationOrder(a:ValidatedRegistration,b:ValidatedRegistration):number {const left=a.declaration.capability+':'+a.declaration.id,right=b.declaration.capability+':'+b.declaration.id;return left<right?-1:left>right?1:0;}
  static async start(descriptor:CompositionDescriptor,authority:TrustedCompositionContext):Promise<CompositionHandle> {
    const registrations=CompositionValidation.safe(descriptor,authority);
    const selections=descriptor.selections.map(CordisComposition.selection).sort(CordisComposition.order);registrations.sort(CordisComposition.registrationOrder);
    const handle=new CompositionHandle(registrations,selections,Object.freeze(CompositionProviderSchemas.scope.parse(authority)),await CompositionHash.digest({authority,selections,providers:registrations.map(CompositionHandle.identity)}));
    try {await handle.start();return handle;}catch{try{await handle.dispose();}catch{}throw new CompositionError('PROVIDER_LIFECYCLE');}
  }
}
class CompositionKernel {static readonly provide=['cordis.composition'];constructor(context:Context,handle:CompositionHandle){context.provide('cordis.composition',handle);}}
class LifecycleFaults {failed=false;export(message:Message):void {if(message.type==='error')this.failed=true;}}
export class CompositionHandle {
  private readonly faults=new LifecycleFaults();
  readonly context=new Context();
  readonly generation:string;
  private closed=false;private fenced=false;
  private readonly leases=new Set<ProviderLease<object>>();
  private disposal:Promise<void>|null=null;
  constructor(private readonly registrations:ValidatedRegistration[],private readonly selections:readonly ProviderSelection[],readonly authority:TrustedCompositionContext,generation:string){this.generation=generation;this.context.logger.exporters.set(-1,this.faults);}
  static identity(item:ValidatedRegistration):object {return {declaration:item.declaration,configuration:item.identityConfiguration,artifact:item.artifact};}
  async start():Promise<void> {
    await this.context.plugin(CompositionKernel,this);
    const fibers:Fiber[]=[];
    for(const registration of this.registrations)if(this.selected(registration))fibers.push(this.context.plugin(registration.plugin,registration.configuration));
    while(true){
      for(const fiber of fibers)await fiber.await();
      let active=true,transitioning=false;for(const fiber of fibers){if(fiber.state!==FiberState.ACTIVE)active=false;if(fiber.inertia)transitioning=true;}
      if(active)break;CompositionError.require(transitioning,'PROVIDER_NOT_READY');
    }
    for(const registration of this.registrations)if(this.selected(registration)){
      const token=registration.token;
      class ReadinessConsumer {static readonly inject=[token.id];constructor(context:Context){token.parse(Reflect.get(context,token.id));}}
      await this.mount(ReadinessConsumer,undefined);
    }
    this.healthy();
  }
  private selected(item:ValidatedRegistration):boolean {for(const selection of this.selections)if(selection.capability===item.declaration.capability&&selection.providerId===item.declaration.id)return true;return false;}
  async mount<P extends Plugin.Constructor>(plugin:P,configuration:ConstructorParameters<P>[1]):Promise<Fiber> {this.healthy();const fiber=this.context.plugin(plugin,configuration);try{await fiber.await();CompositionError.require(fiber.state===FiberState.ACTIVE,'PROVIDER_NOT_READY');this.healthy();return fiber;}catch{throw new CompositionError('PROVIDER_LIFECYCLE');}}
  locator(context:Context):CordisServiceLocator {CompositionError.require(Context.is(context)&&context[Context.root]===this.context[Context.root],'SCOPE_MISMATCH');CompositionError.require(context.fiber.runtime!==null,'DECLARED_INJECTION_REQUIRED');return new CordisServiceLocator(this,context);}
  describe(token:CapabilityToken):ProviderDescription[] {
    this.healthy();const result:ProviderDescription[]=[];
    for(const item of this.registrations)if(item.token.id===token.id){let ready=false;const runtime=this.context.registry.get(item.plugin);if(runtime)for(const fiber of runtime.fibers)if(fiber.state===FiberState.ACTIVE)ready=true;result.push({id:item.declaration.id,capability:item.token.id,selected:this.selected(item),ready,artifact:item.artifact});}
    return result;
  }
  healthy():void {CompositionError.require(!this.closed,'COMPOSITION_CLOSED');CompositionError.require(!this.fenced,'COMPOSITION_FENCED');this.checkErrors();}
  private checkErrors():void {CompositionError.require(!this.faults.failed,'PROVIDER_LIFECYCLE');}
  isSelected(token:CapabilityToken):boolean {for(const item of this.registrations)if(item.token.id===token.id&&item.token.contractVersion===token.contractVersion&&this.selected(item))return true;return false;}
  leaseOpened(lease:ProviderLease<object>):void{this.leases.add(lease);}
  leaseClosed(lease:ProviderLease<object>):void{this.leases.delete(lease);}
  get leaseCount():number{return this.leases.size;}
  fence():void{this.fenced=true;}
  drain(timeoutMs:number):Promise<boolean>{CompositionError.require(Number.isInteger(timeoutMs)&&timeoutMs>=0&&timeoutMs<=120000,'INVALID_DRAIN_INTERVAL');return new LeaseDrain(this,timeoutMs).wait();}
  async dispose():Promise<void> {if(!this.disposal){this.closed=true;this.disposal=this.close();}return this.disposal;}
  private async close():Promise<void> {try{await this.context.fiber.dispose();this.checkErrors();}catch{throw new CompositionError('PROVIDER_LIFECYCLE');}finally{this.context.logger.exporters.delete(-1);}}
}
export class CordisServiceLocator {
  static from(context:Context):CordisServiceLocator {CompositionError.require(Context.is(context)&&Object.hasOwn(context.fiber.inject,'cordis.composition'),'DECLARED_INJECTION_REQUIRED');const handle=Reflect.get(context,'cordis.composition') as CompositionHandle;return handle.locator(context);}
  constructor(private readonly handle:CompositionHandle,private readonly context:Context){}
  describe(token:CapabilityToken):ProviderDescription[] {return this.handle.describe(token);}
  async acquire<T extends object>(token:CapabilityToken<T>):Promise<ProviderLease<T>> {
    this.handle.healthy();CompositionError.require(Object.hasOwn(this.context.fiber.inject,token.id),'DECLARED_INJECTION_REQUIRED');CompositionError.require(this.context.fiber.state===FiberState.ACTIVE&&this.handle.isSelected(token),'PROVIDER_NOT_READY');
    let value:T;try{value=token.parse(Reflect.get(this.context,token.id));}catch{throw new CompositionError('INVALID_PROVIDER_ADAPTER');}
    return new ProviderLease(value,this.handle,this.context);
  }
}
class LeaseMethods implements ProxyHandler<(...args:unknown[])=>unknown> {
  constructor(private readonly lease:ProviderLease<object>,private readonly target:object){}
  apply(method:(...args:unknown[])=>unknown,_receiver:unknown,args:unknown[]):unknown {this.lease.assertOpen();return Reflect.apply(method,this.target,args);}
}
class LeaseAccess<T extends object> implements ProxyHandler<T> {
  constructor(private readonly lease:ProviderLease<T>){}
  get(target:T,key:string|symbol):unknown {this.lease.assertOpen();const value=Reflect.get(target,key,target) as unknown;return typeof value==='function'?new Proxy(value as (...args:unknown[])=>unknown,new LeaseMethods(this.lease,target)):value;}
  set():boolean {this.lease.assertOpen();throw new CompositionError('READONLY_PROVIDER');}
}
export class ProviderLease<T extends object> {
  readonly generation:string;
  private open=true;private releasing:Promise<void>|null=null;
  private readonly proxy:T;
  private readonly disposer:()=>void|Promise<void>;
  constructor(value:T,private readonly handle:CompositionHandle,private readonly context:Context){this.generation=handle.generation;this.proxy=new Proxy(value,new LeaseAccess(this));this.disposer=context.effect(this.effect.bind(this));this.handle.leaseOpened(this);}
  private effect():()=>Promise<void> {return this.release.bind(this);}
  assertOpen():void {CompositionError.require(this.open,'LEASE_CLOSED');this.handle.healthy();CompositionError.require(this.context.fiber.state===FiberState.ACTIVE,'PROVIDER_NOT_READY');}
  get value():T {this.assertOpen();return this.proxy;}
  release():Promise<void> {if(!this.open)return this.releasing??Promise.resolve();this.open=false;this.releasing=this.close();return this.releasing;}
  private async close():Promise<void>{try{await this.disposer();}finally{this.handle.leaseClosed(this);}}
}
class LeaseDrain {
 private complete=false;private timer:ReturnType<typeof setTimeout>|undefined;private disposer:(()=>void|Promise<void>)|undefined;private resolve:((value:boolean)=>void)|null=null;private reject:((error:Error)=>void)|null=null;private readonly deadline:number;
 constructor(private readonly handle:CompositionHandle,timeoutMs:number){this.deadline=Date.now()+timeoutMs;}
 wait():Promise<boolean>{return new Promise(this.begin.bind(this));}
 private begin(resolve:(value:boolean)=>void,reject:(error:Error)=>void):void{this.resolve=resolve;this.reject=reject;this.disposer=this.handle.context.effect(this.effect.bind(this));this.tick();}
 private effect():()=>Promise<void>{return this.cancel.bind(this);}
 private cancel():Promise<void>{return this.finish(false,false);}
 private tick():void{if(this.complete)return;if(this.handle.leaseCount===0){void this.finish(true,true);return;}if(Date.now()>=this.deadline){void this.finish(false,true);return;}this.timer=setTimeout(this.tick.bind(this),5);}
 private async finish(value:boolean,detach:boolean):Promise<void>{if(this.complete)return;this.complete=true;clearTimeout(this.timer);try{if(detach)await this.disposer?.();this.resolve!(value);}catch{this.reject!(new CompositionError('PROVIDER_LIFECYCLE'));}}
}
class ScopeReceiver {context:Context|null=null;accept(context:Context):void{this.context=context;}}
interface ScopeMount {handle:CompositionHandle;context:Context;}
export interface ScopeReplacement {state:'pending'|'mounted';generation:string;}
/** Admission only. Workload readiness and durable publication remain owner invariants. */
export class CordisScope {
 private phase:'open'|'draining'|'mounted'|'fenced'|'closed'='open';private pending:CompositionDescriptor|null=null;private disposed:Promise<void>|null=null;private committed:string;private replacementRunning=false;private transition:Promise<ScopeReplacement>|null=null;
 private constructor(private current:ScopeMount,private readonly authority:TrustedCompositionContext){this.committed=current.handle.generation;}
 static async start(descriptor:CompositionDescriptor,authority:TrustedCompositionContext):Promise<CordisScope>{const accepted=CompositionProviderSchemas.scope.parse(authority);return new CordisScope(await this.mount(descriptor,accepted),accepted);}
 private static async mount(descriptor:CompositionDescriptor,authority:TrustedCompositionContext):Promise<ScopeMount>{const handle=await CordisComposition.start(descriptor,authority),receiver=new ScopeReceiver(),inject=['cordis.composition'];for(const selection of descriptor.selections)inject.push(selection.capability);class Gateway {static readonly inject=inject;constructor(context:Context){receiver.accept(context);}}try{await handle.mount(Gateway,undefined);CompositionError.require(receiver.context,'PROVIDER_NOT_READY');return {handle,context:receiver.context};}catch(error){await handle.dispose();throw error;}}
 get generation():string{return this.committed;}
 async acquire<T extends object>(token:CapabilityToken<T>):Promise<ProviderLease<T>>{CompositionError.require(this.phase==='open','ADMISSION_CLOSED');return this.current.handle.locator(this.current.context).acquire(token);}
 async beginReplacement(descriptor:CompositionDescriptor,expectedGeneration:string,timeoutMs=30000):Promise<ScopeReplacement>{CompositionError.require(this.phase==='open','COMPOSITION_BUSY');CompositionError.require(Number.isInteger(timeoutMs)&&timeoutMs>=0&&timeoutMs<=120000,'INVALID_DRAIN_INTERVAL');CompositionError.require(expectedGeneration===this.committed,'STALE_COMPOSITION');const registrations=CompositionValidation.safe(descriptor,this.authority),selections:ProviderSelection[]=[];for(const selection of descriptor.selections)selections.push(ProviderSchemas.selection.parse(selection));this.pending={registrations,selections};this.phase='draining';return this.continueReplacement(timeoutMs);}
 async continueReplacement(timeoutMs=30000):Promise<ScopeReplacement>{CompositionError.require(this.phase==='draining'&&this.pending,'NO_PENDING_REPLACEMENT');CompositionError.require(!this.replacementRunning,'COMPOSITION_BUSY');this.replacementRunning=true;const operation=this.replace(timeoutMs);this.transition=operation;try{return await operation;}finally{this.replacementRunning=false;this.transition=null;}}
 private assertReplacing():void{CompositionError.require(this.phase!=='closed','COMPOSITION_CLOSED');CompositionError.require(this.phase==='draining'&&this.pending,'COMPOSITION_FENCED');}
 private async replace(timeoutMs:number):Promise<ScopeReplacement>{try{const drained=await this.current.handle.drain(timeoutMs);this.assertReplacing();if(!drained)return {state:'pending',generation:this.committed};await this.current.handle.dispose();this.assertReplacing();const candidate=await CordisScope.mount(this.pending!,this.authority);try{this.assertReplacing();}catch(error){await candidate.handle.dispose();throw error;}this.current=candidate;this.phase='mounted';return {state:'mounted',generation:candidate.handle.generation};}catch(error){this.fence();throw error;}}
 async inspectCandidate<T extends object>(token:CapabilityToken<T>):Promise<ProviderLease<T>>{CompositionError.require(this.phase==='mounted','NO_MOUNTED_CANDIDATE');return this.current.handle.locator(this.current.context).acquire(token);}
 commitReplacement():string{CompositionError.require(this.phase==='mounted'&&this.current.handle.leaseCount===0,'CANDIDATE_NOT_COMMITTABLE');this.current.handle.healthy();this.committed=this.current.handle.generation;this.pending=null;this.phase='open';return this.committed;}
 fence():void{if(this.phase==='closed')return;this.phase='fenced';this.current.handle.fence();}
 dispose():Promise<void>{if(!this.disposed){this.phase='closed';this.disposed=this.close();}return this.disposed;}
 private async close():Promise<void>{try{await this.current.handle.dispose();}finally{try{await this.transition;}catch{}}}
}
