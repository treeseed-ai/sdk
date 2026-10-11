import { createServer } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { commit, release, review, proposal, proposalReadback } from './golden-product-fixture.ts';
import { workdayStartFixture } from './workday-start-fixture.ts';

it('native public SDK proposal reads in isolated product verification reject changed stored identity title and summary and retain denied observations before unchanged retry', async () => {
	let mode = 'exact'; const calls: string[] = [], failed: Array<Record<string, unknown>> = [];
	const original = structuredClone({ release, review, proposal });
	const retainedInput = workdayStartFixture(), inputPath = resolve(retainedInput.root, 'proposal-input.json');
	const inputBytes = JSON.stringify({ ...proposal, status: 'draft' }); writeFileSync(inputPath, inputBytes);
	const freeze = { proposal: { id: proposal.id }, request: { body: { projects: [proposal.projectId] } },
		receipts: { [inputPath]: `sha256:${createHash('sha256').update(inputBytes).digest('hex')}` } };
	let worker: ChildProcess | undefined, sequence = 0, stderrBytes = 0;
	const pending = new Map<number, { resolve: (value: { stdout: string }) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
	const fail = (error: Error) => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); } pending.clear(); };
	const server = createServer((request, response) => {
		calls.push(`${request.method} ${request.url}`); response.setHeader('content-type', 'application/json');
		const governanceRead = request.url === '/v1/projects/sdk-project/proposals/sdk-proposal';
		if (mode !== 'exact' && mode !== 'budget-boundary' && governanceRead) failed.push({ mode });
		if (mode === 'interrupted') { request.socket.destroy(); return; }
		if (mode === 'denied' || mode === 'unavailable') {
			const status = mode === 'denied' ? 403 : 503;
			response.writeHead(status).end(JSON.stringify({ status, code: 'controlled-proposal-denial', title: 'Controlled denial' })); return;
		}
		if (mode === 'json') { response.end('{'); return; }
		const returned: Record<string, unknown> = { ...proposal };
		if (mode === 'frozen-request') returned.request = 'Publish the legacy capacity plan and deploy it upstream.';
		if (mode.startsWith('explicit-')) {
			const workItems = structuredClone(proposal.executionPlan.workItems);
			Reflect.deleteProperty(workItems[0]!, mode.slice(9)); returned.executionPlan = { workItems };
		}
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
		if (mode !== 'exact' && mode !== 'budget-boundary') failed.at(-1)!.returned = structuredClone(value);
		const observed = proposalReadback(value, mode === 'budget-boundary' ? 1_048_576 : mode === 'budget-over' ? 1_048_577 : undefined,
			mode === 'alias' ? 'alias' : mode === 'anchor');
		if (mode === 'missing-provenance') Reflect.deleteProperty(observed.governance.metadata, 'contentProvenance');
		if (mode === 'foreign-binding') observed.original.binding.repositoryId = 'repo_foreign';
		if (mode === 'moved-content') {
			observed.original.files.resolvedRef = 'd'.repeat(40);
			observed.governance.metadata.contentProvenance.commitSha = observed.original.files.resolvedRef;
		}
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
import{verifySdkGoldenProduct,sdkGoldenProposalProvenance,sdkGoldenFrozenProposal}from ${JSON.stringify(helper)};
const client=new ControlPlaneClient({profile:defaultLocalControlPlaneServer({TREESEED_API_BASE_URL:${JSON.stringify(`http://127.0.0.1:${address.port}`)}}),accessToken:'controlled-native-input'});
process.on('message',async ({id,actors})=>{try{
const observed=await client.invoke(controlPlaneOperation('governance.proposals.show'),{path:{projectId:'sdk-project',proposalId:'sdk-proposal'},query:{},body:undefined});
const provenance=sdkGoldenProposalProvenance(observed.data);
const binding=await client.invoke(controlPlaneOperation('treedx.library.show'),{path:{projectId:'sdk-project'},query:{},body:undefined});
const files=await client.invoke(controlPlaneOperation('treedx.repositories.files.read'),{path:{projectId:'sdk-project',repoId:provenance.repositoryId},query:{},body:{ref:provenance.commitSha,paths:[provenance.contentPath],encoding:'utf8',parseFrontmatter:true}});
Reflect.apply(verifySdkGoldenProduct,undefined,[actors,${JSON.stringify(commit)},observed.data,{binding:binding.data,files:files.data,initialProposal:sdkGoldenFrozenProposal(${JSON.stringify(freeze)})}]);process.send({id,passed:true});
}catch(error){process.send({id,passed:false,error:error instanceof Error?error.message:'Native verification failed'});}});`;
		worker = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], {
			cwd: new URL('../../../../', import.meta.url), stdio: ['ignore', 'ignore', 'pipe', 'ipc'], env: process.env,
		});
		worker.once('error', fail); worker.once('exit', () => fail(new Error('Isolated verifier exited before completing its assertion')));
		worker.stderr!.on('data', (bytes: Buffer) => { stderrBytes += bytes.length;
			if (stderrBytes > 131_072) { fail(new Error('Isolated verifier exceeded original output bound')); worker!.kill('SIGKILL'); } });
		worker.on('message', (message: unknown) => {
			const value = message as { id?: unknown; passed?: unknown; error?: unknown };
			if (!value || typeof value.id !== 'number' || !pending.has(value.id) || typeof value.passed !== 'boolean') {
				fail(new Error('Malformed or duplicate isolated verifier assertion')); worker!.kill('SIGKILL'); return;
			}
			const item = pending.get(value.id)!; pending.delete(value.id); clearTimeout(item.timer);
			if (value.passed) item.resolve({ stdout: 'verified' }); else item.reject(new Error(String(value.error)));
		});
		const observe = (actors: unknown[] = [release, review]) => new Promise<{ stdout: string }>((resolve, reject) => {
			if (!worker?.connected) { reject(new Error('Isolated verifier is unavailable')); return; }
			const id = ++sequence, timer = setTimeout(() => { fail(new Error('Isolated verifier exceeded original five-second watchdog')); worker!.kill('SIGKILL'); }, 5_000);
			pending.set(id, { resolve, reject, timer }); worker.send({ id, actors }, error => { if (error) fail(error); });
		});
		expect((await Promise.all([observe(), observe()])).map(value => value.stdout)).toEqual(['verified', 'verified']);
		for (const denied of ['title', 'summary', 'foreign-id', 'foreign-project', 'missing-title', 'missing-summary',
			'row-0', 'row-1', 'row-2', 'row-3', 'row-4', 'row-5', 'missing-graph', 'duplicate-row', 'generated-review',
			'missing-provenance', 'foreign-binding', 'moved-content', 'foreign-path', 'changed-bytes', 'contradictory-frontmatter', 'missing-file',
			'missing-source', 'foreign-source', 'duplicate-source', 'malformed-source', 'source-fragment', 'source-store', 'source-model', 'source-id', 'source-unknown-property',
			'null', 'denied', 'unavailable', 'interrupted', 'json']) {
			mode = denied;
			if (['denied', 'unavailable', 'interrupted', 'json'].includes(denied)) await expect.soft(observe(), denied).rejects.toThrow();
			else if (denied === 'null') await expect.soft(observe(), denied).rejects.toThrow('invalid_type');
			else await expect.soft(observe(), denied).rejects.toThrow('ACCEPTANCE_SDK_');
		}
		const retained = structuredClone(failed); mode = 'exact'; expect((await observe()).stdout).toBe('verified');
		expect(failed).toEqual(retained); expect(failed).toHaveLength(36);
		expect(calls.filter(value => value === 'GET /v1/projects/sdk-project/proposals/sdk-proposal')).toHaveLength(39);
		expect(calls.filter(value => value === 'GET /v1/projects/sdk-project/treedx-library')).toHaveLength(33);
		expect(calls.filter(value => value === 'POST /v1/dx/projects/sdk-project/repos/repo_sdk_fixture/files/read')).toHaveLength(33);
		expect(calls).toHaveLength(105);
		for (const bytes of [1_048_576, 1_048_577]) {
			const bounded = proposalReadback(proposal, bytes), actor = structuredClone(release), reviewer = structuredClone(review);
			for (const item of [actor, reviewer]) item.assignmentAttempt.sourceRef.digest = `sha256:${bounded.governance.activeContentHash}`;
			mode = bytes === 1_048_576 ? 'budget-boundary' : 'budget-over';
			if (bytes === 1_048_576) expect((await observe([actor, reviewer])).stdout).toBe('verified');
			else await expect(observe([actor, reviewer])).rejects.toThrow('ACCEPTANCE_SDK_PROPOSAL');
		}
		mode = 'exact'; expect((await observe()).stdout).toBe('verified');
		expect(failed.slice(0, retained.length)).toEqual(retained);
		expect(failed).toHaveLength(37); expect(calls).toHaveLength(114);
		for (const field of ['objective', 'estimate', 'reviewEstimate', 'contextRefs', 'requestedPermissions', 'requiredCapabilities', 'acceptanceCriteria', 'anchor', 'alias']) {
			const value = structuredClone(proposal);
			if (!['anchor', 'alias'].includes(field)) Reflect.deleteProperty(value.executionPlan.workItems[0]!, field);
			const observed = proposalReadback(value, 0, field === 'alias' ? 'alias' : field === 'anchor'), actor = structuredClone(release), reviewer = structuredClone(review);
			for (const issued of [actor, reviewer]) issued.assignmentAttempt.sourceRef.digest = `sha256:${observed.governance.activeContentHash}`;
			mode = ['anchor', 'alias'].includes(field) ? field : `explicit-${field}`;
			if (field === 'alias') await expect.soft(observe([actor, reviewer]), mode).rejects.toThrow();
			else await expect.soft(observe([actor, reviewer]), mode).rejects.toThrow(field === 'anchor' ? 'ACCEPTANCE_SDK_PROPOSAL' : 'ACCEPTANCE_SDK_GRAPH');
		}
		const deniedExpanded = structuredClone(failed); mode = 'exact'; expect((await observe()).stdout).toBe('verified');
		expect(failed).toEqual(deniedExpanded); expect(failed).toHaveLength(46); expect(calls).toHaveLength(144);
		const changedRequest = proposalReadback({ ...proposal, request: 'Publish the legacy capacity plan and deploy it upstream.' });
		const changedActors = structuredClone([release, review]);
		for (const actor of changedActors) actor.assignmentAttempt.sourceRef.digest = `sha256:${changedRequest.governance.activeContentHash}`;
		mode = 'frozen-request'; await expect(observe(changedActors)).rejects.toThrow('ACCEPTANCE_SDK_FROZEN_REQUEST');
		const deniedRequest = structuredClone(failed); mode = 'exact'; expect((await observe()).stdout).toBe('verified');
		expect(failed).toEqual(deniedRequest); expect(failed).toHaveLength(47); expect(calls).toHaveLength(150);
		expect({ release, review, proposal }).toEqual(original);
		const interrupted = observe(); worker.kill('SIGKILL'); await expect(interrupted).rejects.toThrow('Isolated verifier exited');
		await expect(observe()).rejects.toThrow('unavailable'); expect(pending.size).toBe(0);
		// The owning SDK transport and isolated verifier are real. Upstream API
		// values are controlled; this is not a managed governance or golden receipt.
	} finally {
		if (worker && worker.exitCode === null && worker.signalCode === null) { const exited = once(worker, 'exit'); worker.kill('SIGKILL'); await exited; }
		fail(new Error('Native fixture closed'));
		server.closeAllConnections(); if (server.listening) await new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()));
		retainedInput.close();
	}
	expect(server.listening).toBe(false);
}, 15_000);
