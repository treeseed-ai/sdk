import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { spawnSync } from 'node:child_process';
class SandboxProfileAcceptance {
  run(): void {
    const result = spawnSync('node', ['dist/tests/support/sandbox-profile-program.js'], {
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, 'sandbox-profile-contract-ok\n');
  }
}
const suite = new SandboxProfileAcceptance();
test(
  'acceptance: built portable sandbox profile binds canonical resource compatibility and generated wire schemas',
  suite.run.bind(suite),
);
