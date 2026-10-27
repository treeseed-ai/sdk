import { test, expect } from 'bun:test';
import * as sdk from '@treeseed-cordis/sdk';
import { SeedFixtures } from '../support/seed-contract-program.js';

interface SeedBindings {
  assertPlan(input: unknown, binding: unknown, digest: string): unknown;
  assertResource(plan: unknown, input: unknown): unknown;
  assertReceipt(input: unknown, plan: unknown): unknown;
}

class SeedBindingTests {
  private readonly binding = Reflect.get(sdk, 'SeedContractBinding') as SeedBindings;

  matching(): void {
    expect(this.binding.assertPlan(SeedFixtures.plan, SeedFixtures.binding, SeedFixtures.digest))
      .toEqual(SeedFixtures.plan);
    expect(this.binding.assertResource(SeedFixtures.resourcePlan, SeedFixtures.resourceReceipt))
      .toEqual(SeedFixtures.resourceReceipt);
    expect(this.binding.assertReceipt(SeedFixtures.receipt, SeedFixtures.plan)).toEqual(SeedFixtures.receipt);
  }

  scope(): void {
    const other = { ...SeedFixtures.binding, principalId: 'subject:other' };
    expect(this.binding.assertPlan.bind(null, SeedFixtures.plan, other, SeedFixtures.digest))
      .toThrow('SEED_BINDING_MISMATCH');
    expect(this.binding.assertPlan.bind(null, SeedFixtures.plan, SeedFixtures.binding, 'b'.repeat(64)))
      .toThrow('SEED_BINDING_MISMATCH');
  }

  safeFailure(): void {
    expect(this.binding.assertPlan.bind(null, { password: 'secret-canary' }, {}, SeedFixtures.digest))
      .toThrow('INVALID_SEED_CONTRACT');
  }

  receipt(): void {
    const other = { ...SeedFixtures.resourceReceipt, key: 'resource:other' };
    expect(this.binding.assertResource.bind(null, SeedFixtures.resourcePlan, other))
      .toThrow('SEED_RESOURCE_MISMATCH');
    const receipt = { ...SeedFixtures.receipt, binding: { ...SeedFixtures.binding, grantRevision: 2 } };
    expect(this.binding.assertReceipt.bind(null, receipt, SeedFixtures.plan)).toThrow('SEED_BINDING_MISMATCH');
  }
}

const suite = new SeedBindingTests();
test('unit: seed binding accepts exact plan and owner resource receipts', suite.matching.bind(suite));
test('unit: seed binding rejects principal and seed digest substitution', suite.scope.bind(suite));
test('unit: malformed seed bindings produce fixed safe errors', suite.safeFailure.bind(suite));
test('unit: owner resource and aggregate receipt substitutions fail binding', suite.receipt.bind(suite));
