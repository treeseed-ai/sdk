import {test,expect} from 'bun:test';
import {spawnSync} from 'node:child_process';
class ServiceJournalTestsAcceptance {

 program():void{const code="import {ServiceWorkerSchemas,InstalledSchemas,PlatformOperations} from '@treeseed-cordis/sdk/portable';class Program{static run(){const input={protocol:3,operation:'status'};ServiceWorkerSchemas.request.parse(input);if(InstalledSchemas.request.safeParse(input).success)throw new Error('historical reader accepted new protocol');if(PlatformOperations.all.length!==7)throw new Error('operation count');process.stdout.write('worker3-contract-ok\\n');}}Program.run();";const result=spawnSync('node',['--input-type=module','-e',code],{encoding:'utf8'});expect(result.status).toBe(0);expect(result.stderr).toBe('');expect(result.stdout).toBe('worker3-contract-ok\n');}
}
const suite=new ServiceJournalTestsAcceptance();
test("acceptance: public worker3 protocol preserves historical reader rejection and seven operations",suite.program.bind(suite));
