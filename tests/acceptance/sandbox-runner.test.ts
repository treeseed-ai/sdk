import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
class SandboxRunnerAcceptance {
  run(): void {
    const result = spawnSync('node', ['dist/tests/support/sandbox-runner-program.js'], {
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, 'sandbox-runner-ok\n');
  }
}
const suite = new SandboxRunnerAcceptance();
test(
  'acceptance: built portable host runner bridge preserves logical sandbox and actual guest identities',
  suite.run.bind(suite),
);
