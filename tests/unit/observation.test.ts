import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {Schema,FixtureIdentity,ObservationTests} from '../support/observation-test-support.js';
class ObservationTestsUnit extends ObservationTests {

    async data(): Promise<void> {
        const { ServiceSchemas, ServiceWorkerSchemas } = await import('../../src/contracts.js'), schema = Reflect.get(ServiceSchemas, 'observationContext') as Schema;
        for (const endpoint of ['http://user:password@172.19.0.2:8080', 'http://172.19.0.2:8080/?token=secret', 'http://172.19.0.2:8080/#fragment', 'file:///etc/passwd', 'secret://worker/password']) { const value = this.fixture(); value.dependencies[0]!.endpoints.http = endpoint; expect(schema.safeParse(value).success).toBe(false); }
        const evidence = { formatVersion: 1, installationId: 'fixture', serviceId: 'worker-two', compositionGeneration: 'a'.repeat(64), serviceGeneration: 'b'.repeat(64), runtimeGeneration: 'c'.repeat(64), assetDigest: 'd'.repeat(64), ready: true, content: { packageSetDigest: 'e'.repeat(64), entryDigest: 'f'.repeat(64) } };
        expect(ServiceSchemas.runtimeEvidence.safeParse(evidence).success).toBe(true);
        expect(ServiceSchemas.runtimeEvidence.safeParse({ ...evidence, content: { ...evidence.content, imageManifestDigest: '0'.repeat(64) } }).success).toBe(false);
        expect(ServiceWorkerSchemas.request.safeParse({ protocol: 3, operation: 'observation.context', serviceId: 'gateway', installationDirectory: '/private' }).success).toBe(false);
        expect(ServiceWorkerSchemas.request.safeParse({ protocol: 3, operation: 'observation.context', serviceId: '../gateway' }).success).toBe(false);
    }
}
const suite=new ObservationTestsUnit();
test('unit: observation metadata and runtime content cannot carry credentials authority or image self-attestation', suite.data.bind(suite));
