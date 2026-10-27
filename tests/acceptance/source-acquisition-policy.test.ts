import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {SchemaProjection} from '../support/source-acquisition-policy-test-support.js';
class SourcePolicyTestsAcceptance {

    program(): void { const result = spawnSync('node', ['dist/tests/support/source-policy-contract-program.js'], { encoding: 'utf8', timeout: 30000 }); if (result.status !== 0)
        throw new Error(result.stderr); expect(result.status).toBe(0); expect(result.stderr).toBe(''); expect(result.stdout).toBe('source-acquisition-policy-ok\n'); }
}
const suite=new SourcePolicyTestsAcceptance();
test("acceptance: portable policy contracts bind source identity target helper and isolated build boundaries", suite.program.bind(suite));
