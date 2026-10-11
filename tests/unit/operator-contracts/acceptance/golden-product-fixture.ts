export const commit = 'a'.repeat(40);
export const release = { id: 'release-row', createdAt: 'now', status: 'completed', assignmentAttempt: { id: 'release-attempt', workdayId: 'workday-fixture', projectId: 'sdk-project', sourceRef: { store: 'treedx', model: 'proposal', id: 'sdk-proposal' }, agentClass: 'renamed-releaser', workItemId: 'simulate-release', effectiveProfile: { activity: 'acting' } },
	lifecycleOutput: { sourceReference: { kind: 'git', repository: 'treeseed-ai/sdk', commit } },
	assignmentResult: { id: 'release-result', assignmentId: 'release-attempt', references: [{ kind: 'git', repository: 'treeseed-ai/sdk', commit }], verification: ['npm run standards:build', 'npm run build', 'npm run release:verify', 'npm pack', 'npm run test:contracts', 'npm run standards:acceptance -- --archive treeseed-sdk-1.0.0.tgz']
		.map(command => ({ command, status: 'passed', exitCode: 0, outputDigest: `sha256:${'b'.repeat(64)}`, durationSeconds: 1 })) } };
export const review = { ...release, id: 'review-row', assignmentAttempt: { ...release.assignmentAttempt, id: 'review-attempt', agentClass: 'renamed-reviewer', effectiveProfile: { activity: 'reviewing' },
	contextRefs: [{ store: 'git', model: 'GitCommit', id: 'release-candidate', repository: 'treeseed-ai/sdk', commit }], predecessorResultIds: ['release-result'] },
	assignmentResult: { ...release.assignmentResult, id: 'review-result', assignmentId: 'review-attempt' },
	lifecycleOutput: { activityCompletion: { reviewDisposition: 'approved' } } };
export const proposal = { id: 'sdk-proposal', projectId: 'sdk-project', title: 'Select accepted decisions in portable workday intent',
	evidenceRefs: [{ store: 'url', model: 'issue', id: 'sdk-source-1', url: 'https://github.com/treeseed-ai/sdk/issues/299' }],
	summary: 'Prove the SDK can express high-level decision-governed execution while keeping all derived execution state API-owned.' };
