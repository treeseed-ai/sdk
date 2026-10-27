import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {Schema,FixtureIdentity,ObservationTests} from '../support/observation-test-support.js';
class ObservationTestsIntegration extends ObservationTests {

    async scope(): Promise<void> {
        const { ServiceSchemas } = await import('../../src/contracts.js'), schema = Reflect.get(ServiceSchemas, 'observationContext') as Schema;
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
}
const suite=new ObservationTestsIntegration();
test('integration: accepted observation identities cannot cross installation generation or binding scope', suite.scope.bind(suite));
