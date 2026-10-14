import { createHash } from 'node:crypto';

/** Controlled metadata only. Native callers supply actual subprocess output and measured elapsed time. */
export function testOutputFixture(identity: string, sourceCommit: string, status: 'passed' | 'failed', stdout: string, stderr = '', durationSeconds = 1) {
  const receipt = { command: 'npm run test:contracts -- --reporter=default --reporter=json', status, exitCode: status === 'passed' ? 0 : 1, durationSeconds,
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
  const report = (failed: boolean) => ({ numTotalTestSuites: 2, numPassedTestSuites: failed ? 1 : 2, numFailedTestSuites: failed ? 1 : 0,
    numPendingTestSuites: 0, numTotalTests: 2, numPassedTests: failed ? 1 : 2, numFailedTests: failed ? 1 : 0, numPendingTests: 0, numTodoTests: 0,
    startTime: 1000, success: !failed, testResults: ['intent', 'baseline'].map((name, index) => ({ name: '/workspace/project/tests/' + name + '.test.ts',
      status: failed && index === 0 ? 'failed' : 'passed', startTime: 1001, endTime: 1003,
      assertionResults: [{ fullName: name + ' controlled assertion', title: name + ' controlled assertion', ancestorTitles: [],
        status: failed && index === 0 ? 'failed' : 'passed', duration: 2, failureMessages: failed && index === 0 ? ['AssertionError: expected true to be false'] : [] }] })) });
  const tester = testOutputFixture('tester', 'a'.repeat(40), 'failed', header + JSON.stringify(report(true)), 'FAIL tests/intent.test.ts > controlled approved assertion\nAssertionError: expected true to be false\n');
  const engineer = testOutputFixture('engineer', 'b'.repeat(40), 'passed', header + JSON.stringify(report(false)));
  return { tester: tester.participant, engineer: engineer.participant, events: [tester.event, engineer.event],
    testerCommit: 'a'.repeat(40), engineerCommit: 'b'.repeat(40), tests: [{ path: 'tests/intent.test.ts' }] };
}
