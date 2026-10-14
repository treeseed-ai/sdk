import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

type Row = Record<string, any>;
const code = 'ACCEPTANCE_SDK_RELEASE_OUTPUT';
export const sdkReleaseCommands = ['npm run release:verify', 'npm pack'] as const;
export const sdkNativeTestCommand = 'npm run test:contracts -- --reporter=default --reporter=json';
export function isSdkArchiveCommand(command: unknown): command is string {
	return typeof command === 'string' && /^npm run standards:acceptance -- --archive (?:\.\/)?[a-zA-Z0-9][a-zA-Z0-9._-]*\.tgz$/u.test(command);
}
function object(value: unknown): Row {
	assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${code}: Original object required`);
	return value as Row;
}

/** One original producer boundary for release and approved-test command observations. */
function originalSdkOutput(participant: Row, events: unknown, commit: string, command: string, status: 'passed' | 'failed') {
	const attempt = object(participant.assignmentAttempt), records = object(participant.assignmentResult).verification;
	for (const key of ['id', 'teamId', 'projectId', 'workdayId']) assert.ok(typeof attempt[key] === 'string' && attempt[key].trim(), `${code}: Exact original assignment scope required`);
	assert.ok(Array.isArray(events) && events.every(event => event && typeof event === 'object' && !Array.isArray(event)), `${code}: Complete original execution events required`);
	assert.ok(Array.isArray(records) && records.every(value => value && typeof value === 'object' && !Array.isArray(value)), `${code}: Canonical measured inventory required`);
	const original = events.filter(event => event.assignmentId === attempt.id && event.eventType === 'provider.execution.completed');
	assert.equal(original.length, 1, `${code}: One original execution event per independent participant required`);
	const event = object(original[0]), payload = object(event.protectedPayload);
	assert.ok(event.runId === attempt.workdayId && event.teamId === attempt.teamId && event.status === 'completed'
		&& payload.sourceCommit === commit && Array.isArray(payload.verificationObservations) && Array.isArray(payload.verificationRecords),
		`${code}: Original candidate and protected runner outputs required`);
	assert.ok([...payload.verificationRecords, ...payload.verificationObservations].every(record => record && typeof record === 'object' && !Array.isArray(record)), `${code}: Malformed original command observation`);
	const receipts = records.filter(record => record.command === command); assert.equal(receipts.length, 1, `${code}: Required command must be independently measured once`);
	const receipt = receipts[0]!;
	assert.ok(receipt.status === status && receipt.exitCode === (status === 'passed' ? 0 : 1)
		&& Number.isSafeInteger(receipt.durationSeconds) && receipt.durationSeconds >= 0, `${code}: Actual measured command required`);
	assert.deepEqual(payload.verificationRecords.filter((record: Row) => record.command === command), [receipt], `${code}: Canonical receipt differs from original runner record`);
	const observed = payload.verificationObservations.filter((record: Row) => record.command === command);
	assert.equal(observed.length, 1, `${code}: Missing or duplicated original output`);
	const { stdout, stderr, ...measured } = object(observed[0]);
	assert.ok(typeof stdout === 'string' && typeof stderr === 'string', `${code}: Original output bytes required`);
	assert.deepEqual(measured, receipt, `${code}: Output belongs to another measured command`);
	assert.equal(receipt.outputDigest, `sha256:${createHash('sha256').update(JSON.stringify({ stderr, stdout })).digest('hex')}`, `${code}: Original output digest mismatch`);
	return { stdout, stderr };
}

/** Read only original protected runner observations through the authorized API. */
export function verifySdkReleaseOutputs(actor: Row, reviewer: Row, events: unknown, commit: string): void {
	const digests: string[] = [];
	for (const participant of [actor, reviewer]) {
		const records = object(participant.assignmentResult).verification;
		assert.ok(Array.isArray(records), `${code}: Complete release command inventory required`);
		const archives = records.filter(record => isSdkArchiveCommand(record.command));
		assert.equal(archives.length, 1, `${code}: One current-directory archive inspection required`);
		const outputs = new Map<string, string>();
		for (const command of [...sdkReleaseCommands, String(archives[0]!.command)])
			outputs.set(command, originalSdkOutput(participant, events, commit, command, 'passed').stdout);
		digests.push(sdkPackedArchiveDigest(outputs.get('npm pack')!, outputs.get(String(archives[0]!.command))!, String(archives[0]!.command)));
	}
	assert.equal(digests[0], digests[1], `${code}: Independent participants inspected different archive bytes`);
}

/** The owning Vitest reporter supplies assertion identities/status/timing; no exit-zero inference. */
function nativeTestReport(stdout: string, passed: boolean): Map<string, { path: string; status: string }> {
	const label = 'ACCEPTANCE_SDK_APPROVED_TESTS';
	const clean = stdout.replace(/\u001b\[[0-9;]*m/gu, '');
	const json = clean.split(/\r?\n/u).filter(line => line.startsWith('{"numTotalTestSuites":'));
	assert.equal(json.length, 1, `${label}: One complete native assertion report required`);
	const report = object(JSON.parse(json[0]!)); assert.equal(report.success, passed, label);
	const roots = [...clean.matchAll(/^\s*RUN\s+v\S+\s+(\/[^\r\n]+)$/gmu)]; assert.equal(roots.length, 1, `${label}: Original native execution root required`);
	const root = roots[0]![1]!.trim();
	for (const key of ['numTotalTestSuites', 'numPassedTestSuites', 'numFailedTestSuites', 'numPendingTestSuites', 'numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests', 'numTodoTests'])
		assert.ok(Number.isSafeInteger(report[key]) && report[key] >= 0, `${label}: Complete native counts required`);
	assert.ok(report.numTotalTests > 0 && report.numTotalTestSuites > 0 && Number.isFinite(report.startTime), label);
	for (const key of ['numPendingTestSuites', 'numPendingTests', 'numTodoTests']) assert.equal(report[key], 0, `${label}: Partial skipped or todo reports denied`);
	assert.equal(report.numPassedTestSuites + report.numFailedTestSuites, report.numTotalTestSuites, label);
	assert.equal(report.numPassedTests + report.numFailedTests, report.numTotalTests, label);
	assert.ok(passed ? report.numFailedTests === 0 : report.numFailedTests > 0, label);
	assert.ok(Array.isArray(report.testResults) && report.testResults.length > 0 && report.testResults.length <= report.numTotalTestSuites, label);
	const files = new Set<string>(), assertions = new Map<string, { path: string; status: string }>(); let successes = 0, failures = 0;
	for (const value of report.testResults) {
		const file = object(value); assert.ok(typeof file.name === 'string' && file.name.startsWith(`${root}/`), label);
		const path = file.name.slice(root.length + 1);
		assert.ok(/^tests\/.+\.(?:test|spec)\.tsx?$/u.test(path) && !path.split('/').some((part: string) => !part || part === '.' || part === '..') && !files.has(path), `${label}: Unique original test files required`);
		files.add(path); assert.ok(Number.isFinite(file.startTime) && Number.isFinite(file.endTime) && file.startTime >= report.startTime && file.endTime >= file.startTime, label);
		assert.ok(Array.isArray(file.assertionResults) && file.assertionResults.length > 0, `${label}: Empty native file denied`);
		let failed = false;
		for (const entry of file.assertionResults) {
			const test = object(entry), id = `${path}\0${test.fullName}`;
			assert.ok(typeof test.fullName === 'string' && test.fullName.trim() && !assertions.has(id)
				&& ['passed', 'failed'].includes(test.status) && Number.isFinite(test.duration) && test.duration >= 0
				&& Array.isArray(test.failureMessages) && test.failureMessages.every((message: unknown) => typeof message === 'string'), label);
			if (test.status === 'failed') { failed = true; failures++; assert.ok(test.failureMessages.some((message: string) => /\bAssertionError\b/u.test(message)), `${label}: Setup or subprocess errors are not test-first RED`); }
			else { successes++; assert.equal(test.failureMessages.length, 0, label); }
			assertions.set(id, { path, status: test.status });
		}
		assert.equal(file.status, failed ? 'failed' : 'passed', label);
	}
	assert.equal(successes, report.numPassedTests, label); assert.equal(failures, report.numFailedTests, label);
	assert.equal(assertions.size, report.numTotalTests, label);
	return assertions;
}

/** Exact committed blobs plus original full RED/GREEN observations prove consumption; semantic BASE intent remains separate. */
export function verifySdkApprovedTestOutputs(tester: Row, engineer: Row, events: unknown, testerCommit: string, engineerCommit: string, committed: readonly { path: string }[]): void {
	const label = 'ACCEPTANCE_SDK_APPROVED_TESTS';
	assert.ok(/^[a-f0-9]{40}$/u.test(testerCommit) && /^[a-f0-9]{40}$/u.test(engineerCommit) && testerCommit !== engineerCommit, label);
	assert.ok(tester.assignmentAttempt.id !== engineer.assignmentAttempt.id, label);
	for (const key of ['teamId', 'projectId', 'workdayId']) assert.equal(tester.assignmentAttempt[key], engineer.assignmentAttempt[key], label);
	assert.ok(Array.isArray(events), label);
	for (const participant of [tester, engineer]) for (const event of events.filter(value => value?.assignmentId === participant.assignmentAttempt.id))
		assert.equal(event.projectId, participant.assignmentAttempt.projectId, label);
	assert.ok(Array.isArray(committed) && committed.length > 0 && new Set(committed.map(file => file.path)).size === committed.length, label);
	const paths = new Set(committed.filter(file => /\.(?:test|spec)\.tsx?$/u.test(file.path)).map(file => file.path)); assert.ok(paths.size > 0, label);
	const red = nativeTestReport(originalSdkOutput(tester, events, testerCommit, sdkNativeTestCommand, 'failed').stdout, false);
	const green = nativeTestReport(originalSdkOutput(engineer, events, engineerCommit, sdkNativeTestCommand, 'passed').stdout, true);
	assert.deepEqual([...green.keys()].sort(), [...red.keys()].sort(), `${label}: Engineer must execute the same complete assertion inventory`);
	for (const path of paths) assert.ok([...red.values()].some(test => test.path === path), `${label}: Approved committed test omitted from native discovery`);
	for (const test of red.values()) if (test.status === 'failed') assert.ok(paths.has(test.path), `${label}: Unrelated BASE failures remain unaccepted`);
}
export function sdkGoldenExecutionEvents(read: (args: string[]) => Row, workday: string, team: string): Row[] {
	const events: Row[] = [], cursors = new Set<string>(), ids = new Set<string>();
	let cursor: string | undefined;
	for (let page = 0; page < 40; page += 1) {
		const result = read(['workdays', 'events', 'list', workday, '--diagnostics', 'full', '--limit', '50', ...(cursor ? ['--cursor', cursor] : [])]);
		assert.ok(result && Array.isArray(result.items) && typeof result.page?.hasMore === 'boolean', `${code}: Complete diagnostic page required`);
		for (const event of result.items) {
			assert.ok(event && typeof event.id === 'string' && event.id && !ids.has(event.id)
				&& event.runId === workday && event.teamId === team, `${code}: Duplicate or foreign diagnostic event`);
			ids.add(event.id); events.push(event);
		}
		if (!result.page.hasMore) return events;
		const next: unknown = result.page.nextCursor;
		assert.ok(typeof next === 'string' && next && !cursors.has(next),
			`${code}: Missing or repeated diagnostic cursor`);
		cursor = next; cursors.add(next);
	}
	assert.fail(`${code}: Incomplete diagnostic inventory`);
}

/** Parse outputs of the existing native pack and standards archive boundary. */
export function sdkPackedArchiveDigest(packed: string, inspectionOutput: string, command: string): string {
	assert.ok(isSdkArchiveCommand(command), `${code}: Exact public standards archive command required`);
	const lines = packed.trimEnd().split(/\r?\n/u), filenames = lines.filter(line => /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.tgz$/u.test(line));
	assert.ok(filenames.length === 1 && lines.at(-1) === filenames[0], `${code}: npm pack must produce one final current-directory archive`);
	const filename = filenames[0]!;
	assert.equal(command.replace('npm run standards:acceptance -- --archive ', '').replace(/^\.\//u, ''), filename,
		`${code}: Inspection did not consume the actual npm pack output`);
	let inspection: Row | undefined;
	try { inspection = JSON.parse(inspectionOutput.trimEnd().split(/\r?\n/u).at(-1)!); } catch { /* Fail below with original evidence intact. */ }
	assert.ok(inspection && inspection.ok === true && typeof inspection.archiveDigest === 'string'
		&& /^sha256:[a-f0-9]{64}$/u.test(inspection.archiveDigest) && Number.isSafeInteger(inspection.declarations)
		&& inspection.declarations > 0 && Number.isSafeInteger(inspection.exportTargets) && inspection.exportTargets > 0,
		`${code}: Actual public standards archive inspection required`);
	return inspection.archiveDigest;
}
