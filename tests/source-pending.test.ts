import {test,expect} from 'bun:test';
import {spawnSync} from 'node:child_process';
class SourcePendingTests {
    program():void{const result=spawnSync('node',['dist/tests/source-pending-program.js'],{encoding:'utf8',timeout:30000});if(result.status!==0)throw new Error(result.stderr);expect(result.stdout).toBe('source-pending-ok\n');expect(result.stderr).toBe('');}
}
const suite=new SourcePendingTests();test('smoke: portable pending source progress has durable request identity without fabricated application or activation',suite.program.bind(suite));
