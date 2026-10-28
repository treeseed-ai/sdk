import { expect, test } from 'bun:test';
import { ProviderControlFixture } from '../support/provider-control-fixture.js';

class ProviderControlBoundaryTests {
  async failures(): Promise<void> {
    for (const mode of [
      'duplicate',
      'oversize',
      'redirect',
      'malformed',
      'foreign-credential',
      'timeout',
    ]) {
      const fixture = await ProviderControlFixture.open(mode);
      try {
        const result = await fixture.program(mode);
        expect(result.code).toBe(0);
        expect(result.stderr).toBe('');
        expect(result.stdout).toBe('provider-control-fault-ok\n');
      } finally {
        await fixture.close();
      }
    }
  }
}
const suite = new ProviderControlBoundaryTests();
test(
  'integration: actual TLS provider transport refuses duplicate oversized malformed redirected stale and timed out responses',
  suite.failures.bind(suite),
  30000,
);
