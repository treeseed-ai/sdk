import assert from 'node:assert/strict';

type Row = Record<string, any>;
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
	for (const command of ['npm run standards:build', 'npm run build', 'npm run release:verify', 'npm pack', 'workday-intent-portable.test.ts']) {
		const record = records.find(item => typeof item.command === 'string' && item.command.includes(command));
		assert.ok(record && record.status === 'passed' && record.exitCode === 0
			&& /^sha256:[a-f0-9]{64}$/u.test(record.outputDigest)
			&& typeof record.durationSeconds === 'number' && record.durationSeconds >= 0,
			'ACCEPTANCE_SDK_RELEASE_GATE: Every required release command must have passed with measured exact evidence');
	}
	assert.ok(!records.some(record => record.status === 'failed' || record.exitCode !== 0),
		'ACCEPTANCE_SDK_RELEASE_GATE: A failed candidate cannot pass');
	const source = release.lifecycleOutput?.sourceReference;
	assert.ok(source?.kind === 'git' && source.repository === 'treeseed-ai/sdk' && /^[a-f0-9]{40}$/u.test(source.commit),
		'ACCEPTANCE_SDK_CANDIDATE: Exact local SDK candidate required');
	assert.ok(release.assignmentResult.references.some((ref: Row) => ref.kind === 'git' && ref.commit === source.commit),
		'ACCEPTANCE_SDK_CANDIDATE: Canonical result must retain the verified candidate');
}
