import { z } from 'zod';
import { PackageDefinition, ProviderV4Schemas } from '../../src/contracts.js';
import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {ConfigurationPredicates,AnnotatedConfigurationPlugin,RefinedConfigurationPlugin} from '../support/projection-test-support.js';
class ProjectionTestsUnit {

    async markers(): Promise<void> {
        const module = await import('../../src/contracts.js') as unknown as {
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
        };
        const schema = module.ServiceProjectionSchemas;
        expect(schema.secret.safeParse({ $secret: { dependencyPort: 'database', slot: 'password' } }).success).toBe(true);
        expect(schema.secret.safeParse({ $secret: { slot: 'password' } }).success).toBe(true);
        expect(schema.secret.safeParse({ $secret: { serviceId: 'hard-coded', slot: 'password' } }).success).toBe(false);
        expect(schema.endpoint.safeParse({ $endpoint: { dependencyPort: 'database', portId: 'postgres', scheme: 'tcp', path: '/', part: 'authority' } }).success).toBe(true);
        expect(schema.context.safeParse({ $context: 'origin' }).success).toBe(true);
        expect(schema.context.safeParse({ $context: 'principal' }).success).toBe(false);
    }

    async helpers(): Promise<void> {
        const module = await import('../../src/contracts.js') as unknown as {
            SourceToolSchemas: {
                helper: {
                    safeParse(value: unknown): {
                        success: boolean;
                    };
                };
            };
        };
        const helper = { id: 'git', version: '2.53.0', platform: 'linux-amd64', path: 'helpers/git.tgz', sha256: 'a'.repeat(64), size: 1, entry: 'bin/git', files: [{ path: 'bin/git', sha256: 'b'.repeat(64), mode: 0o500 }], libraryDirectories: [] };
        expect(module.SourceToolSchemas.helper.safeParse(helper).success).toBe(true);
        expect(module.SourceToolSchemas.helper.safeParse({ ...helper, url: 'https://fixture.invalid/git.tgz' }).success).toBe(false);
        expect(module.SourceToolSchemas.helper.safeParse({ ...helper, path: '../git.tgz' }).success).toBe(false);
    }
}
class ConfigurationProjectionTestsUnit {

    annotation(): void {
        const descriptor = PackageDefinition.export(AnnotatedConfigurationPlugin, 'dist/plugin.js', 'AnnotatedConfigurationPlugin'), properties = descriptor.configurationSchema.properties as Record<string, {
            type: string;
        }>;
        expect(AnnotatedConfigurationPlugin.Config.safeParse({ value: 'text' }).success).toBe(true);
        expect(properties.value!.type).toBe('string');
    }

    custom(): void { expect(RefinedConfigurationPlugin.Config.safeParse({ value: 'forbidden' }).success).toBe(false); expect(PackageDefinition.export.bind(PackageDefinition, RefinedConfigurationPlugin, 'dist/plugin.js', 'RefinedConfigurationPlugin')).toThrow(); }
}
class WorkerIdentityTestsUnit {

    async identity(): Promise<void> { const { ServiceSchemas } = await import('../../src/contracts.js'), provider = { pluginId: 'fixture', providerId: 'fixture', target: 'deployment', package: { name: '@fixture/service', version: '1.0.0', sha256: 'a'.repeat(64) }, entry: 'plugin.js', classExport: 'Plugin', contractVersion: '0.4.0-cordis.1' }, service = { serviceId: 'fixture', provider, configuration: {}, definition: { imageId: 'fixture', user: 'image-default', environment: {}, ports: [{ id: 'http', target: 8080 }], volumes: [], secrets: [], workerSocket: true }, bindings: [{ port: 'http', bindingId: 'fixture', contractId: 'fixture', contractVersion: '1.0.0' }], dependencies: [], readiness: { provider, configuration: {}, endpoint: { serviceId: 'fixture', portId: 'http' }, deadlineMs: 1000, observationContract: 'fixture' }, resources: { volumes: [], slots: {} }, transitionPolicy: { kind: 'additive', stateVersion: 1 } }, graph = { profile: { id: 'fixture', version: '1.0.0', requiredBindings: ['fixture'], workerSocketServiceId: 'fixture' }, assetDigest: 'a'.repeat(64), worker: { path: 'worker', sha256: 'a'.repeat(64), size: 1 }, services: [service] }; expect(ServiceSchemas.graph.safeParse(graph).success).toBe(false); service.definition.user = 'installation-owner'; expect(ServiceSchemas.graph.safeParse(graph).success).toBe(true); }
}
class SelectorTestsUnit {

    async selectors(): Promise<void> { const { PluginSource } = await import('../../src/contracts.js'); expect(PluginSource.parse('fixture@>=1 <2')).toEqual({ kind: 'npm', name: 'fixture', selector: '>=1 <2' }); expect(PluginSource.parse.bind(PluginSource, 'fixture@latest random')).toThrow('INVALID_PLUGIN_SOURCE'); expect(PluginSource.parse.bind(PluginSource, 'fixture@^~1')).toThrow('INVALID_PLUGIN_SOURCE'); }
}
class ConfigurationMarkerTestsUnit {

    async marker(): Promise<void> { const module = await import('../../src/contracts.js') as unknown as {
        ServiceProjectionSchemas: {
            configuration: {
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
    }; expect(module.ServiceProjectionSchemas.configuration.safeParse({ $configuration: ['prefix'] }).success).toBe(true); expect(module.ServiceProjectionSchemas.configuration.safeParse({ $configuration: ['__proto__'] }).success).toBe(false); expect(module.ServiceProjectionSchemas.context.safeParse({ $context: 'serviceId' }).success).toBe(true); }
}
const suite=new ProjectionTestsUnit();
const configuration=new ConfigurationProjectionTestsUnit();
const worker=new WorkerIdentityTestsUnit();
const selectors=new SelectorTestsUnit();
const markers=new ConfigurationMarkerTestsUnit();
test('unit: owner projection markers reference dependency ports and bounded context only', suite.markers.bind(suite));
test('unit: prepared helper has exactly one contained pinned archive source', suite.helpers.bind(suite));
test('unit: metadata annotations cannot replace a native configuration validation type', configuration.annotation.bind(configuration));
test('unit: custom native predicates cannot silently disappear from package configuration metadata', configuration.custom.bind(configuration));
test('unit: a worker-socket consumer must use installation owner identity', worker.identity.bind(worker));
test('unit: locator grammar accepts real ranges and rejects malformed selectors before source actions', selectors.selectors.bind(selectors));
test('unit: owner templates select bounded configuration and current instance identity', markers.marker.bind(markers));
