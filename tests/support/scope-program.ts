import {createServer,type ServerResponse,type IncomingMessage,type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {Service} from 'cordis';
import {z} from 'zod';
import {Context,CordisScope,type ProviderRegistration} from '@treeseed-cordis/sdk/composition';
import {CapabilityToken,ProviderV4Schemas} from '@treeseed-cordis/sdk/portable';
interface Listener {url():string;}
class ListenerValidation {parse(value:unknown):Listener{if(!value||typeof Reflect.get(value,'url')!=='function')throw new Error('INVALID_LISTENER');return value as Listener;}}
const token=new CapabilityToken<Listener>('fixture.listener',ProviderV4Schemas.version,new ListenerValidation());
class ListenerPlugin implements Listener {
 static readonly provide=['fixture.listener'];static readonly inject:string[]=[];static readonly Config=z.strictObject({port:z.number().int().min(0).max(65535),label:z.string()});static readonly declaration=ProviderV4Schemas.declaration.parse({id:'fixture.listener.first',pluginId:'fixture',capability:token.id,contractVersion:ProviderV4Schemas.version,target:'cli',provide:this.provide,inject:this.inject});
 private readonly server:Server;
 constructor(context:Context,private readonly configuration:{port:number;label:string}){this.server=createServer(this.request.bind(this));context.provide(token.id,this);context.effect(this.effect.bind(this));}
 private request(_request:IncomingMessage,response:ServerResponse):void{response.end(this.configuration.label);}
 private effect():()=>Promise<void>{return this.stop.bind(this);}
 private async stop():Promise<void>{if(this.server.listening)await new Promise<void>(this.close.bind(this));}
 private close(resolve:()=>void,reject:(error:Error)=>void):void{this.server.close(this.closed.bind(this,resolve,reject));}
 private closed(resolve:()=>void,reject:(error:Error)=>void,error?:Error):void{if(error)reject(error);else resolve();}
 async [Service.init]():Promise<void>{await new Promise<void>(this.listen.bind(this));}
 private listen(resolve:()=>void,reject:(error:Error)=>void):void{this.server.once('error',reject);this.server.listen(this.configuration.port,'127.0.0.1',resolve);}
 url():string{return 'http://127.0.0.1:'+(this.server.address() as AddressInfo).port;}
}
class NextListenerPlugin extends ListenerPlugin {static override readonly declaration={...ListenerPlugin.declaration,id:'fixture.listener.next'};}
class ScopeProgram {
 private static descriptor(next:boolean,port:number){const plugin=next?NextListenerPlugin:ListenerPlugin,registration:ProviderRegistration={token,plugin,declaration:plugin.declaration,configuration:{port,label:next?'second':'first'},artifact:{kind:'bundled',identity:plugin.declaration.id}};return {registrations:[registration],selections:[{scopeId:'listener-fixture',capability:token.id,providerId:plugin.declaration.id}]};}
 static async run():Promise<void>{const scope=await CordisScope.start(this.descriptor(false,0),{scopeId:'listener-fixture',target:'cli',principalId:'fixture-owner',resourceScope:'fixture-listener'}),lease=await scope.acquire(token);let url='';try{url=lease.value.url();if(await (await fetch(url,{headers:{Connection:'close'}})).text()!=='first')throw new Error('initial listener');const pending=await scope.beginReplacement(this.descriptor(true,Number(new URL(url).port)),scope.generation,1);if(pending.state!=='pending')throw new Error('lease did not drain');await lease.release();if((await scope.continueReplacement(1000)).state!=='mounted')throw new Error('not mounted');const candidate=await scope.inspectCandidate(token);try{if(candidate.value.url()!==url||await (await fetch(url,{headers:{Connection:'close'}})).text()!=='second')throw new Error('replacement listener');}finally{await candidate.release();}scope.commitReplacement();}finally{await lease.release();await scope.dispose();}let reachable=false;try{await fetch(url,{signal:AbortSignal.timeout(500)});reachable=true;}catch{}if(reachable)throw new Error('listener cleanup');process.stdout.write('scope-listener-ok\n');}
}
await ScopeProgram.run();
