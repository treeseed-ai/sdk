import { z } from 'zod';
import { PackageDefinition, ProviderV4Schemas } from '../../src/contracts.js';
import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {ConfigurationPredicates,AnnotatedConfigurationPlugin,RefinedConfigurationPlugin} from '../support/projection-test-support.js';
class ProjectionTestsAcceptance {

    program(): void { const code = "import {ServiceProjectionSchemas,SourceToolSchemas,PlatformOperations} from '@treeseed-cordis/sdk/portable';class Program{static run(){ServiceProjectionSchemas.secret.parse({$secret:{dependencyPort:'database',slot:'password'}});SourceToolSchemas.helper.parse({id:'bun',version:'1.4.4',platform:'linux-amd64',path:'helpers/bun.tgz',sha256:'a'.repeat(64),size:1,entry:'bin/bun',files:[{path:'bin/bun',sha256:'b'.repeat(64),mode:320}],libraryDirectories:[]});if(PlatformOperations.all.length!==7)throw new Error('operation count');process.stdout.write('projection-contract-ok\\n');}}Program.run();"; const result = spawnSync('node', ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 10000 }); expect(result.status).toBe(0); expect(result.stderr).toBe(''); expect(result.stdout).toBe('projection-contract-ok\n'); }
}
const suite=new ProjectionTestsAcceptance();
test("acceptance: public projection and prepared-helper contracts execute as a portable program", suite.program.bind(suite));
