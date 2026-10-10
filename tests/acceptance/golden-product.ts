import assert from 'node:assert/strict';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

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

function retainedBytes(path: string): Buffer {
	assert.ok(isAbsolute(path) && realpathSync(path) === resolve(path) && lstatSync(path).isFile(),
		'ACCEPTANCE_SDK_WORKDAY: Independent regular retained file required');
	const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	try {
		assert.ok(fstatSync(fd).isFile() && (fstatSync(fd).mode & 0o444) !== 0, 'ACCEPTANCE_SDK_WORKDAY: Readable regular file required');
		return readFileSync(fd);
	} finally { closeSync(fd); }
}
/** Product acceptance consumes the original API receipt; proposal discovery is not invocation authority. */
export function sdkGoldenWorkdayId(read: (args: string[]) => Row, freeze: Row, explicit?: string, freezePath?: string): string {
	assert.ok(freezePath, 'ACCEPTANCE_SDK_WORKDAY: Explicit immutable freeze path required');
	const bytes = retainedBytes(freezePath), receiptPath = `${freezePath}.workday-start.json`, receiptBytes = retainedBytes(receiptPath);
	assert.deepEqual(JSON.parse(bytes.toString('utf8')), freeze, 'ACCEPTANCE_SDK_WORKDAY: Frozen input changed');
	const receipt = JSON.parse(receiptBytes.toString('utf8')) as unknown;
	assert.ok(receipt && typeof receipt === 'object' && !Array.isArray(receipt), 'ACCEPTANCE_SDK_WORKDAY: Original API receipt required');
	const original = receipt as Row, preflight = freeze.preflight, body = freeze.request?.body, id = original.workdayId;
	assert.deepEqual(Object.keys(original).sort(), ['schemaVersion', 'workdayId', 'preflightId', 'preflightDigest', 'startedAt',
		'acceptedExecutionNodeIds', 'assignmentIds', 'reservationIds', 'providerReceiptRefs', 'transactionReceiptId'].sort());
	assert.equal(original.schemaVersion, 'treeseed.workday-start-receipt/v1');
	assert.ok(typeof id === 'string' && /^workday-[a-f0-9-]+$/u.test(id));
	assert.ok(typeof preflight?.id === 'string' && preflight.id.trim() && typeof preflight.teamId === 'string' && preflight.teamId.trim()
		&& typeof preflight.preflightDigest === 'string' && /^sha256:[A-Za-z0-9_-]{43}$/u.test(preflight.preflightDigest));
	assert.equal(original.preflightId, preflight.id); assert.equal(original.preflightDigest, preflight.preflightDigest);
	assert.ok(typeof original.startedAt === 'string' && Number.isFinite(Date.parse(original.startedAt))
		&& typeof original.transactionReceiptId === 'string' && /^workday-start:[A-Za-z0-9_-]{43}$/u.test(original.transactionReceiptId));
	for (const field of ['acceptedExecutionNodeIds', 'assignmentIds', 'reservationIds', 'providerReceiptRefs']) {
		const values: unknown = original[field];
		assert.ok(Array.isArray(values) && values.every(value => typeof value === 'string' && value.trim() === value && value.length > 0)
			&& new Set(values).size === values.length);
	}
	if (explicit) assert.equal(explicit, id, 'ACCEPTANCE_SDK_WORKDAY: Conflicting explicit workday');
	assert.ok(typeof freeze.proposal?.id === 'string' && freeze.proposal.id.trim());
	assert.equal(body?.executionMode, 'simulation'); assert.deepEqual(body.proposalIds, [freeze.proposal.id]);
	assert.ok(Array.isArray(body.projects) && body.projects.length === 1 && typeof body.projects[0] === 'string' && body.projects[0].trim());
	const run = read(['workdays', 'show', id]).run;
	assert.equal(run?.id, id); assert.equal(run.teamId, preflight.teamId); assert.equal(run.executionMode, 'simulation');
	assert.equal(run.status, 'completed'); assert.equal(run.startedAt, original.startedAt);
	assert.deepEqual(run.parameters?.proposalIds, body.proposalIds); assert.deepEqual(run.parameters.scheduledProjectIds, body.projects);
	assert.deepEqual(retainedBytes(freezePath), bytes); assert.deepEqual(retainedBytes(receiptPath), receiptBytes);
	return id;
}
