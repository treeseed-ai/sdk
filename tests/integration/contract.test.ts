import { test, expect } from 'bun:test';
import { z } from 'zod';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PlatformOperations, PlatformSchemas, ContractProjection, OperationDefinition, InstalledSchemas, InstalledDeclarations } from '../../src/contracts.js';
import { SourcePolicy } from '../../src/source-policy.js';
import {ContractTests} from '../support/contract-test-support.js';
class ContractTestsIntegration extends ContractTests {

  schemaBoundary(): void {
    expect(PlatformOperations.all.map(ContractTests.id)).toEqual(['platform.describe','platform.status','platform.plan','platform.apply','platform.applications.get','platform.applications.events','platform.applications.cancel']);
    for(let index=0;index<7;index++) {
      const operation=PlatformOperations.all[index]!;
      expect<unknown>(operation.parseInput(this.inputs[index])).toEqual(this.inputs[index]);
      expect<unknown>(operation.parseOutput(this.outputs[index])).toEqual(this.outputs[index]);
      expect(operation.definition.input.safeParse({...this.inputs[index] as object,principal:'forged'}).success).toBe(false);
      expect(operation.definition.output.safeParse({...this.outputs[index] as object,extra:true}).success).toBe(false);
      expect(operation.definition.output.safeParse({}).success).toBe(false);
      expect(operation.definition.input.safeParse(null).success).toBe(false);
    }
  }
}
const suite=new ContractTestsIntegration();
test('integration: all seven strict public schema boundaries',suite.schemaBoundary.bind(suite));
