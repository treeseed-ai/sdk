import {test,expect} from 'bun:test';
import {spawnSync} from 'node:child_process';
class SourcePendingTests {
    program():void{const result=spawnSync('node',['dist/tests/source-pending-program.js'],{encoding:'utf8',timeout:30000});if(result.status!==0)throw new Error(result.stderr);expect(result.stdout).toBe('source-pending-ok\n');expect(result.stderr).toBe('');}
}
const suite=new SourcePendingTests();test('smoke: portable pending source progress has durable request identity without fabricated application or activation',suite.program.bind(suite));
class PendingProjectionTests {
    async projection():Promise<void>{const {ContractProjection}=await import('../src/contracts.js');const contract=ContractProjection.generate() as {schemas:{pluginResult:{allOf:unknown}}};expect(contract.schemas.pluginResult.allOf).toEqual([{if:{properties:{state:{const:'pending'}},required:['state']},then:{oneOf:[{properties:{planId:{type:'null'},applicationId:{type:'null'},activeGeneration:{type:'null'},acknowledgements:{maxItems:0}}},{properties:{planId:{type:'string'},applicationId:{type:'string'}}}]}}]);}
}
const projection=new PendingProjectionTests();test('unit: generated pending schema preserves complete application pairs and truthful pre-application progress',projection.projection.bind(projection));
