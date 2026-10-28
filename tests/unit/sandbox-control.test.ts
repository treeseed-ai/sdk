import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { SandboxControlSchemas, SandboxControlBinding } from '../../src/contracts.js';
import { SandboxControlFixture as Fixture } from '../support/sandbox-control-program.js';
class SandboxBindingTests {
  grant(): void {
    assert.equal(
      SandboxControlBinding.assertRequest(Fixture.request(), Fixture.grant, 1000).operation,
      'create',
    );
    for (const grant of [
      { ...Fixture.grant, state: 'revoked' },
      { ...Fixture.grant, expiresAtEpochMs: 1000 },
      { ...Fixture.grant, operations: ['ready'] },
      { ...Fixture.grant, scope: { ...Fixture.scope, serviceId: 'foreign' } },
    ])
      assert.throws(SandboxControlBinding.assertRequest.bind(null, Fixture.request(), grant, 1000));
    assert.equal(
      SandboxControlSchemas.grant.safeParse({ ...Fixture.grant, operations: ['ready', 'ready'] })
        .success,
      false,
    );
  }
  replies(): void {
    const request = SandboxControlSchemas.request.parse(Fixture.request());
    for (const response of [
      { ...(Fixture.reply() as object), requestId: 'foreign' },
      {
        ...(Fixture.reply() as object),
        scope: { ...Fixture.scope, serviceGeneration: 'c'.repeat(64) },
      },
      Fixture.reply('inspect'),
      Fixture.reply('create', {
        ...Fixture.evidence(),
        sandboxId: 'sandbox-22222222-2222-4222-8222-222222222222',
      }),
      Fixture.reply('create', { ...Fixture.evidence(), assignment: Fixture.assignment() }),
    ])
      assert.throws(SandboxControlBinding.assertResponse.bind(null, response, request));
  }
  assignment(): void {
    const request = SandboxControlSchemas.request.parse(
      Fixture.request('assign', {
        sandboxId: Fixture.sandboxId,
        assignmentId: 'assignment:fixture',
        environmentId: 'environment:fixture',
      }),
    );
    assert.equal(
      SandboxControlBinding.assertResponse(Fixture.reply('assign', Fixture.assignment()), request)
        .success,
      true,
    );
    for (const key of ['assignmentId', 'environmentId']) {
      const response = Fixture.reply('assign', { ...Fixture.assignment(), [key]: 'foreign' });
      assert.throws(SandboxControlBinding.assertResponse.bind(null, response, request));
    }
  }
  phases(): void {
    const request = SandboxControlSchemas.request.parse(
      Fixture.request('execute', { sandboxId: Fixture.sandboxId, phase: 'setup' }),
    );
    assert.equal(
      SandboxControlBinding.assertResponse(Fixture.reply('execute', Fixture.receipt()), request)
        .success,
      true,
    );
    assert.throws(
      SandboxControlBinding.assertResponse.bind(
        null,
        Fixture.reply('execute', { ...Fixture.receipt(), phase: 'verification' }),
        request,
      ),
    );
  }
  unsafeResults(): void {
    assert.equal(
      SandboxControlSchemas.response.safeParse(
        Fixture.reply('execute', { ...Fixture.receipt(), output: 'secret' }),
      ).success,
      false,
    );
    assert.equal(
      SandboxControlSchemas.response.safeParse(
        Fixture.reply('execute', { ...Fixture.receipt(), exitCode: 7 }),
      ).success,
      false,
    );
  }
  failure(): void {
    const request = SandboxControlSchemas.request.parse(Fixture.request());
    const failure = {
      ...(Fixture.reply() as object),
      success: false,
      result: null,
      problem: { code: 'SANDBOX_REPAIR_REQUIRED' },
    };
    assert.equal(SandboxControlBinding.assertResponse(failure, request).success, false);
    assert.equal(
      SandboxControlSchemas.response.safeParse({ ...failure, result: Fixture.evidence() }).success,
      false,
    );
    assert.equal(
      SandboxControlSchemas.response.safeParse({
        ...failure,
        problem: { code: 'secret-output-canary' },
      }).success,
      false,
    );
  }
}
const suite = new SandboxBindingTests();
test(
  'unit: sandbox requests require current exact scoped grants and distinct operations',
  suite.grant.bind(suite),
);
test(
  'unit: sandbox replies fence request operation scope resource and virgin identity',
  suite.replies.bind(suite),
);
test(
  'unit: sandbox assignment replies retain exact assignment and environment selection',
  suite.assignment.bind(suite),
);
test(
  'unit: sandbox phase receipts bind phase and exclude output and failed exit codes',
  suite.phases.bind(suite),
);
test(
  'unit: sandbox failures carry only safe fixed problems and no accepted result',
  suite.failure.bind(suite),
);

test(
  'unit: sandbox successful receipts exclude raw output and failed exit claims',
  suite.unsafeResults.bind(suite),
);
