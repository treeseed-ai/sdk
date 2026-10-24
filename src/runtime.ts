import { Context, FiberState, type Plugin, type Fiber, type Message } from 'cordis';
import { CapabilityToken, ProviderSchemas, CanonicalJson, type ProviderDeclaration, type ProviderSelection, type ProviderArtifact, type PreparedProviderManifest } from './contracts.js';
import { openSync, closeSync, fstatSync, readFileSync, lstatSync, readdirSync, constants } from 'node:fs';
import { resolve, join, dirname, relative, isAbsolute, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { parse, visit, type ParseError } from 'jsonc-parser';
import { valid, validRange, satisfies } from 'semver';
export { Context } from 'cordis';
export interface ProviderRegistration {token:CapabilityToken;declaration:unknown;plugin:Plugin.Constructor;configuration:unknown;artifact:ProviderArtifact;}
export interface TrustedCompositionContext {scopeId:string;target:'cli'|'api'|'deployment'|'agent';principalId:string;resourceScope:string;}
export interface CompositionDescriptor {registrations:readonly ProviderRegistration[];selections:readonly ProviderSelection[];}
export interface ProviderDescription {id:string;capability:string;selected:boolean;ready:boolean;artifact:ProviderArtifact;}
export class CompositionError extends Error {
  constructor(readonly code:string){super(code);this.name='CompositionError';}
  static require(condition:unknown,code:string):asserts condition {if(!condition)throw new CompositionError(code);}
}
interface ValidatedRegistration extends ProviderRegistration {declaration:ProviderDeclaration;}
class CompositionValidation {
  static validate(descriptor:CompositionDescriptor,authority:TrustedCompositionContext):ValidatedRegistration[] {
    CompositionError.require(ProviderSchemas.scope.safeParse(authority).success,'INVALID_SCOPE');
    const registrations:ValidatedRegistration[]=[],identities=new Set<string>();
    for(const item of descriptor.registrations){
      const parsed=ProviderSchemas.declaration.safeParse(item.declaration);CompositionError.require(parsed.success,'INVALID_PROVIDER_DECLARATION');
      const declaration=parsed.data,artifact=ProviderSchemas.artifact.safeParse(item.artifact);CompositionError.require(artifact.success,'INVALID_PROVIDER_ARTIFACT');
      CompositionError.require(declaration.capability!=='cordis.composition','RESERVED_CAPABILITY');
      CompositionError.require(declaration.capability===item.token.id&&declaration.contractVersion===item.token.contractVersion&&declaration.target===authority.target,'INCOMPATIBLE_PROVIDER');
      CompositionError.require(!identities.has(declaration.capability+':'+declaration.id),'DUPLICATE_PROVIDER');identities.add(declaration.capability+':'+declaration.id);
      const provide=typeof item.plugin.provide==='string'?[item.plugin.provide]:item.plugin.provide,inject=item.plugin.inject;
      CompositionError.require(Array.isArray(provide)&&Array.isArray(inject)&&CanonicalJson.stringify([...provide].sort())===CanonicalJson.stringify([...declaration.provide].sort())&&CanonicalJson.stringify([...inject].sort())===CanonicalJson.stringify([...declaration.inject].sort())&&declaration.provide.length===1&&declaration.provide[0]===declaration.capability,'DECLARATION_DRIFT');
      CompositionError.require(item.plugin.Config&&typeof item.plugin.Config['~standard']?.validate==='function','INVALID_PROVIDER_CONFIGURATION');
      const accepted:unknown=JSON.parse(CanonicalJson.stringify(item.configuration)),configuration=item.plugin.Config['~standard'].validate(accepted);CompositionError.require(!('then' in configuration)&&!configuration.issues,'INVALID_PROVIDER_CONFIGURATION');
      registrations.push({...item,configuration:accepted,declaration,artifact:artifact.data});
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
    let registrations:ValidatedRegistration[];
    try{registrations=CompositionValidation.validate(descriptor,authority);}catch(error){if(error instanceof CompositionError)throw error;throw new CompositionError('INVALID_COMPOSITION');}
    const selections=descriptor.selections.map(CordisComposition.selection).sort(CordisComposition.order);registrations.sort(CordisComposition.registrationOrder);
    const handle=new CompositionHandle(registrations,selections,Object.freeze(ProviderSchemas.scope.parse(authority)));
    try {await handle.start();return handle;}catch{try{await handle.dispose();}catch{}throw new CompositionError('PROVIDER_LIFECYCLE');}
  }
}
class CompositionKernel {static readonly provide=['cordis.composition'];constructor(context:Context,handle:CompositionHandle){context.provide('cordis.composition',handle);}}
class LifecycleFaults {failed=false;export(message:Message):void {if(message.type==='error')this.failed=true;}}
export class CompositionHandle {
  private readonly faults=new LifecycleFaults();
  readonly context=new Context();
  readonly generation:string;
  private closed=false;
  private disposal:Promise<void>|null=null;
  constructor(private readonly registrations:ValidatedRegistration[],private readonly selections:readonly ProviderSelection[],readonly authority:TrustedCompositionContext){this.generation=CanonicalJson.digest({authority,selections,providers:registrations.map(CompositionHandle.identity)});this.context.logger.exporters.set(-1,this.faults);}
  private static identity(item:ValidatedRegistration):object {return {declaration:item.declaration,configuration:item.configuration,artifact:item.artifact};}
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
  healthy():void {CompositionError.require(!this.closed,'COMPOSITION_CLOSED');this.checkErrors();}
  private checkErrors():void {CompositionError.require(!this.faults.failed,'PROVIDER_LIFECYCLE');}
  isSelected(token:CapabilityToken):boolean {for(const item of this.registrations)if(item.token.id===token.id&&item.token.contractVersion===token.contractVersion&&this.selected(item))return true;return false;}
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
  private open=true;
  private readonly proxy:T;
  private readonly disposer:()=>void|Promise<void>;
  constructor(value:T,private readonly handle:CompositionHandle,private readonly context:Context){this.generation=handle.generation;this.proxy=new Proxy(value,new LeaseAccess(this));this.disposer=context.effect(this.effect.bind(this));}
  private effect():()=>Promise<void> {return this.release.bind(this);}
  assertOpen():void {CompositionError.require(this.open,'LEASE_CLOSED');this.handle.healthy();CompositionError.require(this.context.fiber.state===FiberState.ACTIVE,'PROVIDER_NOT_READY');}
  get value():T {this.assertOpen();return this.proxy;}
  async release():Promise<void> {if(!this.open)return;this.open=false;await this.disposer();}
}
class JsonKeys {
  private readonly stack:Set<string>[]=[];duplicate=false;
  begin():void {this.stack.push(new Set());}
  property(key:string):void {const keys=this.stack[this.stack.length-1]!;if(keys.has(key)||key==='__proto__')this.duplicate=true;keys.add(key);}
  end():void {this.stack.pop();}
}
class VerifiedProvider {
  private constructor(readonly url:string,readonly root:string,readonly manifest:PreparedProviderManifest,readonly digest:string,private readonly token:CapabilityToken){}
  static read(file:string,digest:string,target:string,scopeId:string,token:CapabilityToken):VerifiedProvider {
    CompositionError.require(/^[a-f0-9]{64}$/.test(digest)&&isAbsolute(file),'INVALID_PREPARED_PROVIDER');
    const root=dirname(file);CompositionError.require(basename(root)===digest,'PROVIDER_IMMUTABLE_PATH');const bytes=InstalledProviderLoader.read(file);CompositionError.require(InstalledProviderLoader.sha(bytes)===digest,'PROVIDER_INTEGRITY');
    const value=InstalledProviderLoader.json(bytes);
    const parsed=ProviderSchemas.manifest.safeParse(value);CompositionError.require(parsed.success,'INVALID_PREPARED_PROVIDER');const manifest=parsed.data;CompositionError.require(manifest.target===target&&manifest.scopeId===scopeId,'SCOPE_MISMATCH');
    const verified=new VerifiedProvider(pathToFileURL(join(root,manifest.entry)).href,root,manifest,digest,token);verified.verify(file);return verified;
  }
  verify(manifestFile:string):void {
    const expected=new Set<string>(),files=this.files(this.root),entry=this.manifest.entry;
    for(const file of this.manifest.files){CompositionError.require(!expected.has(file.path)&&file.path!==relative(this.root,manifestFile),'INVALID_PREPARED_PROVIDER');expected.add(file.path);const path=join(this.root,file.path);CompositionError.require(InstalledProviderLoader.sha(InstalledProviderLoader.read(path))===file.sha256,'PROVIDER_INTEGRITY');}
    CompositionError.require(expected.has(entry)&&expected.has('package.json'),'MISSING_PROVIDER_ENTRY');
    const metadata=InstalledProviderLoader.json(InstalledProviderLoader.read(join(this.root,'package.json'))) as Record<string,unknown>;CompositionError.require(metadata&&typeof metadata==='object'&&metadata.name===this.manifest.package.name&&metadata.version===this.manifest.package.version,'PROVIDER_PACKAGE_IDENTITY');
    const declaration=ProviderSchemas.declaration.safeParse(metadata.cordis);CompositionError.require(declaration.success&&declaration.data.id===this.manifest.providerId&&declaration.data.target===this.manifest.target&&declaration.data.capability===this.token.id&&declaration.data.contractVersion===this.token.contractVersion,'INVALID_PROVIDER_DECLARATION');
    for(const path of expected)if(path==='node_modules/cordis/package.json'||path.endsWith('/node_modules/cordis/package.json')){const framework=InstalledProviderLoader.json(InstalledProviderLoader.read(join(this.root,path))) as {version?:unknown};CompositionError.require(framework.version==='4.0.0-rc.12','INCOMPATIBLE_FRAMEWORK');}
    this.dependencies(this.root,new Set());
    files.delete(relative(this.root,manifestFile));CompositionError.require(files.size===expected.size,'PROVIDER_CLOSURE');for(const file of files)CompositionError.require(expected.has(file),'PROVIDER_CLOSURE');
    CompositionError.require(InstalledProviderLoader.sha(InstalledProviderLoader.read(manifestFile))===this.digest,'PROVIDER_INTEGRITY');
  }
  private dependencies(directory:string,visited:Set<string>):void {
    if(visited.has(directory))return;visited.add(directory);
    const metadata=InstalledProviderLoader.json(InstalledProviderLoader.read(join(directory,'package.json'))) as Record<string,unknown>;
    for(const field of ['dependencies','peerDependencies']){
      const entries=metadata[field];if(entries===undefined)continue;CompositionError.require(entries!==null&&typeof entries==='object'&&!Array.isArray(entries),'PROVIDER_DEPENDENCY');
      for(const [name,range] of Object.entries(entries)){
        CompositionError.require(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name)&&typeof range==='string'&&validRange(range)!==null,'PROVIDER_DEPENDENCY');
        let current=directory,selected:string|null=null;
        while(current===this.root||current.startsWith(this.root+'/')){const candidate=join(current,'node_modules',name);try{lstatSync(join(candidate,'package.json'));selected=candidate;break;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}if(current===this.root)break;current=dirname(current);}
        if(selected===null){const peers=metadata.peerDependenciesMeta as Record<string,{optional?:unknown}>|undefined;CompositionError.require(field==='peerDependencies'&&peers?.[name]?.optional===true,'PROVIDER_DEPENDENCY');continue;}
        const dependency=InstalledProviderLoader.json(InstalledProviderLoader.read(join(selected,'package.json'))) as {name?:unknown;version?:unknown};CompositionError.require(dependency.name===name&&typeof dependency.version==='string'&&valid(dependency.version)!==null&&satisfies(dependency.version,range as string),'PROVIDER_DEPENDENCY');this.dependencies(selected,visited);
      }
    }
  }
  private files(directory:string,prefix='',budget={entries:0,bytes:0}):Set<string> {
    CompositionError.require(prefix.split('/').length<=64,'PROVIDER_CLOSURE_LIMIT');
    const stat=lstatSync(directory);CompositionError.require(stat.isDirectory()&&!stat.isSymbolicLink()&&stat.uid===process.getuid?.()&&(stat.mode&0o777)===0o500,'PROVIDER_OWNERSHIP');
    const result=new Set<string>();for(const entry of readdirSync(directory,{withFileTypes:true})){CompositionError.require(++budget.entries<=8192&&!entry.isSymbolicLink(),'PROVIDER_CLOSURE_LIMIT');const relative=prefix+entry.name;if(entry.isDirectory())for(const file of this.files(join(directory,entry.name),relative+'/',budget))result.add(file);else {CompositionError.require(entry.isFile(),'PROVIDER_FILE');budget.bytes+=lstatSync(join(directory,entry.name)).size;CompositionError.require(budget.bytes<=64*1024*1024,'PROVIDER_CLOSURE_LIMIT');result.add(relative);}}return result;
  }
}
export class InstalledProviderLoader {
  static json(bytes:Uint8Array):unknown {const keys=new JsonKeys(),errors:ParseError[]=[],text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);visit(text,{onObjectBegin:keys.begin.bind(keys),onObjectProperty:keys.property.bind(keys),onObjectEnd:keys.end.bind(keys)},{disallowComments:true,allowTrailingComma:false});const value:unknown=parse(text,errors,{disallowComments:true,allowTrailingComma:false});CompositionError.require(!keys.duplicate&&errors.length===0,'INVALID_PREPARED_PROVIDER');return value;}
  static sha(bytes:Uint8Array):string {return createHash('sha256').update(bytes).digest('hex');}
  static read(file:string):Buffer {
    // Every ancestor is checked; the qualified store is private, immutable and trusted-owner controlled.
    let current=resolve(file);while(true){const stat=lstatSync(current);CompositionError.require(!stat.isSymbolicLink(),'PROVIDER_SYMLINK');const parent=dirname(current);if(parent===current)break;current=parent;}
    const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    try{const before=fstatSync(fd);CompositionError.require(before.isFile()&&before.nlink===1&&before.uid===process.getuid?.()&&(before.mode&0o777)===0o400&&before.size<=8*1024*1024,'PROVIDER_FILE');const bytes=readFileSync(fd),after=fstatSync(fd);const linked=lstatSync(file);CompositionError.require(!linked.isSymbolicLink()&&linked.dev===before.dev&&linked.ino===before.ino&&bytes.length===before.size&&before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs,'PROVIDER_CHANGED');return bytes;}finally{closeSync(fd);}
  }
  static async load<T extends object>(file:string,digest:string,token:CapabilityToken<T>,target:TrustedCompositionContext['target'],scopeId:string):Promise<ProviderRegistration> {
    try {
      const verified=VerifiedProvider.read(file,digest,target,scopeId,token),module=await this.importVerified(verified);verified.verify(file);
      CompositionError.require(typeof module.Provider==='function','INVALID_PROVIDER_EXPORT');
      const plugin=module.Provider as Plugin.Constructor&{declaration?:unknown},parsed=ProviderSchemas.declaration.safeParse(plugin.declaration),metadata=InstalledProviderLoader.json(InstalledProviderLoader.read(join(verified.root,'package.json'))) as {cordis:unknown};CompositionError.require(parsed.success&&parsed.data.id===verified.manifest.providerId&&parsed.data.capability===token.id&&CanonicalJson.stringify(parsed.data)===CanonicalJson.stringify(metadata.cordis),'INVALID_PROVIDER_EXPORT');
      return {token,declaration:parsed.data,plugin,configuration:verified.manifest.configuration,artifact:{kind:'prepared',digest}};
    }catch(error){if(error instanceof CompositionError)throw error;throw new CompositionError('PREPARED_PROVIDER_FAILURE');}
  }
  private static async importVerified(verified:VerifiedProvider):Promise<Record<string,unknown>> {return import(verified.url);}
}
