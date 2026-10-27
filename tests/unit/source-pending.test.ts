import {test,expect} from 'bun:test';
import {spawnSync} from 'node:child_process';
class PendingProjectionTestsUnit {

    async projection():Promise<void>{const {ContractProjection}=await import('../../src/contracts.js');const contract=ContractProjection.generate() as {schemas:{pluginResult:{allOf:unknown}}};expect(contract.schemas.pluginResult.allOf).toEqual([{if:{properties:{state:{const:'pending'}},required:['state']},then:{oneOf:[{properties:{planId:{type:'null'},applicationId:{type:'null'},activeGeneration:{type:'null'},acknowledgements:{maxItems:0}}},{properties:{planId:{type:'string'},applicationId:{type:'string'}}}]}}]);}
}
const projection=new PendingProjectionTestsUnit();
test('unit: generated pending schema preserves complete application pairs and truthful pre-application progress',projection.projection.bind(projection));
