import {test,expect} from 'bun:test';
import {spawnSync} from 'node:child_process';
class SourcePolicyTests {
    program():void{const result=spawnSync('node',['dist/tests/source-policy-contract-program.js'],{encoding:'utf8',timeout:30000});expect(result.status).toBe(0);expect(result.stderr).toBe('');expect(result.stdout).toBe('source-acquisition-policy-ok\n');}
}
const suite=new SourcePolicyTests();test('smoke: portable policy contracts bind source identity target helper and isolated build boundaries',suite.program.bind(suite));
