import { z } from 'zod';
import { PackageDefinition, ProviderV4Schemas } from '../src/contracts.js';
import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
class ProjectionTests {
    program(): void { const code = "import {ServiceProjectionSchemas,SourceToolSchemas,PlatformOperations} from '@treeseed-cordis/sdk/portable';class Program{static run(){ServiceProjectionSchemas.secret.parse({$secret:{dependencyPort:'database',slot:'password'}});SourceToolSchemas.helper.parse({id:'bun',version:'1.4.4',platform:'linux-amd64',path:'helpers/bun.tgz',sha256:'a'.repeat(64),size:1,entry:'bin/bun',files:[{path:'bin/bun',sha256:'b'.repeat(64),mode:320}],libraryDirectories:[]});if(PlatformOperations.all.length!==7)throw new Error('operation count');process.stdout.write('projection-contract-ok\\n');}}Program.run();"; const result = spawnSync('node', ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 10000 }); expect(result.status).toBe(0); expect(result.stderr).toBe(''); expect(result.stdout).toBe('projection-contract-ok\n'); }
    async markers(): Promise<void> { const module = await import('../src/contracts.js') as unknown as {
        ServiceProjectionSchemas: {
            secret: {
                safeParse(value: unknown): {
                    success: boolean;
                };
            };
            endpoint: {
                safeParse(value: unknown): {
                    success: boolean;
                };
            };
            context: {
                safeParse(value: unknown): {
                    success: boolean;
                };
            };
        };
    }; const schema = module.ServiceProjectionSchemas; expect(schema.secret.safeParse({ $secret: { dependencyPort: 'database', slot: 'password' } }).success).toBe(true); expect(schema.secret.safeParse({ $secret: { slot: 'password' } }).success).toBe(true); expect(schema.secret.safeParse({ $secret: { serviceId: 'hard-coded', slot: 'password' } }).success).toBe(false); expect(schema.endpoint.safeParse({ $endpoint: { dependencyPort: 'database', portId: 'postgres', scheme: 'tcp', path: '/', part: 'authority' } }).success).toBe(true); expect(schema.context.safeParse({ $context: 'origin' }).success).toBe(true); expect(schema.context.safeParse({ $context: 'principal' }).success).toBe(false); }
    async helpers(): Promise<void> { const module = await import('../src/contracts.js') as unknown as {
        SourceToolSchemas: {
            helper: {
                safeParse(value: unknown): {
                    success: boolean;
                };
            };
        };
    }; const helper = { id: 'git', version: '2.53.0', platform: 'linux-amd64', path: 'helpers/git.tgz', sha256: 'a'.repeat(64), size: 1, entry: 'bin/git', files: [{ path: 'bin/git', sha256: 'b'.repeat(64), mode: 0o500 }], libraryDirectories: [] }; expect(module.SourceToolSchemas.helper.safeParse(helper).success).toBe(true); expect(module.SourceToolSchemas.helper.safeParse({ ...helper, url: 'https://fixture.invalid/git.tgz' }).success).toBe(false); expect(module.SourceToolSchemas.helper.safeParse({ ...helper, path: '../git.tgz' }).success).toBe(false); }
}
const suite = new ProjectionTests();
test('smoke: public projection and prepared-helper contracts execute as a portable program', suite.program.bind(suite));
test('unit: owner projection markers reference dependency ports and bounded context only', suite.markers.bind(suite));
test('unit: prepared helper has exactly one contained pinned archive source', suite.helpers.bind(suite));
class ConfigurationPredicates {
    static allowed(value: string): boolean { return value !== 'forbidden'; }
}
class AnnotatedConfigurationPlugin {
    static readonly provide = ['fixture.configuration'];
    static readonly inject: string[] = [];
    static readonly Config = z.strictObject({ value: z.string().meta({ type: 'number' }) });
    static readonly declaration = ProviderV4Schemas.declaration.parse({ id: 'fixture.configuration', pluginId: 'fixture', capability: 'fixture.configuration', target: 'deployment', contractVersion: ProviderV4Schemas.version, provide: this.provide, inject: this.inject });
    static readonly replacement = { kind: 'restart', stateVersion: 1, qualificationDigest: null };
}
class RefinedConfigurationPlugin {
    static readonly provide = AnnotatedConfigurationPlugin.provide;
    static readonly inject = AnnotatedConfigurationPlugin.inject;
    static readonly Config = z.strictObject({ value: z.string().refine(ConfigurationPredicates.allowed) });
    static readonly declaration = AnnotatedConfigurationPlugin.declaration;
    static readonly replacement = AnnotatedConfigurationPlugin.replacement;
}
class ConfigurationProjectionTests {
    annotation(): void { const descriptor = PackageDefinition.export(AnnotatedConfigurationPlugin, 'dist/plugin.js', 'AnnotatedConfigurationPlugin'), properties = descriptor.configurationSchema.properties as Record<string, {
        type: string;
    }>; expect(AnnotatedConfigurationPlugin.Config.safeParse({ value: 'text' }).success).toBe(true); expect(properties.value!.type).toBe('string'); }
    custom(): void { expect(RefinedConfigurationPlugin.Config.safeParse({ value: 'forbidden' }).success).toBe(false); expect(PackageDefinition.export.bind(PackageDefinition, RefinedConfigurationPlugin, 'dist/plugin.js', 'RefinedConfigurationPlugin')).toThrow(); }
}
const configuration = new ConfigurationProjectionTests();
test('unit: metadata annotations cannot replace a native configuration validation type', configuration.annotation.bind(configuration));
test('unit: custom native predicates cannot silently disappear from package configuration metadata', configuration.custom.bind(configuration));
class WorkerIdentityTests {
    async identity(): Promise<void> { const { ServiceSchemas } = await import('../src/contracts.js'), provider = { pluginId: 'fixture', providerId: 'fixture', target: 'deployment', package: { name: '@fixture/service', version: '1.0.0', sha256: 'a'.repeat(64) }, entry: 'plugin.js', classExport: 'Plugin', contractVersion: '0.4.0-cordis.1' }, service = { serviceId: 'fixture', provider, configuration: {}, definition: { imageId: 'fixture', user: 'image-default', environment: {}, ports: [{ id: 'http', target: 8080 }], volumes: [], secrets: [], workerSocket: true }, bindings: [{ port: 'http', bindingId: 'fixture', contractId: 'fixture', contractVersion: '1.0.0' }], dependencies: [], readiness: { provider, configuration: {}, endpoint: { serviceId: 'fixture', portId: 'http' }, deadlineMs: 1000, observationContract: 'fixture' }, resources: { volumes: [], slots: {} }, transitionPolicy: { kind: 'additive', stateVersion: 1 } }, graph = { profile: { id: 'fixture', version: '1.0.0', requiredBindings: ['fixture'], workerSocketServiceId: 'fixture' }, assetDigest: 'a'.repeat(64), worker: { path: 'worker', sha256: 'a'.repeat(64), size: 1 }, services: [service] }; expect(ServiceSchemas.graph.safeParse(graph).success).toBe(false); service.definition.user = 'installation-owner'; expect(ServiceSchemas.graph.safeParse(graph).success).toBe(true); }
}
const worker = new WorkerIdentityTests();
test('unit: a worker-socket consumer must use installation owner identity', worker.identity.bind(worker));
class SelectorTests {async selectors():Promise<void>{const {PluginSource}=await import('../src/contracts.js');expect(PluginSource.parse('fixture@>=1 <2')).toEqual({kind:'npm',name:'fixture',selector:'>=1 <2'});expect(PluginSource.parse.bind(PluginSource,'fixture@latest random')).toThrow('INVALID_PLUGIN_SOURCE');expect(PluginSource.parse.bind(PluginSource,'fixture@^~1')).toThrow('INVALID_PLUGIN_SOURCE');}}
const selectors=new SelectorTests();test('unit: locator grammar accepts real ranges and rejects malformed selectors before source actions',selectors.selectors.bind(selectors));
class ConfigurationMarkerTests {async marker():Promise<void>{const module=await import('../src/contracts.js') as unknown as {ServiceProjectionSchemas:{configuration:{safeParse(value:unknown):{success:boolean}};context:{safeParse(value:unknown):{success:boolean}}}};expect(module.ServiceProjectionSchemas.configuration.safeParse({$configuration:['prefix']}).success).toBe(true);expect(module.ServiceProjectionSchemas.configuration.safeParse({$configuration:['__proto__']}).success).toBe(false);expect(module.ServiceProjectionSchemas.context.safeParse({$context:'serviceId'}).success).toBe(true);}}
const markers=new ConfigurationMarkerTests();test('unit: owner templates select bounded configuration and current instance identity',markers.marker.bind(markers));
