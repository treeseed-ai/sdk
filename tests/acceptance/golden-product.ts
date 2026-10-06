import assert from 'node:assert/strict';

type Row = Record<string, any>;
function measured(record: Row | undefined): boolean {
	return Boolean(record && record.status === 'passed' && record.exitCode === 0
		&& typeof record.outputDigest === 'string' && /^sha256:[a-f0-9]{64}$/u.test(record.outputDigest)
		&& Number.isSafeInteger(record.durationSeconds) && record.durationSeconds >= 0);
}
export function sdkGoldenSource(freeze: Row, proposalIds: unknown): string {
	const source = freeze.sourceHeads?.sdk;
	assert.ok(typeof source === 'string' && /^[a-f0-9]{40}$/u.test(source)
		&& typeof freeze.proposal?.id === 'string' && Array.isArray(proposalIds) && proposalIds.includes(freeze.proposal.id),
		'ACCEPTANCE_SDK_FREEZE: Exact current source and matching frozen proposal required');
	return source;
}
export function verifySdkGoldenProduct(assignments: Row[], sourceBase: string): void {
	const actors = assignments.filter(item => item.status === 'completed'
		&& item.assignmentAttempt?.effectiveProfile?.activity === 'acting');
	const final = (id: string) => actors.filter(item => item.assignmentAttempt.workItemId === id)
		.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).at(-1);
	const release = final('simulate-release');
	assert.ok(release, 'ACCEPTANCE_SDK_RELEASE: Completed release actor required');
	for (const item of actors.filter(item => ['research-context', 'architecture-contract', 'tests-first'].includes(item.assignmentAttempt.workItemId)))
		assert.ok(item.assignmentAttempt.contextRefs?.some((ref: Row) => ref.store === 'git' && ref.commit === sourceBase),
			'ACCEPTANCE_SDK_SOURCE: Early roles must receive exact frozen SDK source');
	const records = release.assignmentResult?.verification as Row[] | undefined;
	assert.ok(Array.isArray(records), 'ACCEPTANCE_SDK_VERIFICATION: Canonical measured verification required');
	// release:verify owns strict build, standards generation/acceptance and the full
	// test:release suite. Separate build/generator/suite receipts duplicate that gate.
	for (const command of ['npm run release:verify', 'npm pack']) {
		const record = records.find(item => item.command === command);
		assert.ok(measured(record),
			'ACCEPTANCE_SDK_RELEASE_GATE: Every required release command must have passed with measured exact evidence');
	}
	assert.ok(!records.some(record => record.status === 'failed' || record.exitCode !== 0),
		'ACCEPTANCE_SDK_RELEASE_GATE: A failed candidate cannot pass');
	const archivePassed = (verification: unknown) => Array.isArray(verification) && verification.some(record =>
		/^npm run standards:acceptance -- --archive (?:\.\/)?[a-zA-Z0-9][a-zA-Z0-9._-]*\.tgz$/u.test(String(record.command))
		&& measured(record));
	assert.ok(archivePassed(records), 'ACCEPTANCE_SDK_RELEASE_GATE: Packed export/type inspection must be independently replayable');
	const review = assignments.filter(item => item.status === 'completed' && item.assignmentAttempt?.workItemId === 'simulate-release'
		&& item.assignmentAttempt.effectiveProfile?.activity === 'reviewing')
		.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).at(-1);
	assert.ok(review?.lifecycleOutput?.activityCompletion?.reviewDisposition === 'approved'
		&& archivePassed(review.assignmentResult?.verification)
		&& ['npm run release:verify', 'npm pack'].every(command => measured(review.assignmentResult?.verification?.find((record: Row) => record.command === command)))
		&& !review.assignmentResult?.verification?.some((record: Row) => record.status === 'failed' || record.exitCode !== 0),
		'ACCEPTANCE_SDK_ARCHIVE_REVIEW: Independent approved replay of every release command required');
	const source = release.lifecycleOutput?.sourceReference;
	assert.ok(source?.kind === 'git' && source.repository === 'treeseed-ai/sdk' && /^[a-f0-9]{40}$/u.test(source.commit),
		'ACCEPTANCE_SDK_CANDIDATE: Exact local SDK candidate required');
	assert.ok(release.assignmentResult.references.some((ref: Row) => ref.kind === 'git' && ref.repository === source.repository && ref.commit === source.commit),
		'ACCEPTANCE_SDK_CANDIDATE: Canonical result must retain the verified candidate');
	const actorAttempt = release.assignmentAttempt, reviewerAttempt = review.assignmentAttempt;
	assert.ok(reviewerAttempt.id !== actorAttempt.id && reviewerAttempt.agentClass !== actorAttempt.agentClass
		&& reviewerAttempt.workdayId === actorAttempt.workdayId && reviewerAttempt.projectId === actorAttempt.projectId
		&& review.assignmentResult?.assignmentId === reviewerAttempt.id && release.assignmentResult.assignmentId === actorAttempt.id
		&& review.assignmentResult.id !== release.assignmentResult.id
		&& Array.isArray(reviewerAttempt.predecessorResultIds)
		&& new Set(reviewerAttempt.predecessorResultIds).size === reviewerAttempt.predecessorResultIds.length
		&& reviewerAttempt.predecessorResultIds.includes(release.assignmentResult.id)
		&& reviewerAttempt.contextRefs?.some((ref: Row) => ref.store === 'git' && ref.repository === source.repository && ref.commit === source.commit),
		'ACCEPTANCE_SDK_ARCHIVE_REVIEW: Independent review must consume this exact Actor result and candidate');
}
