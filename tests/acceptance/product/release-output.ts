import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

type Row = Record<string, any>;
const code = 'ACCEPTANCE_SDK_RELEASE_OUTPUT';
export const sdkReleaseCommands = ['npm run release:verify', 'npm pack'] as const;
export function isSdkArchiveCommand(command: unknown): command is string {
	return typeof command === 'string' && /^npm run standards:acceptance -- --archive (?:\.\/)?[a-zA-Z0-9][a-zA-Z0-9._-]*\.tgz$/u.test(command);
}

/** Read only original protected runner observations through the authorized API. */
export function verifySdkReleaseOutputs(actor: Row, reviewer: Row, events: unknown, commit: string): void {
	assert.ok(Array.isArray(events), `${code}: Complete original execution events required`);
	assert.ok(events.every(event => event && typeof event === 'object' && !Array.isArray(event)), `${code}: Malformed original event`);
	const digests: string[] = [];
	for (const participant of [actor, reviewer]) {
		const attempt = participant.assignmentAttempt, records = participant.assignmentResult.verification as Row[];
		const original: Row[] = events.filter((event: Row) => event.assignmentId === attempt.id && event.eventType === 'provider.execution.completed');
		assert.equal(original.length, 1, `${code}: One original execution event per independent participant required`);
		const event = original[0] as Row, payload = event.protectedPayload;
		assert.ok(event.runId === attempt.workdayId && event.teamId === attempt.teamId && event.status === 'completed'
			&& payload && typeof payload === 'object' && payload.sourceCommit === commit
			&& Array.isArray(payload.verificationObservations) && Array.isArray(payload.verificationRecords),
			`${code}: Original candidate and protected runner outputs required`);
		assert.ok([...payload.verificationRecords, ...payload.verificationObservations].every(record =>
			record && typeof record === 'object' && !Array.isArray(record)), `${code}: Malformed original command observation`);
		const archives = records.filter(record => isSdkArchiveCommand(record.command));
		assert.equal(archives.length, 1, `${code}: One current-directory archive inspection required`);
		const outputs = new Map<string, string>();
		for (const command of [...sdkReleaseCommands, String(archives[0]!.command)]) {
			const receipts = records.filter(record => record.command === command);
			assert.equal(receipts.length, 1, `${code}: Required command must be independently measured once`);
			const receipt = receipts[0]!;
			assert.ok(receipt.status === 'passed' && receipt.exitCode === 0, `${code}: Actual successful command required`);
			const protectedRecords = payload.verificationRecords.filter((record: Row) => record.command === command);
			assert.deepEqual(protectedRecords, [receipt], `${code}: Canonical receipt differs from original runner record`);
			const observed = payload.verificationObservations.filter((record: Row) => record.command === command);
			assert.equal(observed.length, 1, `${code}: Missing or duplicated original output`);
			const { stdout, stderr, ...measured } = observed[0] as Row;
			assert.ok(typeof stdout === 'string' && typeof stderr === 'string', `${code}: Original output bytes required`);
			assert.deepEqual(measured, receipt, `${code}: Output belongs to another measured command`);
			assert.equal(receipt.outputDigest, `sha256:${createHash('sha256').update(JSON.stringify({ stderr, stdout })).digest('hex')}`,
				`${code}: Original output digest mismatch`);
			outputs.set(command, stdout);
		}
		digests.push(sdkPackedArchiveDigest(outputs.get('npm pack')!, outputs.get(String(archives[0]!.command))!, String(archives[0]!.command)));
	}
	assert.equal(digests[0], digests[1], `${code}: Independent participants inspected different archive bytes`);
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
