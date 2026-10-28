import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
class GuestRuntimeAcceptance {
  run(): void {
    const result = spawnSync('node', ['dist/tests/support/guest-runtime-program.js'], {
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, 'guest-runtime-ok\n');
  }
}
const suite = new GuestRuntimeAcceptance();
test(
  'acceptance: built portable guest payload contract binds exact standalone runtime identities',
  suite.run.bind(suite),
);
