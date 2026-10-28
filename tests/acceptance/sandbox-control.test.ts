import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
class SandboxControlAcceptance {
  run(): void {
    const result = spawnSync('node', ['dist/tests/support/sandbox-control-program.js'], {
      encoding: 'utf8',
      timeout: 10000,
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('sandbox-control-ok\n');
  }
}
const suite = new SandboxControlAcceptance();
test(
  'acceptance: built portable sandbox control binds admitted private scope without host powers',
  suite.run.bind(suite),
);
