import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';

class SeedPublicProgram {
  run(): void {
    const result = spawnSync('node', ['dist/tests/support/seed-contract-program.js'], { encoding: 'utf8' });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('seed-contract-ok\n');
  }
}

const suite = new SeedPublicProgram();
test('acceptance: built portable seed contracts bind graphs artifacts and truthful resource completion', suite.run.bind(suite));
