import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';
import { workdayStartFixture } from './workday-start-fixture.ts';

it('native SDK public read in an isolated product verifier uses the original API workday without proposal discovery or admission replay', async () => {
	const f = workdayStartFixture(), calls: Array<{ method?: string; path?: string }> = [];
	let mode = 'exact'; const failures: unknown[] = [];
	const server = createServer((request, response) => {
		calls.push({ method: request.method, path: request.url }); response.setHeader('content-type', 'application/json');
		if (mode === 'denied') { failures.push({ mode, status: 403 }); response.writeHead(403).end(JSON.stringify({ status: 403, code: 'controlled-read-denied', title: 'Controlled denial' })); return; }
		if (mode === 'interrupted') { failures.push({ mode }); request.socket.destroy(); return; }
		const run = structuredClone(f.run);
		if (mode === 'foreign-team') run.teamId = 'foreign'; if (mode === 'foreign-workday') run.id = 'workday-22222222-2222-4222-8222-222222222222';
		if (mode === 'changed-clock') run.startedAt = '2026-10-10T20:00:01.000Z';
		if (mode !== 'exact') failures.push({ mode, run: structuredClone(run) });
		response.end(JSON.stringify({ data: { run } }));
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
		const observe = () => promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], {
			cwd: new URL('../../../../', import.meta.url), timeout: 5_000, maxBuffer: 131_072, killSignal: 'SIGKILL',
			env: { ...process.env, TREESEED_ACCEPTANCE_WORKDAY_ID: '' },
		});
		const held = readFileSync(f.retained);
		expect((await observe()).stdout).toBe(f.receipt.workdayId);
		for (const denied of ['foreign-team', 'foreign-workday', 'changed-clock', 'denied', 'interrupted']) {
			mode = denied; await expect(observe(), denied).rejects.toThrow(); expect(readFileSync(f.retained)).toEqual(held);
		}
		const original = structuredClone(failures); mode = 'exact';
		const resumed = await Promise.all([observe(), observe()]); expect(resumed.map(value => value.stdout)).toEqual([f.receipt.workdayId, f.receipt.workdayId]);
		expect(failures).toEqual(original); expect(failures).toHaveLength(5);
		expect(calls).toEqual(Array.from({ length: 8 }, () => ({ method: 'GET', path: `/v1/teams/controlled-team/workday-runs/${f.receipt.workdayId}` })));
		expect(readFileSync(f.path)).toEqual(f.bytes); expect(JSON.parse(readFileSync(f.retained, 'utf8'))).toEqual(f.receipt);
		// The native public client and process are real; API response authority is controlled.
	} finally {
		server.closeAllConnections(); if (server.listening) await new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()));
		f.close();
	}
	expect(server.listening).toBe(false); expect(existsSync(f.root)).toBe(false);
}, 15_000);
