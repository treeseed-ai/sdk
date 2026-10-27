import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {PlanRuntimeTests} from '../support/plan-runtime-binding-test-support.js';
class PlanRuntimeTestsIntegration extends PlanRuntimeTests {

    async selected(): Promise<void> {
        const { ServiceSchemas } = await import('../../src/contracts.js'), value = this.fixture();
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
const suite=new PlanRuntimeTestsIntegration();
test('integration: runtime map admits selected manifests and preserves historical field absence', suite.selected.bind(suite));
