import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
interface Schema { safeParse(value: unknown): { success: boolean }; }
interface FixtureIdentity { installationId: string; serviceId: string; compositionGeneration: string; serviceGeneration: string; assetDigest: string; origin: string; runtime: { packageSetDigest: string; entryDigest: string; imageManifestDigest: string } | null; }
class ObservationTests {
    fixture(): { formatVersion: number; identity: FixtureIdentity; dependencies: Array<{ port: string; bindingId: string; contractId: string; contractVersion: string; identity: FixtureIdentity; endpoints: Record<string, string> }> } {
        const identity = { installationId: 'fixture', serviceId: 'gateway', compositionGeneration: 'a'.repeat(64), serviceGeneration: 'b'.repeat(64), assetDigest: 'c'.repeat(64), origin: 'https://localhost:58443', runtime: null };
        return { formatVersion: 1, identity, dependencies: [{ port: 'backend', bindingId: 'backend.http', contractId: 'service.http', contractVersion: '1.0.0', identity: { ...identity, serviceId: 'worker-two', serviceGeneration: 'd'.repeat(64), runtime: { packageSetDigest: 'e'.repeat(64), entryDigest: 'f'.repeat(64), imageManifestDigest: '0'.repeat(64) } }, endpoints: { http: 'http://172.19.0.2:8080' } }] };
    }
    program(): void {
        const code = "import {ServiceSchemas,ServiceWorkerSchemas,InstalledSchemas,PlatformOperations} from '@treeseed-cordis/sdk/portable';class Program{static run(){const schema=Reflect.get(ServiceSchemas,'observationContext');if(!schema)throw new Error('accepted observation contract missing');const value=schema.parse(JSON.parse(process.argv[1]));ServiceWorkerSchemas.request.parse({protocol:3,operation:'observation.context',serviceId:value.identity.serviceId});ServiceWorkerSchemas.response.parse({protocol:3,success:true,result:value});if(InstalledSchemas.request.safeParse({protocol:3,operation:'observation.context',serviceId:value.identity.serviceId}).success||PlatformOperations.all.length!==7)throw new Error('historical boundary changed');process.stdout.write('observation-contract-ok\\n');}}Program.run();";
        const result = spawnSync('node', ['--input-type=module', '-e', code, JSON.stringify(this.fixture())], { encoding: 'utf8' });
        expect(result.status).toBe(0); expect(result.stderr).toBe(''); expect(result.stdout).toBe('observation-contract-ok\n');
    }
    async scope(): Promise<void> {
        const { ServiceSchemas } = await import('../src/contracts.js'), schema = Reflect.get(ServiceSchemas, 'observationContext') as Schema;
        expect(schema.safeParse(this.fixture()).success).toBe(true);
        for (const field of ['installationId', 'compositionGeneration', 'assetDigest', 'origin']) {
            const value = this.fixture(); Reflect.set(value.dependencies[0]!.identity, field, field === 'origin' ? 'https://localhost:58444' : '9'.repeat(64));
            expect(schema.safeParse(value).success).toBe(false);
        }
        const duplicate = this.fixture(); duplicate.dependencies.push(structuredClone(duplicate.dependencies[0]!)); expect(schema.safeParse(duplicate).success).toBe(false);
        const self = this.fixture(); self.dependencies[0]!.identity.serviceId = self.identity.serviceId; expect(schema.safeParse(self).success).toBe(false);
        expect(schema.safeParse({ ...this.fixture(), ready: true }).success).toBe(false);
        expect(schema.safeParse({ ...this.fixture(), credentials: { password: 'SECRET_CANARY' } }).success).toBe(false);
    }
    async data(): Promise<void> {
        const { ServiceSchemas, ServiceWorkerSchemas } = await import('../src/contracts.js'), schema = Reflect.get(ServiceSchemas, 'observationContext') as Schema;
        for (const endpoint of ['http://user:password@172.19.0.2:8080', 'http://172.19.0.2:8080/?token=secret', 'http://172.19.0.2:8080/#fragment', 'file:///etc/passwd', 'secret://worker/password']) { const value = this.fixture(); value.dependencies[0]!.endpoints.http = endpoint; expect(schema.safeParse(value).success).toBe(false); }
        const evidence = { formatVersion: 1, installationId: 'fixture', serviceId: 'worker-two', compositionGeneration: 'a'.repeat(64), serviceGeneration: 'b'.repeat(64), runtimeGeneration: 'c'.repeat(64), assetDigest: 'd'.repeat(64), ready: true, content: { packageSetDigest: 'e'.repeat(64), entryDigest: 'f'.repeat(64) } };
        expect(ServiceSchemas.runtimeEvidence.safeParse(evidence).success).toBe(true);
        expect(ServiceSchemas.runtimeEvidence.safeParse({ ...evidence, content: { ...evidence.content, imageManifestDigest: '0'.repeat(64) } }).success).toBe(false);
        expect(ServiceWorkerSchemas.request.safeParse({ protocol: 3, operation: 'observation.context', serviceId: 'gateway', installationDirectory: '/private' }).success).toBe(false);
        expect(ServiceWorkerSchemas.request.safeParse({ protocol: 3, operation: 'observation.context', serviceId: '../gateway' }).success).toBe(false);
    }
}
const suite = new ObservationTests();
test('smoke: portable accepted observation protocol preserves seven operations and historical boundaries', suite.program.bind(suite));
test('integration: accepted observation identities cannot cross installation generation or binding scope', suite.scope.bind(suite));
test('unit: observation metadata and runtime content cannot carry credentials authority or image self-attestation', suite.data.bind(suite));
