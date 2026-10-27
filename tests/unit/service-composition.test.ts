import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {ServiceCompositionTests} from '../support/service-composition-test-support.js';
class ServiceCompositionTestsUnit extends ServiceCompositionTests {

  async graph():Promise<void> {
    const sdk=await import('../../src/contracts.js') as unknown as {ServiceSchemas:{graph:{safeParse(value:unknown):{success:boolean}}}};
    const services:unknown[]=[];for(let i=0;i<5;i++)services.push(this.service('fixture-'+i));
    const graph={profile:{id:'fixture',version:'1.0.0',requiredBindings:['fixture-0']},assetDigest:'a'.repeat(64),worker:{path:'worker.js',sha256:'a'.repeat(64),size:1},services};
    expect(sdk.ServiceSchemas.graph.safeParse(graph).success).toBe(true);
    const first=services[0] as {dependencies:object[]};first.dependencies=[{port:'input',bindingId:'missing',contractId:'fixture.echo',contractVersion:'1.0.0'}];expect(sdk.ServiceSchemas.graph.safeParse(graph).success).toBe(false);first.dependencies=[];
    services.push(this.service('fixture-0'));expect(sdk.ServiceSchemas.graph.safeParse(graph).success).toBe(false);
    services.length=0;expect(sdk.ServiceSchemas.graph.safeParse(graph).success).toBe(false);
    for(let i=0;i<257;i++)services.push(this.service('fixture-'+i));expect(sdk.ServiceSchemas.graph.safeParse(graph).success).toBe(false);
  }
}
class ServiceGrantTestsUnit {

 async credentials():Promise<void>{const {ServiceSchemas}=await import('../../src/contracts.js'),fixture=new ServiceCompositionTests(),source=fixture.service('database') as {resources:Record<string,unknown>},consumer=fixture.service('consumer') as {dependencies:object[];resources:Record<string,unknown>;readiness:Record<string,unknown>};source.resources.slots={password:{kind:'random'}};consumer.dependencies=[{port:'database',bindingId:'database',contractId:'fixture.echo',contractVersion:'1.0.0'}];consumer.resources.grants=[{serviceId:'database',slot:'password'}];consumer.readiness.credentialReferences=['secret://database/password'];const graph={profile:{id:'fixture',version:'1.0.0',requiredBindings:['database']},assetDigest:'a'.repeat(64),worker:{path:'worker.js',sha256:'a'.repeat(64),size:1},services:[source,consumer]};expect(ServiceSchemas.graph.safeParse(graph).success).toBe(true);consumer.resources.grants=[];expect(ServiceSchemas.graph.safeParse(graph).success).toBe(false);consumer.resources.grants=[{serviceId:'database',slot:'password'}];consumer.dependencies=[];expect(ServiceSchemas.graph.safeParse(graph).success).toBe(false);}
}
class ServicePortTestsUnit {
async ports():Promise<void>{const {ServiceSchemas}=await import('../../src/contracts.js');const binding=ServiceSchemas.binding.safeParse({port:'http',bindingId:'first',contractId:'fixture.echo',contractVersion:'1.0.0'});expect(binding.success).toBe(true);const service=new ServiceCompositionTests().service('fixture') as {readiness:Record<string,unknown>};service.readiness.scheme='ftp';expect(ServiceSchemas.service.safeParse(service).success).toBe(false);}
}
const suite=new ServiceCompositionTestsUnit();
const grants=new ServiceGrantTestsUnit();
const ports=new ServicePortTestsUnit();
test("unit: extensible service graph supports repeated providers with bounded validation",suite.graph.bind(suite));
test('unit: cross-service probe credentials require both dependency and explicit grant',grants.credentials.bind(grants));
test('unit: provided ports and readiness schemes are explicit typed contracts',ports.ports.bind(ports));
