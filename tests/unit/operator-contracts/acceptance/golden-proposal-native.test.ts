import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { commit, release, review, proposal, proposalReadback } from './golden-product-fixture.ts';

it('native public SDK proposal reads in isolated product verification reject changed stored identity title and summary and retain denied observations before unchanged retry', async () => {
	let mode = 'exact'; const calls: string[] = [], failed: Array<Record<string, unknown>> = [];
	const original = structuredClone({ release, review, proposal });
	const server = createServer((request, response) => {
		calls.push(`${request.method} ${request.url}`); response.setHeader('content-type', 'application/json');
		const governanceRead = request.url === '/v1/projects/sdk-project/proposals/sdk-proposal';
		if (mode !== 'exact' && governanceRead) failed.push({ mode });
		if (mode === 'interrupted') { request.socket.destroy(); return; }
		if (mode === 'denied' || mode === 'unavailable') {
			const status = mode === 'denied' ? 403 : 503;
			response.writeHead(status).end(JSON.stringify({ status, code: 'controlled-proposal-denial', title: 'Controlled denial' })); return;
		}
		if (mode === 'json') { response.end('{'); return; }
		const returned: Record<string, unknown> = { ...proposal };
		if (mode.startsWith('row-')) {
			const workItems = structuredClone(proposal.executionPlan.workItems), index = Number(mode.slice(4));
			Object.assign(workItems[index]!, { agentClass: 'reviewer', workspace: 'analysis', dependsOn: ['foreign-node'], maximumReviewCycles: 3 });
			returned.executionPlan = { workItems };
		}
		if (mode === 'missing-graph') delete returned.executionPlan;
		if (mode === 'duplicate-row') returned.executionPlan = { workItems: Array(6).fill(proposal.executionPlan.workItems[0]) };
		if (mode === 'generated-review') returned.executionPlan = { workItems: [...proposal.executionPlan.workItems, { id: 'generated-review', agentClass: 'reviewer' }] };
		if (mode === 'title') returned.title = 'Changed objective'; if (mode === 'summary') returned.summary = 'Changed objective';
		if (mode === 'foreign-id') returned.id = 'foreign'; if (mode === 'foreign-project') returned.projectId = 'foreign';
		if (mode === 'missing-title') delete returned.title; if (mode === 'missing-summary') delete returned.summary;
		const source = proposal.evidenceRefs[0]!;
		if (mode === 'missing-source') delete returned.evidenceRefs;
		if (mode === 'foreign-source') returned.evidenceRefs = [{ ...source, url: 'https://github.com/treeseed-ai/sdk/issues/300' }];
		if (mode === 'duplicate-source') returned.evidenceRefs = [source, { ...source, id: 'another-source' }];
		if (mode === 'malformed-source') returned.evidenceRefs = [null];
		if (mode === 'source-fragment') returned.evidenceRefs = [{ ...source, url: `${source.url}#issuecomment-1` }];
		if (mode === 'source-store') returned.evidenceRefs = [{ ...source, store: 'git' }];
		if (mode === 'source-model') returned.evidenceRefs = [{ ...source, model: 'note' }];
		if (mode === 'source-id') returned.evidenceRefs = [{ ...source, id: '' }];
		if (mode === 'source-unknown-property') returned.evidenceRefs = [{ ...source, callerAuthority: true }];
		const value = mode === 'null' ? null : returned;
		if (mode !== 'exact') failed.at(-1)!.returned = structuredClone(value);
		const observed = proposalReadback(value);
		if (mode === 'missing-provenance') Reflect.deleteProperty(observed.governance.metadata, 'contentProvenance');
		if (mode === 'foreign-binding') observed.original.binding.repositoryId = 'repo_foreign';
		if (mode === 'moved-content') observed.original.files.resolvedRef = 'd'.repeat(40);
		if (mode === 'foreign-path') observed.original.files.files[0]!.path = 'proposals/foreign.mdx';
		if (mode === 'changed-bytes') observed.original.files.files[0]!.content += 'changed';
		if (mode === 'contradictory-frontmatter') observed.original.files.files[0]!.frontmatter = {};
		if (mode === 'missing-file') observed.original.files.files = [];
		const responseValue = governanceRead ? (mode === 'null' ? null : observed.governance)
			: request.method === 'GET' ? observed.original.binding : observed.original.files;
		response.end(JSON.stringify({ data: responseValue }));
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
const provenance=observed.data.metadata.contentProvenance;
const binding=await client.invoke(controlPlaneOperation('treedx.library.show'),{path:{projectId:'sdk-project'},query:{},body:undefined});
const files=await client.invoke(controlPlaneOperation('treedx.repositories.files.read'),{path:{projectId:'sdk-project',repoId:provenance.repositoryId},query:{},body:{ref:provenance.commitSha,paths:[provenance.contentPath],encoding:'utf8',parseFrontmatter:true}});
Reflect.apply(verifySdkGoldenProduct,undefined,[${JSON.stringify([release, review])},${JSON.stringify(commit)},observed.data,{binding:binding.data,files:files.data}]);process.stdout.write('verified');`;
		const observe = () => promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], {
			cwd: new URL('../../../../', import.meta.url), timeout: 5_000, maxBuffer: 131_072, killSignal: 'SIGKILL', env: process.env,
		});
		expect((await Promise.all([observe(), observe()])).map(value => value.stdout)).toEqual(['verified', 'verified']);
		for (const denied of ['title', 'summary', 'foreign-id', 'foreign-project', 'missing-title', 'missing-summary',
			'row-0', 'row-1', 'row-2', 'row-3', 'row-4', 'row-5', 'missing-graph', 'duplicate-row', 'generated-review',
			'missing-provenance', 'foreign-binding', 'moved-content', 'foreign-path', 'changed-bytes', 'contradictory-frontmatter', 'missing-file',
			'missing-source', 'foreign-source', 'duplicate-source', 'malformed-source', 'source-fragment', 'source-store', 'source-model', 'source-id', 'source-unknown-property',
			'null', 'denied', 'unavailable', 'interrupted', 'json']) {
			mode = denied; await expect.soft(observe(), denied).rejects.toThrow();
		}
		const retained = structuredClone(failed); mode = 'exact'; expect((await observe()).stdout).toBe('verified');
		expect(failed).toEqual(retained); expect(failed).toHaveLength(36);
		expect(calls.filter(value => value === 'GET /v1/projects/sdk-project/proposals/sdk-proposal')).toHaveLength(39);
		expect(calls.filter(value => value === 'GET /v1/projects/sdk-project/treedx-library')).toHaveLength(34);
		expect(calls.filter(value => value === 'POST /v1/dx/projects/sdk-project/repos/repo_sdk_fixture/files/read')).toHaveLength(33);
		expect(calls).toHaveLength(106);
		expect({ release, review, proposal }).toEqual(original);
		// The owning SDK transport and isolated verifier are real. Upstream API
		// values are controlled; this is not a managed governance or golden receipt.
	} finally {
		server.closeAllConnections(); if (server.listening) await new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()));
	}
	expect(server.listening).toBe(false);
}, 15_000);
