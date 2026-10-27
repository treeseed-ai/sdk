import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
class ManagementTestsUnit {

    async sources(): Promise<void> { const { PluginSource } = await import('../../src/management.js'); for (const source of ['package', 'package@latest', '@owner/plugin@1.2.3', 'package@>=1.0.0 <2.0.0', 'https://github.com/owner/plugin.git#branch'])
        expect(PluginSource.parse(source)).toBeDefined(); for (const source of ['--force', './local', 'git@github.com:owner/plugin.git', 'git+ssh://github.com/owner/plugin.git', 'name@npm:other', 'https://user:secret@github.com/owner/plugin.git', 'https://github.com/owner/plugin.git?token=secret', 'https://github.com/owner/plugin.git#--exec', 'name\n--script'])
        expect(PluginSource.parse.bind(null, source)).toThrow('INVALID_PLUGIN_SOURCE'); }
}
class ManagementEnvelopeTestsUnit {

    async target(): Promise<void> { const { InstalledProviderLoader } = await import('../../src/runtime.js'), { ProviderV4Schemas } = await import('../../src/schemas.js'); const cli = ProviderV4Schemas.declaration.parse({ id: 'fixture.provider', pluginId: 'fixture', capability: 'fixture.value', contractVersion: ProviderV4Schemas.version, target: 'cli', provide: ['fixture.value'], inject: [] }), deployment = { ...cli, target: 'deployment' }; expect(InstalledProviderLoader.declaration({ cordisProviders: [cli, deployment] }, cli.id, cli.capability, 'cli')).toEqual(cli); }
}
class PackageMetadataTestsUnit {

    async derived(): Promise<void> { const { z } = await import('zod'), { ProviderV4Schemas } = await import('../../src/schemas.js'), { PackageDefinition, PluginManagementSchemas } = await import('../../src/management.js'); class NativeFixture {
        static readonly provide = ['fixture.value'];
        static readonly inject: string[] = [];
        static readonly Config = z.strictObject({ label: z.string() });
        static readonly replacement = { kind: 'restart', stateVersion: 1, qualificationDigest: null };
        static readonly declaration = ProviderV4Schemas.declaration.parse({ id: 'fixture.provider', pluginId: 'fixture', capability: 'fixture.value', contractVersion: ProviderV4Schemas.version, target: 'cli', provide: this.provide, inject: this.inject });
    } const provider = PackageDefinition.export(NativeFixture, 'dist/plugin.js', 'NativeFixture'), descriptor = PackageDefinition.define('@fixture/plugin', '1.0.0', 'fixture', [provider]); expect(descriptor.providers[0]!.configurationSchema.additionalProperties).toBe(false); expect(PluginManagementSchemas.packageDescriptor.safeParse({ ...descriptor, providers: [provider, provider] }).success).toBe(false); expect(PackageDefinition.export.bind(null, { ...NativeFixture, provide: ['wrong.value'] }, 'dist/plugin.js', 'NativeFixture')).toThrow('PACKAGE_DECLARATION_DRIFT'); }
}
class InventoryBindingTestsUnit {

 async images():Promise<void>{const {PluginManagementSchemas}=await import('../../src/management.js');const image={id:'fixture',reference:'registry.invalid/fixture@sha256:'+'a'.repeat(64),source:{kind:'oci-archive',url:'https://artifacts.invalid/fixture.tar',sha256:'b'.repeat(64),size:1},indexSha256:'c'.repeat(64),manifestDigest:'a'.repeat(64)};expect(PluginManagementSchemas.image.safeParse(image).success).toBe(true);expect(PluginManagementSchemas.image.safeParse({...image,manifestDigest:'d'.repeat(64)}).success).toBe(false);}

 async helpers():Promise<void>{const {PluginManagementSchemas}=await import('../../src/management.js');const helper={id:'git',version:'1.2.3',platform:'linux-amd64',url:'https://tools.invalid/git.tar',sha256:'a'.repeat(64),size:1,entry:'bin/git',files:[{path:'bin/git',sha256:'b'.repeat(64),mode:0o500}],libraryDirectories:[]},inventory={formatVersion:1,releaseIdentity:'c'.repeat(64),helpers:[helper]};expect(PluginManagementSchemas.helperInventory.safeParse(inventory).success).toBe(true);expect(PluginManagementSchemas.helperInventory.safeParse({...inventory,helpers:[helper,helper]}).success).toBe(false);expect(PluginManagementSchemas.helper.safeParse({...helper,entry:'bin/absent'}).success).toBe(false);}
}
const suite=new ManagementTestsUnit();
const envelope=new ManagementEnvelopeTestsUnit();
const packageMetadata=new PackageMetadataTestsUnit();
const inventoryBindings=new InventoryBindingTestsUnit();
test('unit: bounded package and HTTPS Git grammar rejects unsafe source forms', suite.sources.bind(suite));
test('unit: loader disambiguates native exports by explicit target', envelope.target.bind(envelope));
test('unit: package export metadata derives from native class fields and configuration', packageMetadata.derived.bind(packageMetadata));
test('unit: plugin image selection edge is digest bound',inventoryBindings.images.bind(inventoryBindings));
test('unit: managed helper inventory has unique complete executable identities',inventoryBindings.helpers.bind(inventoryBindings));
