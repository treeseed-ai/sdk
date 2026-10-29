import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { ProviderControlFixture } from '../support/provider-control-fixture.js';
import { AvailabilityWireResponder } from '../support/provider-availability-client-program.js';
class AvailabilityClientAcceptance {
  async wire(): Promise<void> {
    const fixture = await ProviderControlFixture.open('wire', new AvailabilityWireResponder());
    try {
      const result = await fixture.program(
        'wire',
        'dist/tests/support/provider-availability-client-program.js',
      );
      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stderr, '');
      assert.equal(result.stdout, 'provider-availability-client-ok\n');
      fixture.verify();
    } finally {
      await fixture.close();
    }
  }
  async denied(): Promise<void> {
    const fixture = await ProviderControlFixture.open('denied');
    try {
      const result = await fixture.program(
        'denied',
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
const suite = new AvailabilityClientAcceptance();
test(
  'acceptance: built default availability client preserves scoped POST PUT POST lifecycle over real TLS',
  suite.wire.bind(suite),
  20000,
);
test(
  'acceptance: built default availability client safely rejects denied membership without secret output',
  suite.denied.bind(suite),
  20000,
);
