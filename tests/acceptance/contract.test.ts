import { test, expect } from 'bun:test';
import { z } from 'zod';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PlatformOperations, PlatformSchemas, ContractProjection, OperationDefinition, InstalledSchemas, InstalledDeclarations } from '../../src/contracts.js';
import { SourcePolicy } from '../../src/source-policy.js';
import {ContractTests} from '../support/contract-test-support.js';
class ContractTestsAcceptance extends ContractTests {

  installedProjection():void {
    const projection=ContractProjection.generate() as {contractVersion:string;schemas:Record<string,unknown>};
    expect(projection.contractVersion).toBe("0.7.0-cordis.1");
    for(const name of ["containerDefinition","installedPlan","installedRelease","service","workerRequest","applicationRecord","installationReceipt"])expect(projection.schemas[name]).toBeDefined();
    expect(PlatformOperations.all.length).toBe(7);
  }

  artifact(): void {
    const projection = JSON.parse(readFileSync('dist/contract.json','utf8'));
    expect(projection).toEqual(ContractProjection.generate());
    const script = "import {PlatformOperations} from './dist/src/contracts.js'; class Probe { static run(){ if(PlatformOperations.all.length!==7)process.exit(1); PlatformOperations.all[0].parseInput({}); } } Probe.run();";
    const result=spawnSync('node',['--input-type=module','-e',script],{encoding:'utf8'});
    expect(result.stderr).toBe(''); expect(result.status).toBe(0);
  }
}
const suite=new ContractTestsAcceptance();
test("acceptance: built portable Node artifact and schema projection",suite.artifact.bind(suite));
test("acceptance: installed contracts project versioned host boundary without adding operations",suite.installedProjection.bind(suite));
