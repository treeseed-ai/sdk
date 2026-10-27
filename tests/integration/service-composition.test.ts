import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {ServiceCompositionTests} from '../support/service-composition-test-support.js';
class ServiceCompositionTestsIntegration extends ServiceCompositionTests {

  browserClosure():void {const code=readFileSync('dist/src/composition.js','utf8');expect(code).not.toContain('node:');expect(code).not.toContain('./contracts.js');}
}
const suite=new ServiceCompositionTestsIntegration();
test('integration: Portable service composition has no Node entry import',suite.browserClosure.bind(suite));
