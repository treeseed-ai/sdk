import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { CapacityChannelFixtures as Fixture } from '../support/capacity-channel-program.js';
import { CapacityProtocolFixtures as Protocol } from '../support/capacity-protocol-program.js';
import { CapacityFixtures as Capacity } from '../support/capacity-contract-program.js';
class CapacityChannelUnit {
  discovery(): void {
    const request = { ...Fixture.request(), expectedGeneration: null };
    Fixture.binding().assertRequest(request, Fixture.context());
    Fixture.binding().assertResponse(Fixture.reply(), request);
    const reserve = Fixture.request('worker', 'reserve', { request: Protocol.request });
    assert.equal(
      Fixture.schema('request').safeParse({ ...reserve, expectedGeneration: null }).success,
      false,
    );
  }
  roles(): void {
    for (const request of [
      Fixture.request('manager'),
      Fixture.request('worker', 'run', { request: Protocol.dispatch }),
      Fixture.request('runner', 'reserve', { request: Protocol.request }),
      Fixture.request('runner', 'dispatch', { request: Protocol.dispatch }),
    ])
      assert.equal(Fixture.schema('request').safeParse(request).success, false);
  }
  admission(): void {
    const binding = Fixture.binding();
    for (const change of [
      { scope: { ...Fixture.scope, project: 'foreign' } },
      { role: 'runner' },
      { expectedGeneration: { ...Fixture.generation, processGeneration: 'f'.repeat(64) } },
    ])
      assert.throws(
        binding.assertRequest.bind(binding, { ...Fixture.request(), ...change }, Fixture.context()),
      );
  }
  reserve(): void {
    const binding = Fixture.binding();
    for (const change of [
      { scope: { ...Fixture.scope, workerId: 'foreign' } },
      { expectedWorker: { ...Fixture.generation, compositionGeneration: 'f'.repeat(64) } },
    ]) {
      const request = Fixture.request('worker', 'reserve', {
        request: { ...Protocol.request, ...change },
      });
      assert.throws(binding.assertRequest.bind(binding, request, Fixture.context()));
    }
  }
  leases(): void {
    const binding = Fixture.binding();
    for (const role of ['worker', 'runner']) {
      const generations = {
        ...Capacity.generations,
        [role]: { ...Fixture.generation, processGeneration: 'f'.repeat(64) },
      };
      const lease = { ...Capacity.lease, generations };
      const request = Fixture.request(role, role === 'worker' ? 'dispatch' : 'run', {
        request: { ...Protocol.dispatch, lease },
      });
      assert.throws(binding.assertRequest.bind(binding, request, Fixture.context(role)));
      assert.throws(
        binding.assertRequest.bind(
          binding,
          Fixture.request(role, 'cancel', { lease }),
          Fixture.context(role),
        ),
      );
    }
  }
  reply(): void {
    const binding = Fixture.binding();
    for (const change of [
      { requestId: 'foreign' },
      { scope: { ...Fixture.scope, platformProfile: 'foreign' } },
      { generation: { ...Fixture.generation, processGeneration: 'f'.repeat(64) } },
      { role: 'runner' },
    ])
      assert.throws(
        binding.assertResponse.bind(binding, { ...Fixture.reply(), ...change }, Fixture.request()),
      );
  }
  outcome(): void {
    const request = Fixture.request('runner', 'run', { request: Protocol.dispatch });
    const binding = Fixture.binding();
    const result = { ...Protocol.runner, lease: { ...Capacity.lease, sandboxId: 'foreign' } };
    assert.throws(
      binding.assertResponse.bind(binding, Fixture.reply('runner', 'run', result), request),
    );
    const reserve = Fixture.request('worker', 'reserve', { request: Protocol.request });
    const reservation = {
      ...Protocol.reservation,
      request: { ...Protocol.request, requestId: 'foreign' },
    };
    assert.throws(
      binding.assertResponse.bind(
        binding,
        Fixture.reply('worker', 'reserve', reservation),
        reserve,
      ),
    );
  }
  nestedGeneration(): void {
    const generation = { ...Fixture.generation, processGeneration: 'f'.repeat(64) };
    const lease = {
      ...Capacity.lease,
      generations: { ...Capacity.generations, runner: generation },
    };
    const request = Fixture.request('runner', 'run', { request: { ...Protocol.dispatch, lease } });
    const reply = Fixture.reply('runner', 'run', { ...Protocol.runner, lease });
    const binding = Fixture.binding();
    assert.throws(binding.assertResponse.bind(binding, reply, request));
  }
  safe(): void {
    const reply = {
      ...Fixture.reply(),
      success: false,
      result: null,
      problem: { code: 'CAPACITY_HANDLER_FAILED', message: 'secret-output-canary' },
    };
    assert.equal(Fixture.schema('response').safeParse(reply).success, false);
    const request = Fixture.request('runner', 'run', {
      request: Protocol.dispatch,
      command: ['/bin/sh'],
    });
    assert.equal(Fixture.schema('request').safeParse(request).success, false);
  }
}
const suite = new CapacityChannelUnit();
test(
  'unit: only authenticated readiness discovery may omit expected process identity',
  suite.discovery.bind(suite),
);
test(
  'unit: capacity worker and guest operation sets are positive and disjoint',
  suite.roles.bind(suite),
);
test(
  'unit: service admission binds full scope role and actual process generation',
  suite.admission.bind(suite),
);
test(
  'unit: reserve parameters bind the actual worker scope and generation',
  suite.reserve.bind(suite),
);
test('unit: dispatch run and cancellation bind the exact leased process', suite.leases.bind(suite));
test(
  'unit: capacity channel replies bind request scope role and generation',
  suite.reply.bind(suite),
);
test(
  'unit: nested reservation and outcome identities cannot escape reply binding',
  suite.outcome.bind(suite),
);
test(
  'unit: service envelopes reject arbitrary commands and unsafe provider text',
  suite.safe.bind(suite),
);

test(
  'unit: reply admission independently rejects a lease from another guest process',
  suite.nestedGeneration.bind(suite),
);
