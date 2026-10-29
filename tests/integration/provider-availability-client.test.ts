import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { ProviderControlFixture } from '../support/provider-control-fixture.js';
import { AvailabilityWireResponder } from '../support/provider-availability-client-program.js';
class AvailabilityTransportBoundaries {
  async identity(mode: string): Promise<void> {
    const fixture = await ProviderControlFixture.open('wire', new AvailabilityWireResponder(mode));
    try {
      const result = await fixture.program(
        mode,
        'dist/tests/support/provider-availability-client-program.js',
      );
      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stderr, '');
      assert.equal(result.stdout, 'provider-availability-client-denied\n');
      fixture.verify();
    } finally {
      await fixture.close();
    }
  }
  async envelope(mode: string): Promise<void> {
    const fixture = await ProviderControlFixture.open(mode);
    try {
      const result = await fixture.program(
        mode,
        'dist/tests/support/provider-availability-client-program.js',
      );
      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stderr, '');
      assert.equal(result.stdout, 'provider-availability-client-denied\n');
    } finally {
      await fixture.close();
    }
  }
}
const suite = new AvailabilityTransportBoundaries();
for (const mode of [
  'foreign-team',
  'foreign-provider',
  'foreign-membership',
  'changed-runtime',
  'stale',
  'lost',
])
  test(
    'integration: real TLS availability rejects ' + mode + ' without retry or secret output',
    suite.identity.bind(suite, mode),
    20000,
  );
for (const mode of ['redirect', 'timeout', 'duplicate', 'malformed', 'oversize'])
  test(
    'integration: real TLS availability preserves bounded safe ' + mode + ' handling',
    suite.envelope.bind(suite, mode),
    20000,
  );
