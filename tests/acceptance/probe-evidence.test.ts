import {test,expect} from 'bun:test';
import {spawnSync} from 'node:child_process';
class ProbeEvidenceTestsAcceptance {

 program():void{const code="import {ServiceSchemas,PlatformOperations} from '@treeseed-cordis/sdk/portable';class Program{static run(){const value=ServiceSchemas.runtimeEvidence.parse({formatVersion:1,installationId:'fixture',serviceId:'api',compositionGeneration:'a'.repeat(64),serviceGeneration:'b'.repeat(64),runtimeGeneration:'c'.repeat(64),assetDigest:'d'.repeat(64),ready:true});if(value.runtimeGeneration===value.compositionGeneration||PlatformOperations.all.length!==7)throw new Error('evidence identity');process.stdout.write('probe-evidence-ok\\n');}}Program.run();";const result=spawnSync('node',['--input-type=module','-e',code],{encoding:'utf8'});expect(result.status).toBe(0);expect(result.stderr).toBe('');expect(result.stdout).toBe('probe-evidence-ok\n');}
}
const suite=new ProbeEvidenceTestsAcceptance();
test("acceptance: public portable program preserves separate target evidence and seven operations",suite.program.bind(suite));
