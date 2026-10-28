import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { SandboxRunnerFixture as Fixture } from '../support/sandbox-runner-program.js';
import { CapacityChannelFixtures as Channel } from '../support/capacity-channel-program.js';
import { CapacityFixtures as Capacity } from '../support/capacity-contract-program.js';
class SandboxRunnerUnit {
  positive(): void {
    const binding = Fixture.binding();
    for (const operation of ['ready', 'run', 'cancel'])
      binding.assertRequest(
        Fixture.request(Fixture.frame(operation)),
        Fixture.grant,
        Capacity.process,
        1000,
      );
  }
  preparation(): void {
    const binding = Fixture.binding();
    binding.assertGrant(Fixture.request(), Fixture.grant, 1000);
    assert.throws(binding.assertRequest.bind(binding, Fixture.request(), Fixture.grant, {}, 1000));
    for (const now of [-1, NaN, 10000])
      assert.throws(binding.assertGrant.bind(binding, Fixture.request(), Fixture.grant, now));
    assert.throws(
      binding.assertRequest.bind(
        binding,
        Fixture.request(Fixture.frame('run')),
        { ...Fixture.grant, expiresAtEpochMs: 3000 },
        Capacity.process,
        1000,
      ),
    );
  }
  shapes(): void {
    const schema = Fixture.schema('request');
    for (const frame of [
      Channel.request('worker'),
      Channel.request('worker', 'reserve', {}),
      { ...Fixture.frame(), command: '/bin/sh' },
    ])
      assert.equal(schema.safeParse(Fixture.request(frame)).success, false);
    assert.equal(
      schema.safeParse({ ...Fixture.request(), hostPath: '/run/runtime' }).success,
      false,
    );
    assert.equal(
      Fixture.schema('grant').safeParse({ ...Fixture.grant, credential: 'never-portable' }).success,
      false,
    );
    assert.equal(
      Fixture.schema('grant').safeParse({ ...Fixture.grant, operations: ['ready', 'ready'] })
        .success,
      false,
    );
  }
  scopes(): void {
    const binding = Fixture.binding();
    for (const request of [
      { ...Fixture.request(), scope: { ...Fixture.scope, serviceGeneration: 'f'.repeat(64) } },
      { ...Fixture.request(), requestId: 'foreign' },
      Fixture.request({ ...Fixture.frame(), scope: { ...Capacity.scope, project: 'foreign' } }),
      Fixture.request({
        ...Fixture.frame(),
        expectedGeneration: { ...Capacity.process, processGeneration: 'f'.repeat(64) },
      }),
    ])
      assert.throws(
        binding.assertRequest.bind(binding, request, Fixture.grant, Capacity.process, 1000),
      );
  }
  sandbox(): void {
    const binding = Fixture.binding();
    const frame = Fixture.frame('run');
    const dispatch = Reflect.get(frame, 'parameters').request;
    const request = Fixture.request({
      ...frame,
      parameters: { request: { ...dispatch, lease: Capacity.lease } },
    });
    assert.throws(
      binding.assertRequest.bind(binding, request, Fixture.grant, Capacity.process, 1000),
    );
  }
  grants(): void {
    const binding = Fixture.binding();
    for (const grant of [
      { ...Fixture.grant, state: 'revoked' },
      { ...Fixture.grant, expiresAtEpochMs: 1000 },
      { ...Fixture.grant, operations: ['cancel'] },
      { ...Fixture.grant, capacityScope: { ...Capacity.scope, platformProfile: 'foreign' } },
      { ...Fixture.grant, scope: { ...Fixture.scope, installationId: 'foreign' } },
    ])
      assert.throws(
        binding.assertRequest.bind(binding, Fixture.request(), grant, Capacity.process, 1000),
      );
  }
  reply(): void {
    const binding = Fixture.binding();
    for (const reply of [
      { ...Fixture.reply(), requestId: 'foreign' },
      { ...Fixture.reply(), sandboxId: 'sandbox-22222222-2222-4222-8222-222222222222' },
      { ...Fixture.reply(), scope: { ...Fixture.scope, providerGeneration: 'f'.repeat(64) } },
      Fixture.reply({ ...Channel.reply('runner'), requestId: 'foreign' }),
      Fixture.reply(Channel.reply('worker')),
    ])
      assert.throws(binding.assertResponse.bind(binding, reply, Fixture.request()));
  }
  negative(): void {
    const binding = Fixture.binding();
    const response = {
      ...Fixture.reply(),
      success: false,
      result: null,
      problem: { code: 'SANDBOX_PROVIDER_UNAVAILABLE' },
    };
    binding.assertResponse(response, Fixture.request());
    assert.equal(
      Fixture.schema('response').safeParse({ ...response, result: Channel.reply('runner') })
        .success,
      false,
    );
    assert.equal(
      Fixture.schema('response').safeParse({ ...response, problem: { code: 'raw-secret-canary' } })
        .success,
      false,
    );
  }
}
const suite = new SandboxRunnerUnit();
test(
  'unit: logical host runner bridge admits only matching runner frames',
  suite.positive.bind(suite),
);
test(
  'unit: logical host runner bridge rejects host powers worker frames and portable credentials',
  suite.shapes.bind(suite),
);
test(
  'unit: logical host runner bridge binds every host capacity sandbox and process identity',
  suite.scopes.bind(suite),
);
test(
  'unit: logical host runner bridge enforces fresh explicit operation grants',
  suite.grants.bind(suite),
);
test(
  'unit: logical host runner replies reject outer and nested substitutions',
  suite.reply.bind(suite),
);
test(
  'unit: logical host runner failures carry only null result and fixed safe codes',
  suite.negative.bind(suite),
);

test(
  'unit: host runner preparation admission is separate from actual guest readiness and cannot outlive grants',
  suite.preparation.bind(suite),
);

test(
  'unit: logical host runner cannot dispatch a lease belonging to another sandbox',
  suite.sandbox.bind(suite),
);
