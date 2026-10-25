import { PluginManagementSchemas,PackageDefinition,type NativeDescriptorClass,type PluginExportDescriptor } from './management.js';
import { type Plugin } from 'cordis';
import { CapabilityToken, ProviderSchemas, ProviderV4Schemas, CompositionProviderSchemas, CanonicalJson, type NativePreparedProviderManifest as PreparedProviderManifest } from './contracts.js';
import { CompositionError, type ProviderRegistration, type TrustedCompositionContext } from './composition.js';
export * from './composition.js';
import { openSync, closeSync, fstatSync, readFileSync, lstatSync, readdirSync, constants } from 'node:fs';
import { resolve, join, dirname, relative, isAbsolute, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { parse, visit, type ParseError } from 'jsonc-parser';
import { valid, validRange, satisfies } from 'semver';
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
    const parsed=ProviderSchemas.manifest.or(ProviderV4Schemas.manifest).safeParse(value);CompositionError.require(parsed.success,'INVALID_PREPARED_PROVIDER');const manifest=parsed.data;CompositionError.require(manifest.target===target&&manifest.scopeId===scopeId,'SCOPE_MISMATCH');
    const verified=new VerifiedProvider(pathToFileURL(join(root,manifest.entry)).href,root,manifest,digest,token);verified.verify(file);return verified;
  }
  verify(manifestFile:string):void {
    const expected=new Set<string>(),files=this.files(this.root),entry=this.manifest.entry;
    for(const file of this.manifest.files){CompositionError.require(!expected.has(file.path)&&file.path!==relative(this.root,manifestFile),'INVALID_PREPARED_PROVIDER');expected.add(file.path);const path=join(this.root,file.path);CompositionError.require(InstalledProviderLoader.sha(InstalledProviderLoader.read(path))===file.sha256,'PROVIDER_INTEGRITY');}
    CompositionError.require(expected.has(entry)&&expected.has('package.json'),'MISSING_PROVIDER_ENTRY');
    const metadata=InstalledProviderLoader.json(InstalledProviderLoader.read(join(this.root,'package.json'))) as Record<string,unknown>;CompositionError.require(metadata&&typeof metadata==='object'&&metadata.name===this.manifest.package.name&&metadata.version===this.manifest.package.version,'PROVIDER_PACKAGE_IDENTITY');
    const declaration=CompositionProviderSchemas.declaration.safeParse(InstalledProviderLoader.declaration(metadata,this.manifest.providerId,this.token.id,this.manifest.target,this.token.contractVersion));CompositionError.require(declaration.success&&declaration.data.id===this.manifest.providerId&&declaration.data.target===this.manifest.target&&declaration.data.capability===this.token.id&&declaration.data.contractVersion===this.token.contractVersion,'INVALID_PROVIDER_DECLARATION');
    const exported=InstalledProviderLoader.packageExport(metadata,this.manifest.providerId,this.token.id,this.manifest.target,this.token.contractVersion);if(exported)CompositionError.require(exported.entry===this.manifest.entry&&exported.classExport===('classExport' in this.manifest?this.manifest.classExport:'Provider'),'INVALID_PROVIDER_DECLARATION');
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
      CompositionError.require(target!=='browser','NODE_TARGET_REQUIRED');
      const verified=VerifiedProvider.read(file,digest,target,scopeId,token),module=await this.importVerified(verified);verified.verify(file);
      const exported=module['classExport' in verified.manifest?verified.manifest.classExport:'Provider'];CompositionError.require(typeof exported==='function','INVALID_PROVIDER_EXPORT');
      const plugin=exported as Plugin.Constructor&{declaration?:unknown},parsed=CompositionProviderSchemas.declaration.safeParse(plugin.declaration),metadata=InstalledProviderLoader.json(InstalledProviderLoader.read(join(verified.root,'package.json'))) as {cordis:unknown};CompositionError.require(parsed.success&&parsed.data.id===verified.manifest.providerId&&parsed.data.capability===token.id&&CanonicalJson.stringify(parsed.data)===CanonicalJson.stringify(this.declaration(metadata,verified.manifest.providerId,token.id,verified.manifest.target,token.contractVersion)),'INVALID_PROVIDER_EXPORT');
      const descriptor=this.packageExport(metadata,verified.manifest.providerId,token.id,verified.manifest.target,token.contractVersion);if(descriptor)CompositionError.require(descriptor.entry===verified.manifest.entry&&descriptor.classExport===('classExport' in verified.manifest?verified.manifest.classExport:'Provider')&&CanonicalJson.stringify(PackageDefinition.export(plugin as unknown as NativeDescriptorClass,descriptor.entry,descriptor.classExport))===CanonicalJson.stringify(descriptor),'INVALID_PROVIDER_EXPORT');
      return {token,declaration:parsed.data,plugin,configuration:verified.manifest.configuration,artifact:{kind:'prepared',digest}};
    }catch(error){if(error instanceof CompositionError)throw error;throw new CompositionError('PREPARED_PROVIDER_FAILURE');}
  }
  static packageExport(metadata:Record<string,unknown>,providerId:string,capability:string,target?:TrustedCompositionContext['target'],contractVersion?:string):PluginExportDescriptor|null {
    if(metadata.cordisPackage===undefined)return null;const descriptor=PluginManagementSchemas.packageDescriptor.parse(metadata.cordisPackage);CompositionError.require(descriptor.package.name===metadata.name&&descriptor.package.version===metadata.version,'PROVIDER_PACKAGE_IDENTITY');let selected:PluginExportDescriptor|null=null;
    for(const candidate of descriptor.providers){const declaration=candidate.declaration;if(declaration.id===providerId&&declaration.capability===capability&&(target===undefined||declaration.target===target)&&(contractVersion===undefined||declaration.contractVersion===contractVersion)){CompositionError.require(selected===null,'DUPLICATE_PROVIDER');selected=candidate;}}CompositionError.require(selected!==null,'INVALID_PROVIDER_DECLARATION');return selected;
  }
  static declaration(metadata:Record<string,unknown>,providerId:string,capability:string,target?:TrustedCompositionContext['target'],contractVersion?:string):unknown {
    const descriptor=this.packageExport(metadata,providerId,capability,target,contractVersion);if(descriptor)return descriptor.declaration;
    const candidates:unknown[]=[];if(metadata.cordis!==undefined)candidates.push(metadata.cordis);if(Array.isArray(metadata.cordisProviders))for(const candidate of metadata.cordisProviders)if(metadata.cordis===undefined||CanonicalJson.stringify(candidate)!==CanonicalJson.stringify(metadata.cordis))candidates.push(candidate);let selected:unknown;
    for(const candidate of candidates){const parsed=CompositionProviderSchemas.declaration.safeParse(candidate);CompositionError.require(parsed.success,'INVALID_PROVIDER_DECLARATION');if(parsed.data.id===providerId&&parsed.data.capability===capability&&(target===undefined||parsed.data.target===target)&&(contractVersion===undefined||parsed.data.contractVersion===contractVersion)){CompositionError.require(selected===undefined,'DUPLICATE_PROVIDER');selected=candidate;}}return selected;
  }
  private static async importVerified(verified:VerifiedProvider):Promise<Record<string,unknown>> {return import(verified.url);}
}
