import { createHash } from 'node:crypto';
import { parse, stringify } from 'yaml';
export const commit = 'a'.repeat(40);
const libraryCommit = 'c'.repeat(40);
export const graphOrderFailures = ['missing-edges', 'malformed-edge', 'duplicate-edge', 'missing-pair', 'extra-pair', 'missing-profile',
	'transitive-profile', 'actor-profile', 'research-profile', 'work-item-profile', 'foreign-edge-team', 'edge-source-id',
	'edge-source-revision', 'edge-source-digest', 'edge-source-commit', 'edge-source-path', 'pair-endpoint', 'profile-foreign-node'] as const;
export function mutateGraphOrder(graph: { edges: Array<Record<string, unknown>> }, mode: string): void {
	const pair = graph.edges[0]!, profile = graph.edges.find(edge => edge.provenance === 'profile-agent')!;
	if (mode === 'missing-edges') Reflect.deleteProperty(graph, 'edges');
	else if (mode === 'malformed-edge') graph.edges[0] = {};
	else if (mode === 'duplicate-edge') graph.edges.push(structuredClone(pair));
	else if (mode === 'missing-pair') graph.edges.shift();
	else if (mode === 'extra-pair') graph.edges.push({ ...structuredClone(pair), id: 'extra-pair' });
	else if (mode === 'missing-profile') graph.edges.splice(graph.edges.indexOf(profile), 1);
	else if (mode === 'transitive-profile') profile.toNodeId = 'actor-implement-change';
	else if (mode === 'actor-profile') profile.fromNodeId = 'actor-architecture-contract';
	else if (mode === 'research-profile') profile.fromNodeId = 'reviewer-research-context';
	else if (mode === 'work-item-profile') profile.provenance = 'work-item';
	else if (mode === 'foreign-edge-team') pair.teamId = 'foreign-team';
	else if (mode === 'pair-endpoint') pair.toNodeId = 'reviewer-architecture-contract';
	else if (mode === 'profile-foreign-node') profile.toNodeId = 'foreign-node';
	else if (mode.startsWith('edge-source-')) Reflect.set(pair.sourceRef as object, mode.slice(12), mode === 'edge-source-revision' ? 2
		: mode === 'edge-source-digest' ? `sha256:${'e'.repeat(64)}` : mode === 'edge-source-commit' ? 'd'.repeat(40) : 'foreign');
}
export const graphPairFailures = ['missing', 'foreign-team', 'duplicate-id', 'missing-node', 'extra-node', 'work-item',
	'pair-role', 'kind', 'class', 'workspace', 'cycles', 'project', 'team', 'workday', 'source-id', 'source-revision',
	'source-digest', 'source-commit', 'source-path', 'source-repository'] as const;
