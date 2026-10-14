import * as nativeOutputs from '../../../acceptance/product/release-output.ts';
import { approvedOutputFixture } from './test-output-fixture.ts';
import { expect, it } from 'vitest';
import { sdkPublishedRepository, sdkDocumentationBody, verifySdkCommittedTests, verifySdkReviewedSourceInput, type PublishedSourceAttempt } from '../../../acceptance/product/test-chain.ts';

it('retains original frozen fan-in integration base while requiring both exact predecessor results and completed independent review', () => {
	const next = { workspace: { mode: 'git' as const, repository: 'treeseed-ai/sdk', baseCommit: 'a'.repeat(40), branch: 'simulation/release', writablePaths: ['.'] },
		predecessorResultIds: ['writer-result', 'writer-review', 'engineer-result'], createdAt: '2026-10-13T03:00:01.000Z' };
	const predecessor = { id: 'writer-result' }, review = { id: 'writer-review', completedAt: '2026-10-13T03:00:00.000Z' };
	const source = { kind: 'git' as const, repository: 'treeseed-ai/sdk', commit: 'b'.repeat(40) }, held = structuredClone(next);
	expect(() => verifySdkReviewedSourceInput(next, predecessor, review, source)).not.toThrow();
	expect(next).toEqual(held);
	for (const change of [
		(value: typeof next) => { value.predecessorResultIds = ['writer-result']; },
		(value: typeof next) => { value.predecessorResultIds = ['writer-review']; },
		(value: typeof next) => { value.workspace.repository = 'foreign'; },
		(value: typeof next) => { value.createdAt = '2026-10-13T02:59:59.000Z'; },
	]) {
		const value = structuredClone(next); change(value); const failed = structuredClone(value);
		expect(() => verifySdkReviewedSourceInput(value, predecessor, review, source)).toThrow(); expect(value).toEqual(failed);
	}
});

