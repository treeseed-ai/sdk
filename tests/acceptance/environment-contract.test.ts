import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';

class EnvironmentPublicProgram {
  run(): void {
    const result = spawnSync('node', ['dist/tests/support/environment-contract-program.js'], { encoding: 'utf8' });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('environment-contract-ok\n');
  }
}

const suite = new EnvironmentPublicProgram();
test('acceptance: built environment contracts bind exact guest setup and offline by default network grants', suite.run.bind(suite));
