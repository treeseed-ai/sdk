import {test,expect} from 'bun:test';
import {spawnSync} from 'node:child_process';
class RestartScopeTestsUnit {

    async projection():Promise<void>{const {ContractProjection}=await import('../../src/contracts.js'),contract=ContractProjection.generate() as {operations:Array<{id:string;input:{properties:Record<string,{uniqueItems?:boolean;minItems?:number;maxItems?:number}>}}>};let found;for(const operation of contract.operations)if(operation.id==='platform.apply')found=operation.input.properties.restartServices;expect(found?.uniqueItems).toBe(true);expect(found?.minItems).toBe(1);expect(found?.maxItems).toBe(256);}

    async record():Promise<void>{const {ServiceSchemas,InstalledSchemas,CanonicalJson}=await import('../../src/contracts.js'),old={formatVersion:3,id:'app-'+'b'.repeat(64),planId:'plan-'+'a'.repeat(64),digest:'a'.repeat(64),idempotencyKey:'scope',requestDigest:'b'.repeat(64),sequence:0,phase:'validate',desiredComposition:'c'.repeat(64),activeComposition:null,result:'accepted',recovery:null,historyReference:'.cordis/applications/app-'+'b'.repeat(64),expectedComposition:null,resourceSetDigest:null,acknowledgements:[]};expect(CanonicalJson.stringify(ServiceSchemas.applicationRecord.parse(old))).toBe(CanonicalJson.stringify(old));expect(ServiceSchemas.applicationRecord.parse({...old,restartServices:['api-main']}).restartServices).toEqual(['api-main']);expect(InstalledSchemas.applicationRecord.safeParse({...old,formatVersion:2,restartServices:['api-main']}).success).toBe(false);}
}
const restartScope=new RestartScopeTestsUnit();
test('unit: format3 records retain explicit restart intent without adding absent authorization',restartScope.record.bind(restartScope));
test('unit: emitted apply projection preserves restart set uniqueness and bounds',restartScope.projection.bind(restartScope));
