import { test, expect } from 'bun:test';
import { z } from 'zod';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PlatformOperations, PlatformSchemas, ContractProjection, OperationDefinition, InstalledSchemas, InstalledDeclarations } from '../../src/contracts.js';
import { SourcePolicy } from '../../src/source-policy.js';
import {ContractTests} from '../support/contract-test-support.js';
class ContractTestsRegression extends ContractTests {

  freshBuild():void {
    writeFileSync('dist/src/stale-removed.js','export class Removed {}');
    const result=spawnSync(process.execPath,['scripts/tooling.ts','build'],{encoding:'utf8',env:{...process.env}});
    expect(result.status).toBe(0);expect(existsSync('dist/src/stale-removed.js')).toBe(false);
  }
}
const suite=new ContractTestsRegression();
test("regression: fresh build removes obsolete generated modules",suite.freshBuild.bind(suite));
