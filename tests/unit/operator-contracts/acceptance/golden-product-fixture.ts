import { createHash } from 'node:crypto';
import { parse, stringify } from 'yaml';
export const commit = 'a'.repeat(40);
const libraryCommit = 'c'.repeat(40);
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
		read: { repoId, resolvedRef: libraryCommit, files: [{ path, content, frontmatter: parse(content.match(/^---\n([\s\S]*?)---\n/u)![1]!) }] } };
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
	return { governance: { id: fields.id, projectId: fields.projectId, title: fields.title, summary: fields.summary, body: fields.request,
		activeVersion: 1, activeContentHash: digest, metadata: { contentProvenance: { repositoryId, commitSha, contentPath, digest } } },
		original: { initialProposal: structuredClone({ ...proposal, status: 'draft' }), binding: { repositoryId },
			teamLibrary: { project: { id: 'team-project', slug: 'team', teamId: 'sdk-team' }, library: { projectId: 'team-project', teamId: 'sdk-team', repositoryId: 'repo_team_fixture' } },
			referenceFiles: structuredClone(referenced.map(item => item.read)), files: { repoId: repositoryId, resolvedRef: commitSha,
			files: [{ path: contentPath, content, frontmatter: parse(encoded) as unknown }] } } };
}
