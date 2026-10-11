import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { commit, release, review, proposal } from './golden-product-fixture.ts';

it('native public SDK proposal reads in isolated product verification reject changed stored identity title and summary and retain denied observations before unchanged retry', async () => {
	let mode = 'exact'; const calls: string[] = [], failed: Array<Record<string, unknown>> = [];
	const original = structuredClone({ release, review, proposal });
	const server = createServer((request, response) => {
		calls.push(`${request.method} ${request.url}`); response.setHeader('content-type', 'application/json');
		if (mode !== 'exact') failed.push({ mode });
		if (mode === 'interrupted') { request.socket.destroy(); return; }
		if (mode === 'denied' || mode === 'unavailable') {
			const status = mode === 'denied' ? 403 : 503;
			response.writeHead(status).end(JSON.stringify({ status, code: 'controlled-proposal-denial', title: 'Controlled denial' })); return;
		}
		if (mode === 'json') { response.end('{'); return; }
		const returned: Record<string, unknown> = { ...proposal };
		if (mode === 'title') returned.title = 'Changed objective'; if (mode === 'summary') returned.summary = 'Changed objective';
		if (mode === 'foreign-id') returned.id = 'foreign'; if (mode === 'foreign-project') returned.projectId = 'foreign';
		if (mode === 'missing-title') delete returned.title; if (mode === 'missing-summary') delete returned.summary;
		const value = mode === 'null' ? null : returned;
		if (mode !== 'exact') failed.at(-1)!.returned = structuredClone(value);
		response.end(JSON.stringify({ data: value }));
	});
	try {
		await new Promise<void>((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
		const address = server.address(); if (!address || typeof address === 'string') throw new Error('Native loopback address required');
		const require = createRequire(import.meta.url), sdk = require.resolve('@treeseed/sdk/control-plane-client'), operations = require.resolve('@treeseed/sdk/operator-contracts');
		const helper = new URL('../../../acceptance/golden-product.ts', import.meta.url).href;
		const code = `import{ControlPlaneClient,defaultLocalControlPlaneServer}from ${JSON.stringify(sdk)};
import{controlPlaneOperation}from ${JSON.stringify(operations)};
import{verifySdkGoldenProduct}from ${JSON.stringify(helper)};
const client=new ControlPlaneClient({profile:defaultLocalControlPlaneServer({TREESEED_API_BASE_URL:${JSON.stringify(`http://127.0.0.1:${address.port}`)}}),accessToken:'controlled-native-input'});
const observed=await client.invoke(controlPlaneOperation('governance.proposals.show'),{path:{projectId:'sdk-project',proposalId:'sdk-proposal'},query:{},body:undefined});
Reflect.apply(verifySdkGoldenProduct,undefined,[${JSON.stringify([release, review])},${JSON.stringify(commit)},observed.data]);process.stdout.write('verified');`;
		const observe = () => promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], {
			cwd: new URL('../../../../', import.meta.url), timeout: 5_000, maxBuffer: 131_072, killSignal: 'SIGKILL', env: process.env,
		});
		expect((await Promise.all([observe(), observe()])).map(value => value.stdout)).toEqual(['verified', 'verified']);
		for (const denied of ['title', 'summary', 'foreign-id', 'foreign-project', 'missing-title', 'missing-summary', 'null', 'denied', 'unavailable', 'interrupted', 'json']) {
			mode = denied; await expect.soft(observe(), denied).rejects.toThrow();
		}
		const retained = structuredClone(failed); mode = 'exact'; expect((await observe()).stdout).toBe('verified');
		expect(failed).toEqual(retained); expect(failed).toHaveLength(11);
		expect(calls).toEqual(Array(14).fill('GET /v1/projects/sdk-project/proposals/sdk-proposal'));
		expect({ release, review, proposal }).toEqual(original);
		// The owning SDK transport and isolated verifier are real. Upstream API
		// values are controlled; this is not a managed governance or golden receipt.
	} finally {
		server.closeAllConnections(); if (server.listening) await new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()));
	}
	expect(server.listening).toBe(false);
}, 15_000);
