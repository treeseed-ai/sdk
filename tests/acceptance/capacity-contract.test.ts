import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';

class CapacityPublicProgram {
  run(): void {
    const result = spawnSync('node', ['dist/tests/support/capacity-contract-program.js'], {
      encoding: 'utf8',
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('capacity-contract-ok\n');
  }
}

const suite = new CapacityPublicProgram();
test(
  'acceptance: built capacity contracts fence exact grants process generations leases and cleanup results',
  suite.run.bind(suite),
);
