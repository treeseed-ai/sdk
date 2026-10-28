import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';

class CapacityProtocolAcceptance {
  run(): void {
    const result = spawnSync('node', ['dist/tests/support/capacity-protocol-program.js'], {
      encoding: 'utf8',
      timeout: 10000,
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('capacity-protocol-ok\n');
  }
}
const suite = new CapacityProtocolAcceptance();
test(
  'acceptance: built portable reservation dispatch binds exact admitted worker and runner outcomes',
  suite.run.bind(suite),
);
