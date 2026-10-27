import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';

class PoolPublicProgram {
  run(): void {
    const result = spawnSync('node', ['dist/tests/support/pool-contract-program.js'], {
      encoding: 'utf8',
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('pool-contract-ok\n');
  }
}

const suite = new PoolPublicProgram();
test(
  'acceptance: portable warm-pool contracts require exact compatibility and virgin bases',
  suite.run.bind(suite),
);
