import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {Schema,FixtureIdentity,ObservationTests} from '../support/observation-test-support.js';
class ObservationTestsAcceptance extends ObservationTests {

    program(): void {
        const code = "import {ServiceSchemas,ServiceWorkerSchemas,InstalledSchemas,PlatformOperations} from '@treeseed-cordis/sdk/portable';class Program{static run(){const schema=Reflect.get(ServiceSchemas,'observationContext');if(!schema)throw new Error('accepted observation contract missing');const value=schema.parse(JSON.parse(process.argv[1]));ServiceWorkerSchemas.request.parse({protocol:3,operation:'observation.context',serviceId:value.identity.serviceId});ServiceWorkerSchemas.response.parse({protocol:3,success:true,result:value});if(InstalledSchemas.request.safeParse({protocol:3,operation:'observation.context',serviceId:value.identity.serviceId}).success||PlatformOperations.all.length!==7)throw new Error('historical boundary changed');process.stdout.write('observation-contract-ok\\n');}}Program.run();";
        const result = spawnSync('node', ['--input-type=module', '-e', code, JSON.stringify(this.fixture())], { encoding: 'utf8' });
        expect(result.status).toBe(0); expect(result.stderr).toBe(''); expect(result.stdout).toBe('observation-contract-ok\n');
    }
}
const suite=new ObservationTestsAcceptance();
test("acceptance: portable accepted observation protocol preserves seven operations and historical boundaries", suite.program.bind(suite));