it('denies malformed reviewed integration identities before opening a native repository', () => {
  const verify = (nativeOutputs as unknown as Record<string, unknown>).verifySdkApprovedTestOutputs;
  expect(typeof verify).toBe('function'); if (typeof verify !== 'function') throw new Error('Native approved-test output proof is missing');
  const exact = approvedOutputFixture(), held = structuredClone(exact);
  verify(exact.tester, exact.engineer, exact.events, exact.testerCommit, exact.engineerCommit, exact.tests); expect(exact).toEqual(held);
  for (const mode of ['empty', 'duplicate', 'team', 'workday', 'candidate', 'digest', 'missing-record', 'missing-output', 'duration', 'truncated', 'skipped', 'file-omitted', 'duplicate-file', 'total', 'unrelated-base', 'non-assertion', 'changed-count']) {
    const f = approvedOutputFixture(), event = f.events[1]!, payload = event.protectedPayload;
    const output = payload.verificationObservations[0]!;
    if (mode === 'empty') f.events = []; if (mode === 'duplicate') f.events.push(structuredClone(event));
    if (mode === 'team') event.teamId = 'foreign'; if (mode === 'workday') event.runId = 'foreign';
    if (mode === 'candidate') payload.sourceCommit = 'f'.repeat(40); if (mode === 'digest') output.outputDigest = 'sha256:' + 'f'.repeat(64);
    if (mode === 'missing-record') payload.verificationRecords = []; if (mode === 'missing-output') payload.verificationObservations = [];
    if (mode === 'duration') { output.durationSeconds = -1; payload.verificationRecords[0]!.durationSeconds = -1; f.engineer.assignmentResult.verification[0]!.durationSeconds = -1; }
    const parse = (text: string) => JSON.parse(text.split('\n').at(-1)!) as { numTotalTests: number; numPassedTests: number; numPendingTests: number; numTotalTestSuites: number; numPassedTestSuites: number; testResults: Array<{ name: string; assertionResults: Array<{ fullName: string; status: string; duration?: number; failureMessages: string[] }> }> };
    const replaceReport = (o: typeof output, report: ReturnType<typeof parse>) => { o.stdout = o.stdout.slice(0, o.stdout.lastIndexOf('\n') + 1) + JSON.stringify(report); };
    const report = parse(output.stdout);
    if (mode === 'truncated') output.stdout = ' RUN v4.1.10 /workspace/project\n';
    if (mode === 'skipped') { report.numPendingTests = 1; report.numPassedTests = 1; report.testResults[0]!.assertionResults[0]!.status = 'pending'; }
    if (mode === 'file-omitted') report.testResults[0]!.name = '/workspace/project/tests/foreign.test.ts';
    if (mode === 'duplicate-file') { report.testResults.push(structuredClone(report.testResults[0]!)); report.numTotalTests++; report.numPassedTests++; report.numTotalTestSuites++; report.numPassedTestSuites++; }
    if (mode === 'total') report.numTotalTests++;
    if (mode === 'changed-count') { const next = structuredClone(report.testResults[0]!.assertionResults[0]!); next.fullName = 'unapproved extra assertion'; report.testResults[0]!.assertionResults.push(next); report.numTotalTests++; report.numPassedTests++; }
    if (!['truncated', 'unrelated-base', 'non-assertion'].includes(mode)) replaceReport(output, report);
    if (mode === 'unrelated-base') { const o = f.events[0]!.protectedPayload.verificationObservations[0]!, r = parse(o.stdout); r.testResults[0]!.name = '/workspace/project/tests/private.test.ts'; replaceReport(o, r); }
    if (mode === 'non-assertion') { const o = f.events[0]!.protectedPayload.verificationObservations[0]!, r = parse(o.stdout); r.testResults[0]!.assertionResults[0]!.failureMessages = ['TypeError: cannot execute']; replaceReport(o, r); }
    // Rehash coherent output corruptions, so denial cannot depend only on a stale digest.
    for (const [index, participant] of [[0, f.tester], [1, f.engineer]] as const) {
      const p = f.events[index]?.protectedPayload, o = p?.verificationObservations[0];
      if (!p || !o || mode === 'digest') continue;
      o.outputDigest = 'sha256:' + createHash('sha256').update(JSON.stringify({ stderr: o.stderr, stdout: o.stdout })).digest('hex');
      if (p.verificationRecords[0]) p.verificationRecords[0].outputDigest = o.outputDigest;
      participant.assignmentResult.verification[0]!.outputDigest = o.outputDigest;
    }
    const originalFailure = structuredClone(f);
    expect(() => verify(f.tester, f.engineer, f.events, f.testerCommit, f.engineerCommit, f.tests), mode).toThrow(); expect(f).toEqual(originalFailure);
    verify(exact.tester, exact.engineer, exact.events, exact.testerCommit, exact.engineerCommit, exact.tests);
  }

	expect(sdkDocumentationBody(Buffer.from('---\nrevision: 2\n---\n# Usage\nUse the public client.\n<!-- internal -->\n'))).toBe('# Usage\nUse the public client.');
	for (const text of ['', ' \n', '<!-- no instructions -->', '---\nrevision: 2\n---\n']) expect(sdkDocumentationBody(Buffer.from(text))).toBe('');
	for (const bytes of [Buffer.from([255]), Buffer.from('instruction\0binary')]) expect(() => sdkDocumentationBody(bytes)).toThrow('ACCEPTANCE_SDK_NATIVE_TEST_CHAIN');

	const inspect: (repository: string, base: string, tester: string, engineer: string, integration: { writer: string; release: string; writerBase: string }) => unknown = verifySdkCommittedTests;
	for (const commit of [undefined, null, 42, {}, [], '', '--unsafe', 'a'.repeat(39), 'A'.repeat(40), 'a'.repeat(41)]) {
		for (const field of ['writer', 'release', 'writerBase'] as const) {
			const integration = { writer: 'd'.repeat(40), release: 'e'.repeat(40), writerBase: 'c'.repeat(40), [field]: commit }, held = structuredClone(integration);
			expect(() => inspect('/not-an-approved-repository', 'a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40), integration as { writer: string; release: string; writerBase: string })).toThrow('ACCEPTANCE_SDK_NATIVE_TEST_CHAIN');
			expect(integration).toEqual(held);
		}
	}
});

const attempt: PublishedSourceAttempt = { id: 'attempt', teamId: 'team', projectId: 'sdk', attempt: 1, provider: { providerId: 'provider' },
	workspace: { mode: 'git', repository: 'treeseed-ai/sdk', baseCommit: 'a'.repeat(40), branch: 'simulation/tester', writablePaths: ['tests'] } };
const reference = { kind: 'git' as const, repository: 'treeseed-ai/sdk', commit: 'b'.repeat(40), branch: 'simulation/tester' };
const repository = `/var/lib/treeseed/agent/workspaces/simulations/${'c'.repeat(64)}.git`;
function fixture() {
	const entry = (metadata: Record<string, unknown>) => ({ name: 'sandbox-test.json', type: 'file', digest: 'd'.repeat(64), metadata });
	const journals = { jobs: { rootPresent: true, entries: [entry({ schemaVersion: 'treeseed.assignment-source-job/v1', leaseId: 'lease',
		owner: { assignmentId: attempt.id, providerId: 'provider', teamId: 'team', projectId: 'sdk', attempt: 1 } })] },
		results: { rootPresent: true, entries: [entry({ schemaVersion: 'treeseed.source-result/v1', sandboxId: 'sandbox-test', leaseId: 'lease',
			status: 'completed', teardownVerified: true, source: { controlPlaneId: 'control', teamId: 'team', projectId: 'sdk', repositoryId: 'repository',
				commit: 'a'.repeat(40), formatVersion: 1, profile: 'source-only' }, sourceReference: reference, simulationRepository: repository })] } };
	return { complete: true, errors: [] as string[], scope: { storageRoot: '/var/lib/treeseed/agent/workspaces' }, journals,
		confirmation: { journals: structuredClone(journals) } };
}
it.each(['branch', 'repository'] as const)('denies a self-consistent published Git %s outside the original assignment workspace', field => {
	const changed = { ...reference, [field]: field === 'branch' ? 'simulation/foreign' : 'treeseed-ai/foreign' };
	const observation = fixture(); observation.journals.results.entries[0]!.metadata.sourceReference = changed;
	observation.confirmation.journals = structuredClone(observation.journals);
	const retained = structuredClone(observation);
	expect(() => sdkPublishedRepository(observation, 'sandbox-test', attempt, changed)).toThrow();
	expect(observation).toEqual(retained);
	expect(sdkPublishedRepository(fixture(), 'sandbox-test', attempt, reference)).toBe(repository);
});
it('requires complete unchanged public owning source custody and denies every foreign or ambiguous locator before native Git', () => {
	const original = fixture(), before = structuredClone(original);
	expect(sdkPublishedRepository(original, 'sandbox-test', attempt, reference)).toBe(repository); expect(original).toEqual(before);
	const mutations: Array<(value: ReturnType<typeof fixture>) => void> = [
		value => { value.complete = false; }, value => { value.errors.push('unreadable'); },
		value => { value.scope.storageRoot = '/tmp/arbitrary'; }, value => { value.journals.results.rootPresent = false; },
		value => { value.journals.results.entries = []; }, value => { value.journals.results.entries.push(value.journals.results.entries[0]!); },
		value => { value.journals.results.entries[0]!.digest = 'invalid'; }, value => { value.journals.results.entries[0]!.type = 'symlink'; },
		...['assignmentId', 'providerId', 'teamId', 'projectId', 'attempt'].map(field => (value: ReturnType<typeof fixture>) => {
			const owner = value.journals.jobs.entries[0]!.metadata.owner as Record<string, unknown>; owner[field] = field === 'attempt' ? 2 : 'foreign';
		}),
		...['teamId', 'projectId', 'commit'].map(field => (value: ReturnType<typeof fixture>) => {
			const source = value.journals.results.entries[0]!.metadata.source as Record<string, unknown>; source[field] = field === 'commit' ? 'f'.repeat(40) : 'foreign';
		}),
		...['sandboxId', 'leaseId', 'status', 'schemaVersion'].map(field => (value: ReturnType<typeof fixture>) => { value.journals.results.entries[0]!.metadata[field] = 'foreign'; }),
		value => { value.journals.results.entries[0]!.metadata.teardownVerified = false; },
		value => { value.journals.results.entries[0]!.metadata.source = {}; },
		value => { value.journals.results.entries[0]!.metadata.sourceReference = { ...reference, commit: 'e'.repeat(40) }; },
		value => { value.journals.results.entries[0]!.metadata.simulationRepository = '/tmp/arbitrary.git'; },
		value => { value.journals.results.entries[0]!.metadata.simulationRepository = null; },
	];
	for (const mutate of mutations) {
		const denied = fixture(); mutate(denied); denied.confirmation.journals = structuredClone(denied.journals);
		const retained = structuredClone(denied); expect(() => sdkPublishedRepository(denied, 'sandbox-test', attempt, reference)).toThrow();
		expect(denied).toEqual(retained);
	}
	const changed = fixture(); changed.confirmation.journals.results.entries = [];
	expect(() => sdkPublishedRepository(changed, 'sandbox-test', attempt, reference)).toThrow();
	expect(() => sdkPublishedRepository(original, '../sandbox-test', attempt, reference)).toThrow();
	expect(sdkPublishedRepository(original, 'sandbox-test', attempt, reference)).toBe(repository);
});
