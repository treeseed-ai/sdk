import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { ProviderAvailabilityFixture as Fixture } from '../support/provider-availability-program.js';
class ProviderAvailabilitySemantics {
  pressure(mode: string): void {
    const value = structuredClone(Fixture.create);
    if (mode === 'active') Reflect.set(value.runnerPressure, 'activeWorkers', 2);
    if (mode === 'available') value.runnerPressure.availableWorkers = 2;
    if (mode === 'reserved') Reflect.set(value.runnerPressure, 'reservedWorkers', 2);
    if (mode === 'alias') Reflect.set(value.runnerPressure, 'throttleState', 'exhausted');
    assert.equal(Fixture.schemas().create.safeParse(value).success, false);
  }
  create(mode: string): void {
    const value = structuredClone(Fixture.create);
    if (mode === 'legacy') Reflect.set(value, 'executionProviders', []);
    if (mode === 'ttl-low') value.ttlSeconds = 29;
    if (mode === 'ttl-high') value.ttlSeconds = 301;
    if (mode === 'ttl-fraction') value.ttlSeconds = 30.5;
    if (mode === 'duplicate-adapter') value.adapters.push(value.adapters[0]!);
    if (mode === 'missing-lane') value.lanes.pop();
    if (mode === 'duplicate-purpose')
      Reflect.set(value.lanes[1]!, 'purpose', Reflect.get(value.lanes[0]!, 'purpose'));
    if (mode === 'unknown-lane') value.adapters[0]!.laneIds.push('unknown');
    if (mode === 'unreferenced-lane') value.adapters[0]!.laneIds.pop();
    if (mode === 'active-overflow') value.adapters[0]!.activeWorkers = 2;
    if (mode === 'reserved-overflow') Reflect.set(value.lanes[0]!, 'reservedConcurrentWorkers', 2);
    if (mode === 'mutable-build') value.adapters[0]!.runtimeBuild = 'latest';
    if (mode === 'empty-offers') value.adapters[0]!.offers = [];
    if (mode === 'duplicate-offer') value.adapters[0]!.offers.push(value.adapters[0]!.offers[0]!);
    assert.equal(Fixture.schemas().create.safeParse(value).success, false);
  }
  offer(mode: string): void {
    const value = structuredClone(Fixture.offer);
    if (mode === 'unknown') Reflect.set(value, 'execute', 'PRIVATE_OFFER_CANARY');
    if (mode === 'missing-signature') Reflect.deleteProperty(value.conformance[0]!, 'signature');
    if (mode === 'duplicate-capability') value.capabilities.push(value.capabilities[0]!);
    if (mode === 'duplicate-feature')
      Reflect.set(value, 'features', ['probe.feature', 'probe.feature']);
    if (mode === 'bad-digest') value.offerDigest = 'sha256:mutable';
    if (mode === 'context-overflow')
      Reflect.set(value, 'contextCapacity', {
        ...value.contextCapacity,
        mode: 'bounded',
        measurement: 'bytes',
        defaultInitial: 2,
        maximum: 1,
        reservedOutput: 0,
      });
    assert.equal(Fixture.schemas().offer.safeParse(value).success, false);
  }
  session(mode: string): void {
    const value = structuredClone(Fixture.session);
    if (mode === 'sequence') value.snapshot.sequence++;
    if (mode === 'identity') value.membershipId = '';
    if (mode === 'window') value.expiresAt = '2026-10-29T11:00:00.000Z';
    if (mode === 'negative') value.snapshot.availableWorkers = -1;
    if (mode === 'unknown') Reflect.set(value, 'accessToken', 'PRIVATE_TOKEN_CANARY');
    if (mode === 'open-closed') Reflect.set(value, 'closedAt', value.refreshedAt);
    if (mode === 'closed-missing') value.status = 'closed';
    assert.equal(Fixture.schemas().session.safeParse(value).success, false);
  }
  refresh(): void {
    const schemas = Fixture.schemas();
    for (const expectedSequence of [undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
      assert.equal(
        schemas.refresh.safeParse({ ...Fixture.create, expectedSequence }).success,
        false,
      );
    const omitted = { ...Fixture.create };
    Reflect.deleteProperty(omitted, 'ttlSeconds');
    assert.equal(Reflect.has(schemas.create.parse(omitted) as object, 'ttlSeconds'), false);
  }
}
const suite = new ProviderAvailabilitySemantics();
for (const mode of ['active', 'available', 'reserved', 'alias'])
  test(
    'unit: availability pressure rejects contradictory ' + mode,
    suite.pressure.bind(suite, mode),
  );
for (const mode of [
  'legacy',
  'ttl-low',
  'ttl-high',
  'ttl-fraction',
  'duplicate-adapter',
  'missing-lane',
  'duplicate-purpose',
  'unknown-lane',
  'unreferenced-lane',
  'active-overflow',
  'reserved-overflow',
  'mutable-build',
  'empty-offers',
  'duplicate-offer',
])
  test('unit: availability requests reject ' + mode, suite.create.bind(suite, mode));
for (const mode of [
  'unknown',
  'missing-signature',
  'duplicate-capability',
  'duplicate-feature',
  'bad-digest',
  'context-overflow',
])
  test('unit: canonical capability offers reject ' + mode, suite.offer.bind(suite, mode));
for (const mode of [
  'sequence',
  'identity',
  'window',
  'negative',
  'unknown',
  'open-closed',
  'closed-missing',
])
  test('unit: availability session observations reject ' + mode, suite.session.bind(suite, mode));
test(
  'unit: availability refresh requires exact sequence and preserves omitted server defaults',
  suite.refresh.bind(suite),
);
