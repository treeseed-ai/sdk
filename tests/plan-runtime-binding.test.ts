import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
class PlanRuntimeTests {
    fixture(): Record<string, unknown> {
        const hash = 'a'.repeat(64), manifest = 'b'.repeat(64), provider = { pluginId: 'fixture', providerId: 'fixture', target: 'deployment', package: { name: '@fixture/service', version: '1.0.0', sha256: hash }, entry: 'index.js', classExport: 'FixturePlugin', contractVersion: '0.4.0-cordis.1' };
        const service = { serviceId: 'fixture', provider, configuration: {}, definition: { imageId: 'fixture', command: ['serve'], environment: {}, ports: [{ id: 'http', target: 8080 }], volumes: [], secrets: [], workerSocket: false }, bindings: [{ port: 'http', bindingId: 'fixture', contractId: 'fixture.http', contractVersion: '1.0.0' }], dependencies: [], readiness: { provider, scheme: 'http', configuration: {}, endpoint: { serviceId: 'fixture', portId: 'http' }, deadlineMs: 5000, observationContract: 'fixture.http', credentialReferences: [] }, resources: { volumes: [], slots: {}, grants: [], authorities: [] }, transitionPolicy: { kind: 'additive', stateVersion: 1 } };
        return { formatVersion: 3, id: 'plan-' + hash, digest: hash, configuration: { installationId: 'fixture', engineContext: 'default', installationDirectory: '/tmp/installation', origin: 'https://localhost:58443', runtimeState: 'running', plugins: [{ id: 'fixture', package: '@fixture/service', version: '1.0.0', integrity: hash }], credentialReferences: [], release: { directory: '/tmp/release', manifestDigest: hash } }, recipe: { services: { fixture: { image: 'fixture/service@sha256:' + manifest } }, volumes: {}, secrets: {} }, composition: { profile: { id: 'fixture', version: '1.0.0', requiredBindings: ['fixture'] }, assetDigest: hash, worker: { path: 'worker', sha256: hash, size: 1 }, services: [service] }, pluginBindings: [], configurationDigest: hash, releaseDigest: hash, recipeDigest: hash, lockDigest: hash, expectedEngine: { context: 'default', endpoint: 'unix:///var/run/docker.sock', daemonId: 'fixture', os: 'linux', architecture: 'amd64' }, expectedComposition: null, expectedResourceSet: null, projectName: 'cordis-0123456789abcdef', artifacts: [{ kind: 'image', reference: 'fixture/service@sha256:' + manifest, manifestDigest: manifest, configDigest: hash, layerDigests: [] }], effects: [], blockers: [], compositionGeneration: hash, retainedResources: [], changes: [], runtimeBindings: { fixture: { imageManifestDigest: manifest, packageSetDigest: hash, entryDigest: 'c'.repeat(64) } } };
    }
    program(): void {
        const code = "import {ServiceSchemas,PlatformOperations} from '@treeseed-cordis/sdk/portable';class Program{static run(){const value=ServiceSchemas.plan.parse(JSON.parse(process.argv[1]));if(value.runtimeBindings.fixture.entryDigest!=='c'.repeat(64)||PlatformOperations.all.length!==7)throw new Error('runtime binding lost');process.stdout.write('plan-runtime-ok\\n');}}Program.run();";
        const child = spawnSync('node', ['--input-type=module', '-e', code, JSON.stringify(this.fixture())], { encoding: 'utf8' });
        expect(child.status).toBe(0); expect(child.stderr).toBe(''); expect(child.stdout).toBe('plan-runtime-ok\n');
    }
    async selected(): Promise<void> {
        const { ServiceSchemas } = await import('../src/contracts.js'), value = this.fixture();
        expect(ServiceSchemas.plan.safeParse(value).success).toBe(true);
        const runtime = (value.runtimeBindings as Record<string, object>).fixture!;
        expect(ServiceSchemas.plan.safeParse({ ...value, runtimeBindings: { missing: runtime } }).success).toBe(false);
        expect(ServiceSchemas.plan.safeParse({ ...value, runtimeBindings: { fixture: { ...runtime, imageManifestDigest: 'd'.repeat(64) } } }).success).toBe(false);
        expect(ServiceSchemas.plan.safeParse({ ...value, runtimeBindings: { fixture: { ...runtime, entryDigest: 'unverified' } } }).success).toBe(false);
        expect(ServiceSchemas.plan.safeParse({ ...value, artifacts: [] }).success).toBe(false);
        delete value.runtimeBindings;
        const historical = ServiceSchemas.plan.parse(value);
        expect(Object.hasOwn(historical, 'runtimeBindings')).toBe(false);
    }
}
const suite = new PlanRuntimeTests();
test('smoke: public portable plan retains exact runtime binding without new operations', suite.program.bind(suite));
test('integration: runtime map admits selected manifests and preserves historical field absence', suite.selected.bind(suite));
