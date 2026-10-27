import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {PlanRuntimeTests} from '../support/plan-runtime-binding-test-support.js';
class PlanRuntimeTestsAcceptance extends PlanRuntimeTests {

    program(): void {
        const code = "import {ServiceSchemas,PlatformOperations} from '@treeseed-cordis/sdk/portable';class Program{static run(){const value=ServiceSchemas.plan.parse(JSON.parse(process.argv[1]));if(value.runtimeBindings.fixture.entryDigest!=='c'.repeat(64)||PlatformOperations.all.length!==7)throw new Error('runtime binding lost');process.stdout.write('plan-runtime-ok\\n');}}Program.run();";
        const child = spawnSync('node', ['--input-type=module', '-e', code, JSON.stringify(this.fixture())], { encoding: 'utf8' });
        expect(child.status).toBe(0); expect(child.stderr).toBe(''); expect(child.stdout).toBe('plan-runtime-ok\n');
    }
}
const suite=new PlanRuntimeTestsAcceptance();
test("acceptance: public portable plan retains exact runtime binding without new operations", suite.program.bind(suite));
