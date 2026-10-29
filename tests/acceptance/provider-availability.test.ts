import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'bun:test';
class ProviderAvailabilityAcceptance {
  run(): void {
    const result = spawnSync('node', ['dist/tests/support/provider-availability-program.js'], {
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, 'provider-availability-contract-ok\n');
  }
}
const suite = new ProviderAvailabilityAcceptance();
test(
  'acceptance: built public provider availability contracts preserve existing wire data and projections',
  suite.run.bind(suite),
);
