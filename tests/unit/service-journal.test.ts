import {test,expect} from 'bun:test';
import {spawnSync} from 'node:child_process';
class ServiceJournalTestsUnit {

 async authority():Promise<void>{const {ServiceWorkerSchemas}=await import('../../src/service-journal.js');expect(ServiceWorkerSchemas.request.safeParse({protocol:3,operation:'status',principalId:'forged',grants:['admin']}).success).toBe(false);expect(ServiceWorkerSchemas.request.safeParse({protocol:3,operation:'plugin.install',request:{source:'fixture',idempotencyKey:'r',installationDirectory:'/tmp/installation',scope:'installation',configuration:{}}}).success).toBe(true);}
}
class RequestRecordTestsUnit {

 async intent():Promise<void>{const {ServiceWorkerSchemas}=await import('../../src/service-journal.js');const record={formatVersion:1,requestId:'request',installationId:'fixture',installationDirectory:'/tmp/installation',sequence:0,operation:'install',intent:{source:'fixture',idempotencyKey:'request',installationDirectory:'/tmp/installation',scope:'installation',configuration:{}},intentDigest:'a'.repeat(64),expectedGeneration:null,policyDigest:'b'.repeat(64),stage:'received',resolution:null,sourceReceipt:null,result:null};expect(ServiceWorkerSchemas.requestRecord.safeParse(record).success).toBe(true);expect(ServiceWorkerSchemas.requestRecord.safeParse({...record,requestId:'different'}).success).toBe(false);expect(ServiceWorkerSchemas.requestRecord.safeParse({...record,stage:'active'}).success).toBe(false);}
}
class ServiceEnvelopeTestsUnit {

 async failure():Promise<void>{const {ServiceWorkerSchemas}=await import('../../src/service-journal.js');expect(ServiceWorkerSchemas.response.safeParse({protocol:3,success:false,kind:'runtime',blockers:[{code:'IO_FAILURE',message:'Operation failed.'}]}).success).toBe(true);}
}
const suite=new ServiceJournalTestsUnit();
const requestRecords=new RequestRecordTestsUnit();
const envelopes=new ServiceEnvelopeTestsUnit();
test('unit: private worker protocol accepts typed local requests and rejects client authority',suite.authority.bind(suite));
test('unit: durable plugin request cannot change key or fabricate active completion',requestRecords.intent.bind(requestRecords));
test('unit: worker protocol distinguishes unexpected failures from blockers',envelopes.failure.bind(envelopes));
