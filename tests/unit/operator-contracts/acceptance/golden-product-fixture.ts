import { createHash } from 'node:crypto';
import { parse, stringify } from 'yaml';
export const commit = 'a'.repeat(40);
export const proposal = { schemaVersion: 'treeseed.proposal/v1', status: 'ready', id: 'sdk-proposal', projectId: 'sdk-project', title: 'Select accepted decisions in portable workday intent',
	request: 'Controlled SDK request',
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
export const release = { id: 'release-row', createdAt: 'now', status: 'completed', assignmentAttempt: { id: 'release-attempt', workdayId: 'workday-fixture', projectId: 'sdk-project', sourceRef: {
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
		original: { initialProposal: structuredClone({ ...proposal, status: 'draft' }), binding: { repositoryId }, files: { repoId: repositoryId, resolvedRef: commitSha,
			files: [{ path: contentPath, content, frontmatter: parse(encoded) as unknown }] } } };
}
