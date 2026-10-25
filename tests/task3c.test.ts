import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
class Task3cTests {
  portableProgram():void {
    const code="import {CordisComposition} from '@treeseed-cordis/sdk/composition';class Program{static async run(){const h=await CordisComposition.start({registrations:[],selections:[]},{scopeId:'browser',target:'browser',principalId:'fixture',resourceScope:'public'});if(!/^[a-f0-9]{64}$/.test(h.generation))throw new Error('generation');await h.dispose();}}await Program.run();";
    const result=spawnSync('node',['--input-type=module','-e',code],{encoding:'utf8'});expect(result.status).toBe(0);expect(result.stderr).toBe('');
  }
  async graph():Promise<void> {
    const sdk=await import('../src/contracts.js') as unknown as {ServiceSchemas:{graph:{safeParse(value:unknown):{success:boolean}}}};
    const services:unknown[]=[];for(let i=0;i<5;i++)services.push(this.service('fixture-'+i));
    const graph={profile:{id:'fixture',version:'1.0.0',requiredBindings:['fixture-0']},assetDigest:'a'.repeat(64),worker:{path:'worker.js',sha256:'a'.repeat(64),size:1},services};
    expect(sdk.ServiceSchemas.graph.safeParse(graph).success).toBe(true);
    const first=services[0] as {dependencies:object[]};first.dependencies=[{port:'input',bindingId:'missing',contractId:'fixture.echo',contractVersion:'1.0.0'}];expect(sdk.ServiceSchemas.graph.safeParse(graph).success).toBe(false);first.dependencies=[];
    services.push(this.service('fixture-0'));expect(sdk.ServiceSchemas.graph.safeParse(graph).success).toBe(false);
    services.length=0;expect(sdk.ServiceSchemas.graph.safeParse(graph).success).toBe(false);
    for(let i=0;i<257;i++)services.push(this.service('fixture-'+i));expect(sdk.ServiceSchemas.graph.safeParse(graph).success).toBe(false);
  }
  service(serviceId:string):object {
    const provider={pluginId:'fixture',providerId:'fixture',target:'deployment',package:{name:'@test/service',version:'1.0.0',sha256:'a'.repeat(64)},entry:'dist/service.js',classExport:'FixturePlugin',contractVersion:'0.4.0-cordis.1'};
    return {serviceId,provider,configuration:{},definition:{imageId:'fixture',command:['serve'],environment:{},ports:[{id:'http',target:8080}],volumes:[],secrets:[],workerSocket:false},bindings:[{bindingId:serviceId,contractId:'fixture.echo',contractVersion:'1.0.0'}],dependencies:[],readiness:{provider,configuration:{},endpoint:{serviceId,portId:'http'},deadlineMs:5000,observationContract:'fixture.echo'},resources:{volumes:[],slots:{}},transitionPolicy:{kind:'additive',stateVersion:1}};
  }
  browserClosure():void {const code=readFileSync('dist/src/composition.js','utf8');expect(code).not.toContain('node:');expect(code).not.toContain('./contracts.js');}
}
const suite=new Task3cTests();
test('unit: Task3C fifth service repeated providers and bounded graph validation',suite.graph.bind(suite));
