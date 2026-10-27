import {test,expect} from 'bun:test';
import {spawnSync} from 'node:child_process';
import {PackageDefinition,PluginManagementSchemas,ProviderV4Schemas,PlatformSchemas} from '../../src/contracts.js';
import {RuntimePlugin} from '../support/runtime-images-test-support.js';
class RuntimeImageTestsAcceptance {

 program():void{const program="import {PackageDefinition,ProviderV4Schemas,PlatformSchemas} from '@treeseed-cordis/sdk/portable';class Plugin{static provide=['fixture.runtime'];static inject=[];static Config=PlatformSchemas.empty;static replacement={kind:'restart',stateVersion:1,qualificationDigest:null};static declaration=ProviderV4Schemas.declaration.parse({id:'fixture.runtime',pluginId:'fixture',capability:'fixture.runtime',target:'deployment',contractVersion:ProviderV4Schemas.version,provide:this.provide,inject:this.inject});}class Program{static run(){const descriptor=PackageDefinition.define('@fixture/runtime','1.0.0','fixture',[PackageDefinition.export(Plugin,'dist/plugin.js','Plugin')],[],[],[{id:'runtime',entry:'dist/server.js'}]);if(descriptor.runtimeImages?.[0]?.entry!=='dist/server.js')throw new Error('association lost');process.stdout.write('acyclic-image-contract-ok\\n');}}Program.run();";const result=spawnSync('node',['--input-type=module','-e',program],{encoding:'utf8'});expect(result.status).toBe(0);expect(result.stderr).toBe('');expect(result.stdout).toBe('acyclic-image-contract-ok\n');}
}
const suite=new RuntimeImageTestsAcceptance();
test("acceptance: built public package declaration retains a runtime entry without an image hash cycle",suite.program.bind(suite));
