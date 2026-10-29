import { test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
class CapacityChannelAcceptance {
  manager(): void {
    const result = spawnSync(
      'node',
      ['dist/tests/support/capacity-channel-program.js', '--manager'],
      { encoding: 'utf8', timeout: 10000 },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, 'capacity-manager-channel-ok\n');
  }
  run(): void {
    const result = spawnSync('node', ['dist/tests/support/capacity-channel-program.js'], {
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, 'capacity-channel-ok\n');
  }
}
const suite = new CapacityChannelAcceptance();
test(
  'acceptance: built portable capacity service channel binds worker and guest messages',
  suite.run.bind(suite),
);
test(
  'acceptance: built portable manager readiness retains actual role and process identity',
  suite.manager.bind(suite),
);
