import { createHash } from 'node:crypto';

/** Controlled metadata only. Native callers supply actual subprocess output and measured elapsed time. */
export function testOutputFixture(identity: string, sourceCommit: string, status: 'passed' | 'failed', stdout: string, stderr = '', durationSeconds = 1) {
  const receipt = { command: 'npm run test:contracts', status, exitCode: status === 'passed' ? 0 : 1, durationSeconds,
    outputDigest: 'sha256:' + createHash('sha256').update(JSON.stringify({ stderr, stdout })).digest('hex') };
  const participant = { assignmentAttempt: { id: identity, teamId: 'controlled-team', projectId: 'controlled-sdk', workdayId: 'controlled-workday' },
    assignmentResult: { verification: [receipt] } };
  const event = { id: identity + '-execution', assignmentId: identity, runId: 'controlled-workday', teamId: 'controlled-team', projectId: 'controlled-sdk',
    eventType: 'provider.execution.completed', status: 'completed', protectedPayload: { sourceCommit,
      verificationRecords: [structuredClone(receipt)], verificationObservations: [{ ...receipt, stdout, stderr }] } };
  return { participant, event };
}

export function approvedOutputFixture() {
  const header = ' RUN v4.1.10 /workspace/project\n';
  const failed = header + ' ❯ tests/intent.test.ts (1 test | 1 failed) 3ms\n ✓ tests/baseline.test.ts (1 test) 2ms\nTest Files  1 failed | 1 passed (2)\nTests  1 failed | 1 passed (2)\n';
  const passed = header + ' ✓ tests/intent.test.ts (1 test) 3ms\n ✓ tests/baseline.test.ts (1 test) 2ms\nTest Files  2 passed (2)\nTests  2 passed (2)\n';
  const tester = testOutputFixture('tester', 'a'.repeat(40), 'failed', failed, 'FAIL tests/intent.test.ts > controlled approved assertion\nAssertionError: expected true to be false\n');
  const engineer = testOutputFixture('engineer', 'b'.repeat(40), 'passed', passed);
  return { tester: tester.participant, engineer: engineer.participant, events: [tester.event, engineer.event],
    testerCommit: 'a'.repeat(40), engineerCommit: 'b'.repeat(40), tests: [{ path: 'tests/intent.test.ts' }] };
}
