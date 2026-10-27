import {test,expect} from 'bun:test';
import {spawnSync} from 'node:child_process';
class ProbeEvidenceTestsUnit {

 async evidence():Promise<void>{const module=await import('../../src/contracts.js') as unknown as {ServiceSchemas:{runtimeEvidence:{safeParse(value:unknown):{success:boolean}}}};const value={formatVersion:1,installationId:'fixture',serviceId:'api',compositionGeneration:'a'.repeat(64),serviceGeneration:'b'.repeat(64),runtimeGeneration:'c'.repeat(64),assetDigest:'d'.repeat(64),ready:true};expect(module.ServiceSchemas.runtimeEvidence.safeParse(value).success).toBe(true);expect(module.ServiceSchemas.runtimeEvidence.safeParse({...value,runtimeGeneration:'guessed'}).success).toBe(false);expect(module.ServiceSchemas.runtimeEvidence.safeParse({...value,credentials:'plaintext-canary'}).success).toBe(false);}

 async prepared():Promise<void>{const {PluginManagementSchemas}=await import('../../src/contracts.js');expect(PluginManagementSchemas.image.safeParse({id:'identity',reference:'fixture/identity@sha256:'+'a'.repeat(64),manifestDigest:'a'.repeat(64),indexSha256:'b'.repeat(64),source:{kind:'prepared'}}).success).toBe(true);expect(PluginManagementSchemas.image.safeParse({id:'identity',reference:'fixture/identity:latest',manifestDigest:'a'.repeat(64),indexSha256:'b'.repeat(64),source:{kind:'prepared'}}).success).toBe(false);}
}
class PrivatePlanTestsUnit {

 async request():Promise<void>{const {ServiceWorkerSchemas}=await import('../../src/contracts.js'),configuration={installationId:'fixture',engineContext:'default',installationDirectory:'/tmp/installation',origin:'https://localhost:8443',runtimeState:'running',plugins:[{id:'fixture',package:'@fixture/plugin',version:'1.0.0',integrity:'a'.repeat(64)}],credentialReferences:[],release:{directory:'/tmp/release',manifestDigest:'b'.repeat(64)}},request={protocol:3,operation:'plan',configuration};expect(ServiceWorkerSchemas.request.safeParse(request).success).toBe(true);expect(ServiceWorkerSchemas.request.safeParse({...request,principalId:'spoofed'}).success).toBe(false);expect(ServiceWorkerSchemas.request.safeParse({...request,protocol:2}).success).toBe(false);}
}
const suite=new ProbeEvidenceTestsUnit();
const privatePlan=new PrivatePlanTestsUnit();
test('unit: runtime evidence distinguishes actual generations and rejects credentials',suite.evidence.bind(suite));
test('unit: prepared images remain exact immutable declarations without fake acquisition URLs',suite.prepared.bind(suite));
test('unit: private worker plans retain exact local config and reject caller supplied authority or old protocol',privatePlan.request.bind(privatePlan));