export function mutateGraphPair(graph: { teamId: string; nodes: Array<Record<string, unknown>> }, mode: string): void {
	const node = graph.nodes[1]!;
	if (mode === 'missing') Reflect.deleteProperty(graph, 'nodes');
	else if (mode === 'foreign-team') graph.teamId = 'foreign';
	else if (mode === 'duplicate-id') node.id = graph.nodes[0]!.id;
	else if (mode === 'missing-node') graph.nodes.pop();
	else if (mode === 'extra-node') graph.nodes.push({ ...node, id: 'extra-pair' });
	else if (mode.startsWith('source-')) Reflect.set(node.sourceRef as object, mode.slice(7), mode === 'source-revision' ? 2 : mode === 'source-digest' ? `sha256:${'e'.repeat(64)}` : mode === 'source-commit' ? 'd'.repeat(40) : 'foreign');
	else Reflect.set(node, ({ 'work-item': 'workItemId', 'pair-role': 'pairRole', class: 'agentClass', cycles: 'maximumReviewCycles',
		project: 'projectId', team: 'teamId', workday: 'workdayId' } as Record<string, string>)[mode] ?? mode,
		mode === 'cycles' ? 3 : mode === 'kind' ? 'acting' : mode === 'pair-role' ? 'actor' : mode === 'workspace' ? 'git' : 'foreign');
}
const referenced = [
	{ schemaVersion: 'treeseed.objective/v1', id: 'sdk-objective', projectId: 'sdk-project', title: 'SDK objective', outcome: 'Portable intent', status: 'active' },
	{ schemaVersion: 'treeseed.objective/v1', id: 'team-objective', projectId: 'team-project', title: 'Team objective', outcome: 'Governed execution', status: 'active' },
	{ schemaVersion: 'treeseed.discussion/v1', id: 'sdk-discussion', projectId: 'sdk-project', teamId: 'sdk-team', title: 'SDK proposal discussion',
		status: 'closed', participantClasses: ['researcher'], createdAt: '2026-10-01T00:00:00.000Z',
		subjectRef: { store: 'treedx', model: 'proposal', id: 'sdk-proposal', repository: 'repo_sdk_fixture', commit, path: 'proposals/governance/sdk-proposal.mdx' } },
].map((frontmatter, index) => {
	const path = index === 2 ? 'discussions/sdk-discussion.mdx' : `objectives/${frontmatter.id}.mdx`;
	const content = `---\n${stringify(frontmatter)}---\n`, repoId = index === 1 ? 'repo_team_fixture' : 'repo_sdk_fixture';
	return { ref: { store: 'treedx', model: index === 2 ? 'discussion' : 'objective', id: frontmatter.id, repository: repoId,
		commit: libraryCommit, path, digest: `sha256:${createHash('sha256').update(content).digest('hex')}` },
		read: { ok: true, repoId, resolvedRef: libraryCommit, files: [{ path, content, frontmatter: parse(content.match(/^---\n([\s\S]*?)---\n/u)![1]!) }] } };
});
export const proposal = { schemaVersion: 'treeseed.proposal/v1', status: 'ready', id: 'sdk-proposal', projectId: 'sdk-project', title: 'Select accepted decisions in portable workday intent',
	request: 'Controlled SDK request',
	objectiveRefs: referenced.slice(0, 2).map(item => item.ref), discussionRef: referenced[2]!.ref,
	executionPlan: { workItems: [
		['research-context', 'researcher', 'treedx'], ['architecture-contract', 'architect', 'treedx'],
		['tests-first', 'tester', 'git'], ['implement-change', 'engineer', 'git'],
		['document-change', 'technical-writer', 'git'], ['simulate-release', 'releaser', 'git'],
	].map(([id, agentClass, workspace]) => ({ id, agentClass, workspace, dependsOn: [], maximumReviewCycles: 2, activity: 'acting', review: 'required',
		objective: `Controlled explicit ${id} objective`, estimate: { expectedSeconds: 120, maximumSeconds: 240 },
		reviewEstimate: { expectedSeconds: 60, maximumSeconds: 120 },
		contextRefs: [{ store: workspace, model: 'repository', id: 'sdk', repository: workspace === 'git' ? 'treeseed-ai/sdk' : 'repo_sdk_fixture', commit }],
		requestedPermissions: { content: { read: ['proposal', 'decision'], write: [] }, tools: ['source.read'] },
		requiredCapabilities: ['source.read'], acceptanceCriteria: [`Verify controlled ${id} outcome.`] })) },
	evidenceRefs: [{ store: 'url', model: 'issue', id: 'sdk-source-1', url: 'https://github.com/treeseed-ai/sdk/issues/299' }],
	summary: 'Prove the SDK can express high-level decision-governed execution while keeping all derived execution state API-owned.' };
const recorded = proposalReadback().governance;
export const release = { id: 'release-row', createdAt: 'now', status: 'completed', assignmentAttempt: { id: 'release-attempt', workdayId: 'workday-fixture', teamId: 'sdk-team', projectId: 'sdk-project', sourceRef: {
	store: 'treedx', model: 'proposal', id: 'sdk-proposal', revision: recorded.activeVersion, digest: `sha256:${recorded.activeContentHash}`,
	repository: recorded.metadata.contentProvenance.repositoryId, commit: recorded.metadata.contentProvenance.commitSha, path: recorded.metadata.contentProvenance.contentPath,
}, agentClass: 'renamed-releaser', workItemId: 'simulate-release', effectiveProfile: { activity: 'acting' } },
	lifecycleOutput: { sourceReference: { kind: 'git', repository: 'treeseed-ai/sdk', commit } },
	assignmentResult: { id: 'release-result', assignmentId: 'release-attempt', references: [{ kind: 'git', repository: 'treeseed-ai/sdk', commit }], verification: ['npm run standards:build', 'npm run build', 'npm run release:verify', 'npm pack', 'npm run test:contracts', 'npm run standards:acceptance -- --archive treeseed-sdk-1.0.0.tgz']
		.map(command => ({ command, status: 'passed', exitCode: 0, outputDigest: `sha256:${'b'.repeat(64)}`, durationSeconds: 1 })) } };
