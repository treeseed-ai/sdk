import {test,expect} from 'bun:test';
import {spawnSync} from 'node:child_process';
import {PackageDefinition,PluginManagementSchemas,ProviderV4Schemas,PlatformSchemas} from '../../src/contracts.js';
import {RuntimePlugin} from '../support/runtime-images-test-support.js';
class RuntimeImageTestsUnit {

 descriptor():void {const descriptor=PackageDefinition.define('@fixture/runtime','1.0.0','fixture',[PackageDefinition.export(RuntimePlugin,'dist/runtime.js','RuntimePlugin')]);const input={...descriptor,runtimeImages:[{id:'runtime',entry:'dist/server.js'}]};expect(PluginManagementSchemas.packageDescriptor.safeParse(input).success).toBe(true);expect(PluginManagementSchemas.packageDescriptor.safeParse({...input,runtimeImages:[...input.runtimeImages,...input.runtimeImages]}).success).toBe(false);expect(PluginManagementSchemas.packageDescriptor.safeParse({...input,runtimeImages:[{id:'runtime',entry:'../server.js'}]}).success).toBe(false);expect(PluginManagementSchemas.packageDescriptor.safeParse({...input,images:[{id:'runtime',reference:'fixture/runtime@sha256:'+'a'.repeat(64),manifestDigest:'a'.repeat(64),indexSha256:'b'.repeat(64),source:{kind:'oci-archive',url:'https://fixture.invalid/image.tgz',sha256:'c'.repeat(64),size:1}}]}).success).toBe(false);}
}
const suite=new RuntimeImageTestsUnit();
test('unit: runtime image associations exclude final hashes and conflict with neither external images nor other runtime IDs',suite.descriptor.bind(suite));
