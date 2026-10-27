import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
class ManagementTestsAcceptance {

    program(): void { const code = "import {PluginSource} from '@treeseed-cordis/sdk/portable';class Program{static run(){const source=PluginSource.parse('@fixture/plugin@^1.2.0');if(source.kind!=='npm'||source.name!=='@fixture/plugin'||source.selector!=='^1.2.0')throw new Error('wrong source');try{PluginSource.parse('https://user:credential-output-canary@github.com/owner/plugin.git');throw new Error('admitted credential');}catch(error){if(error.message!=='INVALID_PLUGIN_SOURCE')throw error;}process.stdout.write('source-contract-ok\\n');}}Program.run();"; const result = spawnSync('node', ['--input-type=module', '-e', code], { encoding: 'utf8' }); expect(result.status).toBe(0); expect(result.stderr).toBe(''); expect(result.stdout).toBe('source-contract-ok\n'); }
}
const suite=new ManagementTestsAcceptance();
test("acceptance: public source contract is safe executable portable data", suite.program.bind(suite));
