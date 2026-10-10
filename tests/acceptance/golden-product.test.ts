import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { sdkGoldenSource, sdkGoldenWorkdayId, verifySdkGoldenProduct } from './golden-product.ts';
import { assignmentAttemptSchema, assignmentResultSchema } from '@treeseed/sdk/agent-capacity';

test('SDK golden retains exact source and passing measured candidate release gates', () => {
	const read = (args: string[]) => {
		const envelope = JSON.parse(execFileSync('trsd', [...args, '--server', 'local', '--team', process.env.TREESEED_ACCEPTANCE_TEAM ?? 'treeseed', '--json'],
			{ encoding: 'utf8', timeout: 30000, maxBuffer: 32 * 1024 * 1024 }));
		assert.equal(envelope.ok, true, 'ACCEPTANCE_SDK_READ: Authoritative read failed'); return envelope.result;
	};
	const freezePath = process.env.TREESEED_ACCEPTANCE_FREEZE_PATH;
	assert.ok(freezePath, 'ACCEPTANCE_SDK_FREEZE: Explicit immutable campaign freeze required');
	const freezeBytes = readFileSync(freezePath, 'utf8');
	const freeze = JSON.parse(freezeBytes);
	const proposalId = freeze.proposal?.id;
	const id = sdkGoldenWorkdayId(read, freeze, process.env.TREESEED_ACCEPTANCE_WORKDAY_ID, freezePath);
	const run = read(['workdays', 'show', id]).run;
	if (proposalId) assert.ok(run.parameters.proposalIds.includes(proposalId), 'ACCEPTANCE_SDK_WORKDAY: Wrong frozen proposal');
	assert.equal(run.executionMode, 'simulation'); assert.equal(run.status, 'completed');
	const assignments: Record<string, any>[] = [];
	let cursor: string | undefined;
	for (let page = 0; page < 40; page += 1) {
		const result = read(['assignments', 'list', '--limit', '50', ...(cursor ? ['--cursor', cursor] : [])]);
		assert.ok(Array.isArray(result.items) && typeof result.page?.hasMore === 'boolean', 'ACCEPTANCE_SDK_PAGINATION: Malformed assignment page');
		assignments.push(...result.items.filter((item: Record<string, unknown>) => item.workDayId === id));
		if (!result.page?.hasMore) break;
		assert.ok(result.page.nextCursor && result.page.nextCursor !== cursor && page < 39, 'ACCEPTANCE_SDK_PAGINATION: Incomplete assignment evidence');
		cursor = result.page.nextCursor;
	}
	verifySdkGoldenProduct(assignments, sdkGoldenSource(freeze, run.parameters.proposalIds));
	// Complete public list/show custody, not a time-cutoff approximation or a
	// synthetic replacement for a managed Releaser and its independent Reviewer.
	assert.equal(new Set(assignments.map(item => item.id)).size, assignments.length, 'ACCEPTANCE_SDK_PAGINATION: Duplicate assignments');
	const full = assignments.map(item => {
		const value = read(['assignments', 'show', item.id]);
		assert.equal(value.id, item.id); assert.equal(value.workDayId, id);
		return value;
	});
	verifySdkGoldenProduct(full, sdkGoldenSource(freeze, run.parameters.proposalIds));
	const final = (activity: string, workItemId = 'simulate-release') => full.filter(item => item.status === 'completed'
		&& item.assignmentAttempt?.workItemId === workItemId && item.assignmentAttempt.effectiveProfile?.activity === activity)
		.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).at(-1);
	const actor = final('acting'), reviewer = final('reviewing');
	assert.ok(actor && reviewer, 'ACCEPTANCE_SDK_ARCHIVE_REVIEW: Actual release pair required');
	const actorAttempt = assignmentAttemptSchema.parse(actor.assignmentAttempt), actorResult = assignmentResultSchema.parse(actor.assignmentResult);
	const reviewAttempt = assignmentAttemptSchema.parse(reviewer.assignmentAttempt), reviewResult = assignmentResultSchema.parse(reviewer.assignmentResult);
	assert.equal(actorResult.assignmentId, actorAttempt.id); assert.equal(reviewResult.assignmentId, reviewAttempt.id);
	assert.equal(actorResult.status, 'completed'); assert.equal(reviewResult.status, 'completed');
	assert.notEqual(reviewAttempt.id, actorAttempt.id); assert.notEqual(reviewAttempt.agentClass, actorAttempt.agentClass);
	assert.equal(actorAttempt.workdayId, id); assert.equal(reviewAttempt.workdayId, id);
	assert.equal(reviewAttempt.projectId, actorAttempt.projectId); assert.equal(reviewAttempt.teamId, actorAttempt.teamId);
	assert.ok(reviewAttempt.predecessorResultIds.includes(actorResult.id), 'ACCEPTANCE_SDK_ARCHIVE_REVIEW: Exact release result predecessor required');
	const source = actor.lifecycleOutput?.sourceReference;
	assert.ok(source?.kind === 'git' && source.repository === 'treeseed-ai/sdk' && /^[a-f0-9]{40}$/u.test(source.commit));
	assert.ok(actorResult.references.some(ref => ref.kind === 'git' && ref.repository === source.repository && ref.commit === source.commit));
	assert.ok(reviewAttempt.contextRefs.some(ref => ref.store === 'git' && ref.repository === source.repository && ref.commit === source.commit),
		'ACCEPTANCE_SDK_ARCHIVE_REVIEW: Reviewer must consume the same exact candidate');
	// Public canonical custody is necessary but is NOT physical test-byte
	// equivalence, native Git ancestry, or proof that a BASE assertion failed.
	const tester = final('acting', 'tests-first'), testReviewer = final('reviewing', 'tests-first'), engineer = final('acting', 'implement-change');
	assert.ok(tester && testReviewer && engineer, 'ACCEPTANCE_SDK_TESTS_FIRST: Actual completed test and implementation chain required');
	const testAttempt = assignmentAttemptSchema.parse(tester.assignmentAttempt), testResult = assignmentResultSchema.parse(tester.assignmentResult),
		testReviewAttempt = assignmentAttemptSchema.parse(testReviewer.assignmentAttempt), testReviewResult = assignmentResultSchema.parse(testReviewer.assignmentResult),
		engineerAttempt = assignmentAttemptSchema.parse(engineer.assignmentAttempt), engineerResult = assignmentResultSchema.parse(engineer.assignmentResult);
	assert.equal(testReviewer.lifecycleOutput?.activityCompletion?.reviewDisposition, 'approved');
	assert.equal(new Set([testAttempt.id, testReviewAttempt.id, engineerAttempt.id]).size, 3);
	assert.equal(new Set([testResult.id, testReviewResult.id, engineerResult.id]).size, 3);
	assert.notEqual(testAttempt.agentClass, testReviewAttempt.agentClass);
	for (const [attempt, result] of [[testAttempt, testResult], [testReviewAttempt, testReviewResult], [engineerAttempt, engineerResult]] as const) {
		assert.equal(result.assignmentId, attempt.id); assert.equal(result.status, 'completed');
		assert.equal(attempt.workdayId, id); assert.equal(attempt.projectId, actorAttempt.projectId); assert.equal(attempt.teamId, actorAttempt.teamId);
		assert.equal(new Set(attempt.predecessorResultIds).size, attempt.predecessorResultIds.length);
		assert.ok(Date.parse(result.completedAt) >= Date.parse(attempt.createdAt) && Date.parse(result.completedAt) <= Date.parse(attempt.deadline),
			'ACCEPTANCE_SDK_TESTS_FIRST: Each owning result must remain inside its original recorded assignment interval');
	}
	const frozenBase = sdkGoldenSource(freeze, run.parameters.proposalIds), testSource = tester.lifecycleOutput?.sourceReference;
	assert.ok(testAttempt.workspace.mode === 'git' && testAttempt.workspace.repository === 'treeseed-ai/sdk' && testAttempt.workspace.baseCommit === frozenBase);
	assert.ok(testSource?.kind === 'git' && testSource.repository === 'treeseed-ai/sdk' && /^[a-f0-9]{40}$/u.test(testSource.commit));
	assert.ok(testResult.references.some(ref => ref.kind === 'git' && ref.repository === testSource.repository && ref.commit === testSource.commit));
	assert.ok(testReviewAttempt.predecessorResultIds.includes(testResult.id));
	assert.ok(testReviewAttempt.contextRefs.some(ref => ref.store === 'git' && ref.repository === testSource.repository && ref.commit === testSource.commit));
	assert.ok(engineerAttempt.predecessorResultIds.includes(testResult.id) && engineerAttempt.predecessorResultIds.includes(testReviewResult.id),
		'ACCEPTANCE_SDK_TESTS_FIRST: Implementation must consume both actual test and independent review results');
	assert.ok(engineerAttempt.workspace.mode === 'git' && engineerAttempt.workspace.repository === testSource.repository
		&& engineerAttempt.workspace.baseCommit === testSource.commit, 'ACCEPTANCE_SDK_TESTS_FIRST: Implementation must retain the reviewed test candidate as its base');
	assert.ok(engineerAttempt.contextRefs.some(ref => ref.store === 'git' && ref.repository === testSource.repository && ref.commit === testSource.commit));
	assert.ok(Date.parse(testResult.completedAt) <= Date.parse(testReviewAttempt.createdAt)
		&& Date.parse(testReviewResult.completedAt) <= Date.parse(engineerAttempt.createdAt));
	const measured = (record: typeof testResult.verification[number]) => Number.isInteger(record.durationSeconds)
		&& Number.isFinite(record.durationSeconds) && record.durationSeconds! >= 0;
	assert.ok(testResult.verification.some(record => record.command === 'npm run test:contracts' && record.status === 'failed' && record.exitCode !== 0 && measured(record)),
		'ACCEPTANCE_SDK_TESTS_FIRST: Original measured failed test observation must remain visible');
	assert.ok(engineerResult.verification.some(record => record.command === 'npm run test:contracts' && record.status === 'passed' && record.exitCode === 0 && measured(record)),
		'ACCEPTANCE_SDK_TESTS_FIRST: Implementation must retain an actual measured passing contract-suite observation');
	const engineerSource = engineer.lifecycleOutput?.sourceReference;
	assert.ok(engineerSource?.kind === 'git' && engineerSource.repository === testSource.repository && /^[a-f0-9]{40}$/u.test(engineerSource.commit));
	assert.ok(engineerResult.references.some(ref => ref.kind === 'git' && ref.repository === engineerSource.repository && ref.commit === engineerSource.commit));
	for (const result of [actorResult, reviewResult]) {
		for (const command of ['npm run release:verify', 'npm pack']) {
			const records = result.verification.filter(record => record.command === command);
			assert.ok(records.length > 0 && records.every(record => record.status === 'passed' && record.exitCode === 0
				&& Number.isInteger(record.durationSeconds) && Number.isFinite(record.durationSeconds) && record.durationSeconds! >= 0),
				'ACCEPTANCE_SDK_RELEASE_GATE: Each participant must actually replay both public release commands');
		}
		const archive = result.verification.filter(record => /^npm run standards:acceptance -- --archive (?:\.\/)?[a-zA-Z0-9][a-zA-Z0-9._-]*\.tgz$/u.test(record.command));
		assert.ok(archive.length > 0 && archive.every(record => record.status === 'passed' && record.exitCode === 0
			&& Number.isInteger(record.durationSeconds) && Number.isFinite(record.durationSeconds) && record.durationSeconds! >= 0));
		assert.ok(result.verification.every(record => record.status === 'passed' && record.exitCode === 0), 'ACCEPTANCE_SDK_RELEASE_GATE: Failed observations cannot pass');
	}
	for (const item of full) assert.deepEqual(read(['assignments', 'show', item.id]), item, 'ACCEPTANCE_SDK_CUSTODY: Public evidence changed during read-back');
	assert.deepEqual(read(['workdays', 'show', id]).run, run, 'ACCEPTANCE_SDK_CUSTODY: Workday evidence changed during read-back');
	assert.equal(readFileSync(freezePath, 'utf8'), freezeBytes, 'ACCEPTANCE_SDK_FREEZE: Original freeze bytes changed');
});
