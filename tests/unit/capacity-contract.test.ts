import { test, expect } from 'bun:test';
import * as sdk from '../../src/contracts.js';
import { CapacityFixtures as Fixture } from '../support/capacity-contract-program.js';

interface Binding {
  assertLease(input: unknown, trusted: unknown, now: number): unknown;
}
interface Schemas {
  result: { safeParse(value: unknown): { success: boolean } };
  lease: { safeParse(value: unknown): { success: boolean } };
}
class CapacityContractTests {
  private readonly binding = Reflect.get(sdk, 'CapacityContractBinding') as Binding;
  private readonly schemas = Reflect.get(sdk, 'CapacitySchemas') as Schemas;

  private rejected(trusted: unknown, now = 2000): void {
    expect(this.binding.assertLease.bind(null, Fixture.lease, trusted, now)).toThrow(/CAPACITY_/);
  }

  identity(): void {
    for (const field of ['issuer', 'subject', 'teamId', 'providerId', 'credentialId', 'grantId']) {
      const value = field === 'issuer' ? 'https://other.example.invalid/realms/test' : 'other.identity';
      this.rejected({ ...Fixture.expectation, authority: { ...Fixture.authority, [field]: value } });
    }
    for (const field of ['credentialRevision', 'grantRevision'])
      this.rejected({ ...Fixture.expectation, authority: { ...Fixture.authority, [field]: 2 } });
  }

  expiry(): void {
    for (const now of [4000, 5000, NaN, Infinity, -1]) this.rejected(Fixture.expectation, now);
    this.rejected({ ...Fixture.expectation, authority: { ...Fixture.authority, capabilities: [] } });
    this.rejected({ ...Fixture.expectation, authority: { ...Fixture.authority, state: 'revoked' } });
    this.rejected({ ...Fixture.expectation, authority: { ...Fixture.authority, expiresAtEpochMs: 2000 } });
  }

  malformed(): void {
    for (const change of [
      { operation: 'execute-model' },
      { workId: 'forbidden' },
      { credential: 'secret-output-canary' },
      { fence: 0 },
      { expiresAtEpochMs: 5001 },
      { authority: { ...Fixture.authority, issuer: 'http://insecure.example.invalid' } },
    ]) expect(this.schemas.lease.safeParse({ ...Fixture.lease, ...change }).success).toBe(false);
  }

  cleanup(): void {
    for (const change of [
      { state: 'cancelled' },
      { state: 'blocked', output: null },
      { cleanup: { ...Fixture.result.cleanup, providerGeneration: 'b'.repeat(64) } },
      { blockers: [{ code: 'CAPACITY_HANDLER_FAILED', message: 'secret-output-canary' }] },
    ]) expect(this.schemas.result.safeParse({ ...Fixture.result, ...change }).success).toBe(false);
  }

  safeError(): void {
    try {
      this.binding.assertLease({ credential: 'secret-output-canary' }, Fixture.expectation, 2000);
      throw new Error('unexpected acceptance');
    } catch (error) {
      expect((error as Error).message).toBe('INVALID_CAPACITY_CONTRACT');
      expect(JSON.stringify(error)).not.toContain('secret-output-canary');
    }
  }
}
const suite = new CapacityContractTests();
test('unit: capacity admission retains every exact principal and credential identity', suite.identity.bind(suite));
test('unit: capacity admission denies expiry revoked grants and invalid trusted clocks', suite.expiry.bind(suite));
test('unit: capacity probe lease rejects productive and credential-bearing forms', suite.malformed.bind(suite));
test('unit: capacity result cannot replace cleanup evidence or report contradictory success', suite.cleanup.bind(suite));
test('unit: capacity admission failure exposes only a fixed safe code', suite.safeError.bind(suite));
