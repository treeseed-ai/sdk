import { expect, test } from 'bun:test';
import { ProviderControlFixture } from '../support/provider-control-fixture.js';

class ProviderControlAcceptance {
  async wire(): Promise<void> {
    const fixture = await ProviderControlFixture.open();
    try {
      const result = await fixture.program('wire');
      expect(result.code).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toBe('provider-control-ok\n');
      fixture.verify();
    } finally { await fixture.close(); }
  }
  async denied(): Promise<void> {
    const fixture = await ProviderControlFixture.open('denied');
    try {
      const result = await fixture.program('denied');
      expect(result.code).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toBe('provider-control-denied\n');
      expect(result.stdout).not.toContain('SECRET_RESPONSE_CANARY');
    } finally { await fixture.close(); }
  }
}
const suite = new ProviderControlAcceptance();
test('acceptance: built default provider client preserves signed enrollment headers and exact identities over real TLS', suite.wire.bind(suite), 20000);
test('acceptance: built default provider client redacts a remote denial containing credentials and provider text', suite.denied.bind(suite), 20000);
