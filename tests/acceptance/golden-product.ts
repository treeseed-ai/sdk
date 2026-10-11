import assert from 'node:assert/strict';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { exactEntityReferenceSchema } from '@treeseed/sdk/agent-capacity';
import { createHash } from 'node:crypto';
import { parse } from 'yaml';

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
export function verifySdkGoldenProduct(assignments: Row[], sourceBase: string, storedProposal: unknown,
	original?: { binding: Row; files: Row }): void {
	const actors = assignments.filter(item => item.status === 'completed'
		&& item.assignmentAttempt?.effectiveProfile?.activity === 'acting');
	const final = (id: string) => actors.filter(item => item.assignmentAttempt.workItemId === id)
		.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).at(-1);
	const release = final('simulate-release');
	assert.ok(release, 'ACCEPTANCE_SDK_RELEASE: Completed release actor required');
	assert.ok(storedProposal && typeof storedProposal === 'object' && !Array.isArray(storedProposal),
		'ACCEPTANCE_SDK_PROPOSAL: Original public proposal record required');
	const governance = storedProposal as Row, provenance = governance.metadata?.contentProvenance;
	assert.ok(provenance && /^repo_[A-Za-z0-9_-]+$/u.test(provenance.repositoryId)
		&& /^[a-f0-9]{40}$/u.test(provenance.commitSha) && /^[a-f0-9]{64}$/u.test(provenance.digest)
		&& typeof provenance.contentPath === 'string' && provenance.contentPath.startsWith('proposals/')
		&& !provenance.contentPath.split('/').some((part: string) => !part || part === '.' || part === '..')
		&& Number.isSafeInteger(governance.activeVersion) && governance.activeVersion > 0
		&& governance.activeContentHash === provenance.digest,
		'ACCEPTANCE_SDK_PROPOSAL: Original exact governed content provenance required');
	assert.ok(original && original.binding?.repositoryId === provenance.repositoryId
		&& original.files?.repoId === provenance.repositoryId && original.files.resolvedRef === provenance.commitSha
		&& Array.isArray(original.files.files) && original.files.files.length === 1,
		'ACCEPTANCE_SDK_PROPOSAL: Independently resolved original library and exact content required');
	const file = original.files.files[0];
	assert.ok(file && file.path === provenance.contentPath && typeof file.content === 'string'
		&& Buffer.byteLength(file.content) <= 1_048_576
		&& createHash('sha256').update(file.content).digest('hex') === provenance.digest,
		'ACCEPTANCE_SDK_PROPOSAL: Original recorded path and raw proposal bytes required');
	const document = file.content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
	assert.ok(document, 'ACCEPTANCE_SDK_PROPOSAL: Original frontmatter required');
	const proposal = parse(document[1], { maxAliasCount: 0 }) as Row;
	assert.deepEqual(proposal, file.frontmatter, 'ACCEPTANCE_SDK_PROPOSAL: Readback contradicts original bytes');
	assert.ok(proposal && typeof proposal === 'object' && !Array.isArray(proposal)
		&& proposal.id === governance.id && proposal.projectId === governance.projectId
		&& proposal.title === governance.title && proposal.summary === governance.summary && proposal.request === governance.body,
		'ACCEPTANCE_SDK_PROPOSAL: Governance index differs from its original content');
	const sourceRef = release.assignmentAttempt.sourceRef;
	assert.ok(sourceRef?.store === 'treedx' && sourceRef.model === 'proposal' && typeof sourceRef.id === 'string' && sourceRef.id,
		'ACCEPTANCE_SDK_PROPOSAL: Release must retain its original proposal authority');
	assert.equal(proposal.id, sourceRef.id, 'ACCEPTANCE_SDK_PROPOSAL: Public proposal differs from the executed authority');
	assert.equal(proposal.projectId, release.assignmentAttempt.projectId, 'ACCEPTANCE_SDK_PROPOSAL: Public proposal belongs to another project');
	assert.equal(proposal.title, 'Select accepted decisions in portable workday intent',
		'ACCEPTANCE_SDK_PROPOSAL: Stored title differs from the fixed SDK proposal');
	assert.equal(proposal.summary, 'Prove the SDK can express high-level decision-governed execution while keeping all derived execution state API-owned.',
		'ACCEPTANCE_SDK_PROPOSAL: Stored summary differs from the fixed SDK proposal');
	assert.ok(Array.isArray(proposal.evidenceRefs), 'ACCEPTANCE_SDK_PROPOSAL: Original source issue evidence required');
	const sourceEvidence = proposal.evidenceRefs.filter((ref: unknown) => ref && typeof ref === 'object'
		&& !Array.isArray(ref) && (ref as Row).url === 'https://github.com/treeseed-ai/sdk/issues/299');
	assert.equal(sourceEvidence.length, 1, 'ACCEPTANCE_SDK_PROPOSAL: One unambiguous original SDK source issue required');
	const issue = exactEntityReferenceSchema.safeParse(sourceEvidence[0]);
	assert.ok(issue.success && issue.data.store === 'url' && issue.data.model === 'issue',
		'ACCEPTANCE_SDK_PROPOSAL: Canonical original SDK source issue reference required');
	// Check the original public proposal, not the derived graph node counts.
	// Genuine estimate provenance and generated review readiness have separate gates.
	const authored = proposal.executionPlan?.workItems;
	const fixedRows = [
		['research-context', 'researcher', 'treedx'], ['architecture-contract', 'architect', 'treedx'],
		['tests-first', 'tester', 'git'], ['implement-change', 'engineer', 'git'],
		['document-change', 'technical-writer', 'git'], ['simulate-release', 'releaser', 'git'],
	] as const;
	assert.ok(Array.isArray(authored) && authored.length === fixedRows.length
		&& authored.every(item => item && typeof item === 'object' && !Array.isArray(item))
		&& new Set(authored.map(item => item.id)).size === fixedRows.length,
		'ACCEPTANCE_SDK_GRAPH: Six unique original authored work items required');
	for (const [id, agentClass, workspace] of fixedRows) {
		const item = authored.find(row => row.id === id);
		assert.ok(item && item.agentClass === agentClass && item.workspace === workspace
			&& item.activity === 'acting' && item.review === 'required' && item.maximumReviewCycles === 2
			&& Array.isArray(item.dependsOn) && item.dependsOn.length === 0,
			`ACCEPTANCE_SDK_GRAPH: Original ${id} class workspace dependencies and review policy required`);
	}
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
