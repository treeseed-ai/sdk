import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { sdkPublishedRepository, verifySdkBaseRed, verifySdkCommittedTests, verifySdkPublishedBranch, verifySdkReviewedSourceInput } from './product/test-chain.ts';
import { sdkGoldenReadArguments, sdkGoldenSource, sdkGoldenWorkdayId, verifySdkGoldenProduct, sdkGoldenProposalProvenance, sdkGoldenFrozenProposal, sdkGoldenLibraryFiles, sdkGoldenProposalDocument, type SdkGoldenOriginal } from './golden-product.ts';
import { assignmentAttemptSchema, assignmentResultSchema } from '@treeseed/sdk/agent-capacity';
import { isSdkArchiveCommand, sdkGoldenExecutionEvents, sdkReleaseCommands, sdkNativeTestCommand, verifySdkApprovedTestOutputs } from './product/release-output.ts';

test('SDK golden retains exact source and passing measured candidate release gates', async () => {
	const read = (args: string[]) => {
		const envelope = JSON.parse(execFileSync('trsd', sdkGoldenReadArguments(args, process.env.TREESEED_ACCEPTANCE_TEAM ?? 'treeseed'),
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
	const proposalArgs = ['proposals', 'show', proposalId, '--project', freeze.request.body.projects[0]];
	const proposal = read(proposalArgs);
	const provenance = sdkGoldenProposalProvenance(proposal);
	const libraryArgs = ['library', 'show', proposal.projectId];
	const contentArgs = ['library', 'read', proposal.projectId, provenance.contentPath, '--ref', provenance.commitSha];
	const library = read(libraryArgs), content = read(contentArgs);
	const original: SdkGoldenOriginal = { binding: library.library, files: sdkGoldenLibraryFiles(content), initialProposal: sdkGoldenFrozenProposal(freeze) };
	const document = sdkGoldenProposalDocument(proposal, original), referenceReads: Array<{ args: string[]; value: Record<string, any> }> = [];
	const teamLibraryArgs = ['library', 'show', 'team'], teamLibrary = read(teamLibraryArgs);
	original.teamLibrary = teamLibrary;
	assert.ok(Array.isArray(document.objectiveRefs) && document.discussionRef, 'ACCEPTANCE_SDK_POPULATED_PROPOSAL: Complete proposal references required');
	original.referenceFiles = [...document.objectiveRefs, document.discussionRef].map(reference => {
		const scope = reference.repository === teamLibrary.library?.repositoryId ? 'team' : proposal.projectId;
		const args = ['library', 'read', scope, reference.path, '--ref', reference.commit], value = read(args);
		referenceReads.push({ args, value }); return sdkGoldenLibraryFiles(value);
	});
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
	original.graph = read(['execution', 'graph', 'show']);
	original.executionEvents = sdkGoldenExecutionEvents(read, id, run.teamId);
	verifySdkGoldenProduct(assignments, sdkGoldenSource(freeze, run.parameters.proposalIds), proposal, original);
	// Complete public list/show custody, not a time-cutoff approximation or a
	// synthetic replacement for a managed Releaser and its independent Reviewer.
	assert.equal(new Set(assignments.map(item => item.id)).size, assignments.length, 'ACCEPTANCE_SDK_PAGINATION: Duplicate assignments');
	const full = assignments.map(item => {
		const value = read(['assignments', 'show', item.id]);
		assert.equal(value.id, item.id); assert.equal(value.workDayId, id);
		return value;
	});
	verifySdkGoldenProduct(full, sdkGoldenSource(freeze, run.parameters.proposalIds), proposal, original);
	assert.deepEqual(read(['execution', 'graph', 'show']), original.graph, 'ACCEPTANCE_SDK_GRAPH_PAIRS: Public graph changed during independent read-back');
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
	// Canonical independent review and native committed test bytes are distinct
	// obligations. Intended BASE assertion failure remains separately required.
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
	assert.ok(testResult.verification.some(record => record.command === sdkNativeTestCommand && record.status === 'failed' && record.exitCode !== 0 && measured(record)),
		'ACCEPTANCE_SDK_TESTS_FIRST: Original measured failed test observation must remain visible');
	assert.ok(engineerResult.verification.some(record => record.command === sdkNativeTestCommand && record.status === 'passed' && record.exitCode === 0 && measured(record)),
		'ACCEPTANCE_SDK_TESTS_FIRST: Implementation must retain an actual measured passing contract-suite observation');
	const engineerSource = engineer.lifecycleOutput?.sourceReference;
	assert.ok(engineerSource?.kind === 'git' && engineerSource.repository === testSource.repository && /^[a-f0-9]{40}$/u.test(engineerSource.commit));
	assert.ok(engineerResult.references.some(ref => ref.kind === 'git' && ref.repository === engineerSource.repository && ref.commit === engineerSource.commit));
	const host = read(['host', 'sandbox', 'status']);
	for (const item of full) {
		const attempt = assignmentAttemptSchema.parse(item.assignmentAttempt);
		if (attempt.workspace.mode !== 'git' || item.status !== 'completed') continue;
		const result = assignmentResultSchema.parse(item.assignmentResult), source = item.lifecycleOutput?.sourceReference;
		assert.equal(result.status, 'completed'); assert.equal(result.assignmentId, attempt.id);
		assert.ok(source?.kind === 'git' && result.references.some(ref => ref.kind === 'git'
			&& ref.repository === source.repository && ref.commit === source.commit && ref.branch === source.branch));
		const repository = sdkPublishedRepository(host.workspace, item.lifecycleOutput.sandboxId, attempt, source);
		verifySdkPublishedBranch(repository, source);
	}
	const testRepository = sdkPublishedRepository(host.workspace, tester.lifecycleOutput.sandboxId, testAttempt, testSource);
	const engineerRepository = sdkPublishedRepository(host.workspace, engineer.lifecycleOutput.sandboxId, engineerAttempt, engineerSource);
	assert.equal(testRepository, engineerRepository, 'ACCEPTANCE_SDK_NATIVE_TEST_CHAIN: Source security domain changed');
	const writer = final('acting', 'document-change'), writerReview = final('reviewing', 'document-change'), engineerReview = final('reviewing', 'implement-change');
	assert.ok(writer && writerReview && engineerReview, 'ACCEPTANCE_SDK_INTEGRATION: Complete approved predecessor chain required');
	const writerAttempt = assignmentAttemptSchema.parse(writer.assignmentAttempt), writerResult = assignmentResultSchema.parse(writer.assignmentResult);
	const writerSource = writer.lifecycleOutput?.sourceReference;
	assert.ok(writerSource?.kind === 'git' && writerSource.repository === source.repository);
	const approved = (owner: typeof actor, review: typeof reviewer, exact: typeof source) => {
		const attempt = assignmentAttemptSchema.parse(owner.assignmentAttempt), result = assignmentResultSchema.parse(owner.assignmentResult);
		const reviewing = assignmentAttemptSchema.parse(review.assignmentAttempt), reviewed = assignmentResultSchema.parse(review.assignmentResult);
		assert.equal(result.assignmentId, attempt.id); assert.equal(reviewed.assignmentId, reviewing.id);
		assert.equal(result.status, 'completed'); assert.equal(reviewed.status, 'completed');
		assert.equal(review.lifecycleOutput?.activityCompletion?.reviewDisposition, 'approved');
		assert.notEqual(reviewing.agentClass, attempt.agentClass); assert.notEqual(reviewing.id, attempt.id);
		for (const value of [attempt, reviewing]) {
			assert.equal(value.teamId, actorAttempt.teamId); assert.equal(value.projectId, actorAttempt.projectId); assert.equal(value.workdayId, id);
		}
		assert.ok(result.references.some(ref => ref.kind === 'git' && ref.repository === exact.repository && ref.commit === exact.commit));
		assert.ok(reviewing.predecessorResultIds.includes(result.id));
		assert.ok(reviewing.contextRefs.some(ref => ref.store === 'git' && ref.repository === exact.repository && ref.commit === exact.commit));
		assert.ok(Date.parse(result.completedAt) <= Date.parse(reviewing.createdAt));
		return reviewed;
	};
	const approvedEngineering = approved(engineer, engineerReview, engineerSource), approvedWriting = approved(writer, writerReview, writerSource);
	for (const [next, predecessor, decision, exact] of [[writerAttempt, engineerResult, approvedEngineering, engineerSource],
		[actorAttempt, writerResult, approvedWriting, writerSource]] as const) {
		verifySdkReviewedSourceInput(next, predecessor, decision, exact);
	}
	assert.equal(sdkPublishedRepository(host.workspace, writer.lifecycleOutput.sandboxId, writerAttempt, writerSource), testRepository);
	assert.equal(sdkPublishedRepository(host.workspace, actor.lifecycleOutput.sandboxId, actorAttempt, source), testRepository);
	const committedTests = verifySdkCommittedTests(testRepository, frozenBase, testSource.commit, engineerSource.commit,
		{ writer: writerSource.commit, release: source.commit, writerBase: writerAttempt.workspace.mode === 'git' ? writerAttempt.workspace.baseCommit : '' });
	assert.ok(committedTests.length > 0);
	const baseReplay = await verifySdkBaseRed(testRepository, frozenBase, testSource.commit, engineerSource.commit);
	verifySdkApprovedTestOutputs(tester, engineer, original.executionEvents, testSource.commit, engineerSource.commit, committedTests, baseReplay);
	assert.deepEqual(read(['host', 'sandbox', 'status']).workspace.journals, host.workspace.journals,
		'ACCEPTANCE_SDK_NATIVE_TEST_CHAIN: Original owning publication journals changed during Git verification');
	for (const result of [actorResult, reviewResult]) {
		for (const command of sdkReleaseCommands) {
			const records = result.verification.filter(record => record.command === command);
			assert.ok(records.length > 0 && records.every(record => record.status === 'passed' && record.exitCode === 0
				&& Number.isInteger(record.durationSeconds) && Number.isFinite(record.durationSeconds) && record.durationSeconds! >= 0),
				'ACCEPTANCE_SDK_RELEASE_GATE: Each participant must actually replay both public release commands');
		}
		const archive = result.verification.filter(record => isSdkArchiveCommand(record.command));
		assert.ok(archive.length > 0 && archive.every(record => record.status === 'passed' && record.exitCode === 0
			&& Number.isInteger(record.durationSeconds) && Number.isFinite(record.durationSeconds) && record.durationSeconds! >= 0));
		assert.ok(result.verification.every(record => record.status === 'passed' && record.exitCode === 0), 'ACCEPTANCE_SDK_RELEASE_GATE: Failed observations cannot pass');
	}
	for (const item of full) assert.deepEqual(read(['assignments', 'show', item.id]), item, 'ACCEPTANCE_SDK_CUSTODY: Public evidence changed during read-back');
	assert.deepEqual(read(proposalArgs), proposal, 'ACCEPTANCE_SDK_PROPOSAL: Stored proposal changed during independent read-back');
	assert.deepEqual(read(libraryArgs), library, 'ACCEPTANCE_SDK_PROPOSAL: Library binding changed during read-back');
	assert.deepEqual(read(contentArgs), content, 'ACCEPTANCE_SDK_PROPOSAL: Original content changed during read-back');
	assert.deepEqual(read(teamLibraryArgs), teamLibrary, 'ACCEPTANCE_SDK_POPULATED_PROPOSAL: Team Library changed during read-back');
	for (const observation of referenceReads) assert.deepEqual(read(observation.args), observation.value,
		'ACCEPTANCE_SDK_POPULATED_PROPOSAL: Referenced native content changed during read-back');
	assert.deepEqual(read(['workdays', 'show', id]).run, run, 'ACCEPTANCE_SDK_CUSTODY: Workday evidence changed during read-back');
	assert.deepEqual(sdkGoldenExecutionEvents(read, id, run.teamId), original.executionEvents,
		'ACCEPTANCE_SDK_RELEASE_OUTPUT: Original diagnostic history changed during verification');
	assert.deepEqual(sdkGoldenFrozenProposal(freeze), original.initialProposal, 'ACCEPTANCE_SDK_FROZEN_REQUEST: Original proposal input changed during verification');
	assert.equal(readFileSync(freezePath, 'utf8'), freezeBytes, 'ACCEPTANCE_SDK_FREEZE: Original freeze bytes changed');
});
