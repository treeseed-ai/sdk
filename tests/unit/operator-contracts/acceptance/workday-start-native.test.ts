import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';
import { workdayStartFixture } from './workday-start-fixture.ts';

it('native SDK public read in an isolated product verifier uses the original API workday without proposal discovery or admission replay', async () => {
	const f = workdayStartFixture(), calls: Array<{ method?: string; path?: string }> = [];
	const server = createServer((request, response) => {
		calls.push({ method: request.method, path: request.url }); response.setHeader('content-type', 'application/json');
		response.end(JSON.stringify({ data: { run: f.run } }));
	});
	try {
		await new Promise<void>((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
		const address = server.address(); if (!address || typeof address === 'string') throw new Error('Native loopback address required');
		const require = createRequire(import.meta.url), sdk = require.resolve('@treeseed/sdk/control-plane-client'), operations = require.resolve('@treeseed/sdk/operator-contracts');
		const helper = new URL('../../../acceptance/golden-product.ts', import.meta.url).href;
		const code = `import assert from'node:assert/strict';
import{ControlPlaneClient,defaultLocalControlPlaneServer}from ${JSON.stringify(sdk)};
import{controlPlaneOperation}from ${JSON.stringify(operations)};
import{sdkGoldenWorkdayId}from ${JSON.stringify(helper)};
const client=new ControlPlaneClient({profile:defaultLocalControlPlaneServer({TREESEED_API_BASE_URL:${JSON.stringify(`http://127.0.0.1:${address.port}`)}}),accessToken:'controlled-native-input'});
const observed=await client.invoke(controlPlaneOperation('workdays.show'),{path:{teamId:'controlled-team',runId:${JSON.stringify(f.receipt.workdayId)}},query:{},body:undefined});
const id=Reflect.apply(sdkGoldenWorkdayId,undefined,[(args)=>{assert.deepEqual(args,['workdays','show',${JSON.stringify(f.receipt.workdayId)}]);return observed.data;},${JSON.stringify(f.freeze)},undefined,${JSON.stringify(f.path)}]);process.stdout.write(id);`;
		const native = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], {
			cwd: new URL('../../../../', import.meta.url), timeout: 5_000, maxBuffer: 131_072, killSignal: 'SIGKILL',
			env: { ...process.env, TREESEED_ACCEPTANCE_WORKDAY_ID: '' },
		});
		expect(native.stdout).toBe(f.receipt.workdayId);
		expect(calls).toEqual([{ method: 'GET', path: `/v1/teams/controlled-team/workday-runs/${f.receipt.workdayId}` }]);
		expect(readFileSync(f.path)).toEqual(f.bytes); expect(JSON.parse(readFileSync(f.retained, 'utf8'))).toEqual(f.receipt);
		// The native public client and process are real; API response authority is controlled.
	} finally {
		server.closeAllConnections(); if (server.listening) await new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()));
		f.close();
	}
	expect(server.listening).toBe(false); expect(existsSync(f.root)).toBe(false);
}, 15_000);