export const review = { ...release, id: 'review-row', assignmentAttempt: { ...release.assignmentAttempt, id: 'review-attempt', agentClass: 'renamed-reviewer', effectiveProfile: { activity: 'reviewing' },
	contextRefs: [{ store: 'git', model: 'GitCommit', id: 'release-candidate', repository: 'treeseed-ai/sdk', commit }], predecessorResultIds: ['release-result'] },
	assignmentResult: { ...release.assignmentResult, id: 'review-result', assignmentId: 'review-attempt' },
	lifecycleOutput: { activityCompletion: { reviewDisposition: 'approved' } } };

/** Production governance is an index; executable content remains exact TreeDX bytes. */
export function proposalReadback(...input: [unknown?, number?, (boolean | 'alias')?]) {
	const value = input.length ? input[0] : proposal;
	const fields = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
	const plain = stringify(value === undefined ? null : value, { aliasDuplicateObjects: false });
	const encoded = (input[2] ? plain.replace('executionPlan:', 'executionPlan: &inherited-graph') : plain)
		+ (input[2] === 'alias' ? 'inheritedGraph: *inherited-graph\n' : '');
	const base = `---\n${encoded}---\n`;
	const content = base + ' '.repeat(Math.max(0, (input[1] ?? 0) - Buffer.byteLength(base)));
	const digest = createHash('sha256').update(content).digest('hex'), repositoryId = 'repo_sdk_fixture', commitSha = 'c'.repeat(40), contentPath = 'proposals/governance/sdk-proposal.mdx';
	const initialProposal = structuredClone({ ...proposal, status: 'draft' });
	for (const item of initialProposal.executionPlan.workItems) { Reflect.deleteProperty(item, 'estimate'); Reflect.deleteProperty(item, 'reviewEstimate'); }
	// Controlled graph observations, not generated production evidence.
	const sourceRef = { store: 'treedx', model: 'proposal', id: proposal.id, revision: 1, digest: `sha256:${digest}`,
		repository: repositoryId, commit: commitSha, path: contentPath };
	const nodes = proposal.executionPlan.workItems.flatMap(item => ['actor', 'reviewer'].map(pairRole => ({
		schemaVersion: 'treeseed.execution-node/v1', ruleRevision: 1, nodeRevision: 1, status: 'completed',
		graphRevisionCreated: 1, graphRevisionUpdated: 1,
		id: `${pairRole}-${item.id}`, teamId: 'sdk-team', projectId: proposal.projectId, workdayId: 'workday-fixture',
		workItemId: item.id, pairRole, kind: pairRole === 'actor' ? 'acting' : 'reviewing',
		agentClass: pairRole === 'actor' ? item.agentClass : 'reviewer', workspace: pairRole === 'actor' ? item.workspace : 'treedx',
		maximumReviewCycles: item.maximumReviewCycles, sourceRef: structuredClone(sourceRef),
		estimate: structuredClone(pairRole === 'actor' ? item.estimate : item.reviewEstimate),
		requiredCapabilities: ['source.read'], requestedPermissions: structuredClone(item.requestedPermissions) })));
	const edge = (fromNodeId: string, toNodeId: string, provenance: string) => ({ schemaVersion: 'treeseed.execution-edge/v1',
		id: `${fromNodeId}-${toNodeId}`, teamId: 'sdk-team', fromNodeId, toNodeId, provenance, sourceRef: structuredClone(sourceRef), graphRevisionCreated: 1 });
	const order = ['architecture-contract', 'tests-first', 'implement-change', 'document-change', 'simulate-release'];
	const edges = [...proposal.executionPlan.workItems.map(item => edge(`actor-${item.id}`, `reviewer-${item.id}`, 'review-pair')),
		...order.slice(1).map((item, index) => edge(`reviewer-${order[index]}`, `actor-${item}`, 'profile-agent'))];
	const graph = { teamId: 'sdk-team', revision: 1, digest: `sha256:${'f'.repeat(64)}`, nodes, edges };
	return { governance: { id: fields.id, projectId: fields.projectId, title: fields.title, summary: fields.summary, body: fields.request,
		activeVersion: 1, activeContentHash: digest, metadata: { contentProvenance: { repositoryId, commitSha, contentPath, digest } } },
		original: { initialProposal, graph, binding: { repositoryId },
			teamLibrary: { project: { id: 'team-project', slug: 'team', teamId: 'sdk-team' }, library: { projectId: 'team-project', teamId: 'sdk-team', repositoryId: 'repo_team_fixture' } },
			referenceFiles: structuredClone(referenced.map(item => item.read)), files: { ok: true, repoId: repositoryId, resolvedRef: commitSha,
			files: [{ path: contentPath, content, frontmatter: parse(encoded) as unknown }] } } };
}
