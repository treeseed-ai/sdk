import assert from 'node:assert/strict';
import { ControlPlaneClient, defaultLocalControlPlaneServer } from '@treeseed/sdk/control-plane-client';
import { controlPlaneOperation } from '@treeseed/sdk/operator-contracts';
import { sdkGoldenExecutionEvents } from '../../../acceptance/product/release-output.ts';
import { verifySdkGoldenProduct, sdkGoldenProposalProvenance, sdkGoldenFrozenProposal, sdkGoldenProposalDocument,
	sdkGoldenLibraryFiles } from '../../../acceptance/golden-product.ts';

type Row = Record<string, any>;
const url = process.argv[2], commit = process.argv[3];
assert.ok(url && /^http:\/\/127\.0\.0\.1:\d+$/u.test(url));
assert.ok(commit && /^[a-f0-9]{40}$/u.test(commit));
const client = new ControlPlaneClient({ profile: defaultLocalControlPlaneServer({ TREESEED_API_BASE_URL: url }), accessToken: 'controlled-native-input' });
async function read(operation: Parameters<typeof controlPlaneOperation>[0], path: Record<string, string>, query: Row = {}, body: unknown = undefined): Promise<Row> {
	const result = await client.invoke(controlPlaneOperation(operation), { path, query, body });
	assert.ok(result.data && typeof result.data === 'object' && !Array.isArray(result.data));
	return result.data as Row;
}
process.on('message', async ({ id, actors, frozen }: { id: number; actors: unknown[]; frozen: Row }) => {
	try {
		const observed = await read('governance.proposals.show', { projectId: 'sdk-project', proposalId: 'sdk-proposal' });
		const provenance = sdkGoldenProposalProvenance(observed);
		const binding = await read('treedx.library.show', { projectId: 'sdk-project' });
		const files = await read('treedx.repositories.files.read', { projectId: 'sdk-project', repoId: provenance.repositoryId }, {},
			{ ref: provenance.commitSha, paths: [provenance.contentPath], encoding: 'utf8', parseFrontmatter: true });
		const original = { binding, files: sdkGoldenLibraryFiles({ result: files, receipt: { operation: 'read' } }), initialProposal: sdkGoldenFrozenProposal(frozen) };
		const document = sdkGoldenProposalDocument(observed, original);
		const teamProject = await read('projects.show', { projectId: 'team-project' });
		const teamBinding = await read('treedx.library.show', { projectId: 'team-project' });
		const referenceFiles: Row[] = [];
		for (const ref of [...(Array.isArray(document.objectiveRefs) ? document.objectiveRefs : []), ...(document.discussionRef ? [document.discussionRef] : [])]) {
			const result = await read('treedx.repositories.files.read', { projectId: ref.repository === teamBinding.repositoryId ? 'team-project' : 'sdk-project', repoId: ref.repository }, {},
				{ ref: ref.commit, paths: [ref.path], encoding: 'utf8', parseFrontmatter: true });
			referenceFiles.push(sdkGoldenLibraryFiles({ result, receipt: { operation: 'read' } }));
		}
		const graph = await read('execution.graph.show', { teamId: 'sdk-team' });
		const diagnostics = await read('workdays.events.list', { teamId: 'sdk-team', runId: 'workday-fixture' }, { diagnostics: 'full', limit: 50 });
		const executionEvents = sdkGoldenExecutionEvents(() => diagnostics, 'workday-fixture', 'sdk-team');
		Reflect.apply(verifySdkGoldenProduct, undefined, [actors, commit, observed, { ...original, graph, executionEvents,
			teamLibrary: { project: teamProject, library: teamBinding }, referenceFiles }]);
		process.send?.({ id, passed: true });
	} catch (error) { process.send?.({ id, passed: false, error: error instanceof Error ? error.message : 'Native verification failed' }); }
});
