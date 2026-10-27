import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {SchemaProjection} from '../support/source-acquisition-policy-test-support.js';
class SourcePolicyProjectionTestsUnit {

    async projection(): Promise<void> {
        const { ContractProjection } = await import('../../src/contracts.js');
        const { ServiceSchemas, SourceAcquisitionSchemas } = await import('../../src/schemas.js');
        const contract = ContractProjection.generate() as {
            schemas: Record<string, SchemaProjection>;
        };
        const policySchema = contract.schemas.sourceAcquisitionPolicy!, planSchema = contract.schemas.servicePlan!, buildSchema = contract.schemas.sourceBuildPolicy!;
        expect(policySchema.additionalProperties).toBe(false);
        expect(planSchema.properties!.acquisitionPolicy!.additionalProperties).toBe(false);
        expect(planSchema.required).not.toContain('acquisitionPolicy');
        expect(buildSchema.properties!.network!.const).toBe('none');
        const image = new RegExp(buildSchema.properties!.image!.pattern!);
        expect(image.test('registry.invalid/build@sha256:' + 'a'.repeat(64))).toBe(true);
        expect(image.test('registry.invalid/build:latest@sha256:' + 'a'.repeat(64))).toBe(false);
        expect(ServiceSchemas.release.pick({ acquisitionPolicy: true }).parse({})).toEqual({});
        expect(ServiceSchemas.plan.shape.acquisitionPolicy.parse(undefined)).toBeUndefined();
        const policy = { formatVersion: 1, helperReleaseIdentity: 'a'.repeat(64), npm: [{ registry: 'https://registry.npmjs.org/', packages: ['@fixture/plugin'], targets: ['deployment'] }], git: [], builds: [] };
        expect(SourceAcquisitionSchemas.policy.safeParse({ ...policy, npm: [{ ...policy.npm[0], packages: Array(257).fill('@fixture/plugin') }] }).success).toBe(false);
        expect(SourceAcquisitionSchemas.policy.safeParse({ ...policy, npm: [{ ...policy.npm[0], certificateAuthority: { path: '../outside', sha256: 'b'.repeat(64) } }] }).success).toBe(false);
    }
}
const projection=new SourcePolicyProjectionTestsUnit();
test('unit: acquisition policy projection preserves absent fields bounds and executable image constraints', projection.projection.bind(projection));
