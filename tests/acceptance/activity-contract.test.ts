import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';

class ActivityPublicProgram {
  run(): void {
    const result = spawnSync('node', ['dist/tests/support/activity-contract-program.js'], {
      encoding: 'utf8',
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('activity-contract-ok\n');
  }
}

const suite = new ActivityPublicProgram();
test(
  'acceptance: built activity contracts admit external types and reject ambiguous or incompatible graphs',
  suite.run.bind(suite),
);
