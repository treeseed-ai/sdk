import {test,expect} from 'bun:test';
import {spawnSync} from 'node:child_process';
class ServiceJournalTestsIntegration {

 async resources():Promise<void>{const {ServiceSchemas}=await import('../../src/contracts.js');const schema=Reflect.get(ServiceSchemas,'resourceReceipt') as {safeParse(value:unknown):{success:boolean}};const receipt={formatVersion:3,installationId:'fixture-installation',installationDirectory:'/tmp/installation',resourceId:'a'.repeat(64),kind:'volume',serviceId:'fixture',name:'cordis-fixture-data',creatingGeneration:'b'.repeat(64),definitionDigest:'c'.repeat(64),references:['d'.repeat(64)],actualId:'volume-id',contentDigest:null,imageDigest:null,path:null,ownerUid:1000,legacy:null};expect(schema.safeParse(receipt).success).toBe(true);expect(schema.safeParse({...receipt,references:[]}).success).toBe(false);expect(schema.safeParse({...receipt,password:'credential-output-canary'}).success).toBe(false);}
}
class ServiceEnvelopeTestsIntegration {

 async envelope():Promise<void>{const {ServiceSchemas,PlatformSchemas}=await import('../../src/contracts.js');const schema=Reflect.get(ServiceSchemas,'envelope') as {safeParse(value:unknown):{success:boolean}};const status={formatVersion:3,installationId:'fixture',engine:'local',desiredComposition:null,activeComposition:null,ready:false,plugins:[],blockers:[],applicationId:null,services:[],resourceSetDigest:null,acknowledgements:[]};const envelope={command:'platform status',success:true,result:status,problem:null,blockers:[],references:[]};expect(schema.safeParse(envelope).success).toBe(true);expect(PlatformSchemas.envelope.safeParse(envelope).success).toBe(false);expect(schema.safeParse({...envelope,success:false,problem:{code:'IO_FAILURE',title:'Failure',detail:'Read-back failed.'}}).success).toBe(false);}
}
const suite=new ServiceJournalTestsIntegration();
const envelopes=new ServiceEnvelopeTestsIntegration();
test('integration: retained resource receipt has explicit ownership generation and scope',suite.resources.bind(suite));
test('integration: service envelope accepts new status without changing historical readers or false failures',envelopes.envelope.bind(envelopes));
