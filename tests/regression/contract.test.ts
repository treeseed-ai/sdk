import { test, expect } from 'bun:test';
import assert from 'node:assert/strict';
import { writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
class ContractTestsRegression {
  freshBuild(): void {
    writeFileSync('dist/src/stale-removed.js', 'export class Removed {}');
    const result = spawnSync(process.execPath, ['scripts/tooling.ts', 'build'], {
      encoding: 'utf8',
      env: { ...process.env },
      timeout: 30000,
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message || 'Build failed');
    expect(existsSync('dist/src/stale-removed.js')).toBe(false);
  }
}
const suite = new ContractTestsRegression();
test(
  'regression: fresh build removes obsolete generated modules',
  suite.freshBuild.bind(suite),
  35000,
);
