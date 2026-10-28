import { test, expect } from 'bun:test';
import * as sdk from '../../src/contracts.js';
import { CapacityFixtures as Capacity } from '../support/capacity-contract-program.js';
import { CapacityProtocolFixtures as Fixture } from '../support/capacity-protocol-program.js';

interface Binding {
  assertDispatch(input: unknown, reservation: unknown, now: number): unknown;
  assertRunner(input: unknown, lease: unknown): unknown;
}
class CapacityProtocolTests {
  private readonly binding = Reflect.get(sdk, 'CapacityProtocolBinding') as Binding;
  private assertRejected(lease: unknown, reservation: unknown = Fixture.reservation): void {
    expect(this.binding.assertDispatch.bind(null, { ...Fixture.dispatch, lease }, reservation, 2000)).toThrow();
  }
  substitutedLease(): void {
    for (const change of [
      { assignmentId: 'other.assignment' }, { sandboxId: 'other.sandbox' },
      { scope: { ...Capacity.scope, workerId: 'other.worker' } },
      { authority: { ...Capacity.authority, teamId: 'other.team' } },
      { generations: { ...Capacity.generations, runner: { ...Capacity.process, processGeneration: 'b'.repeat(64) } } },
      { compatibilityDigest: 'b'.repeat(64) }, { fence: 2 }, { expiresAtEpochMs: 4001 },
    ]) this.assertRejected({ ...Capacity.lease, ...change });
  }
  substitutedReservation(): void {
    for (const request of [
      { ...Fixture.request, manager: { ...Capacity.process, processGeneration: 'b'.repeat(64) } },
      { ...Fixture.request, expectedWorker: { ...Capacity.process, processGeneration: 'b'.repeat(64) } },
      { ...Fixture.request, expiresAtEpochMs: 6000 },
    ]) this.assertRejected(Capacity.lease, { ...Fixture.reservation, request });
  }
  runnerLease(): void {
    const other = { ...Capacity.lease, fence: 2 };
    expect(this.binding.assertRunner.bind(null, Fixture.runner, other)).toThrow('STALE_CAPACITY_LEASE');
  }
  invalidClock(): void {
    for (const now of [NaN, Infinity, -1])
      expect(this.binding.assertDispatch.bind(null, Fixture.dispatch, Fixture.reservation, now)).toThrow('INVALID_CAPACITY_CONTRACT');
  }
  projection(): void {
    const schemas = sdk.ContractProjection.generate().schemas;
    for (const name of ['capacityReserve', 'capacityReservation', 'capacityDispatch', 'capacityRunnerOutcome']) expect(Reflect.get(schemas, name)).toBeDefined();
  }
}
const suite = new CapacityProtocolTests();
test('unit: dispatch rejects substituted reservation lease identities and lifetime', suite.substitutedLease.bind(suite));
test('unit: reservation binds actual manager and expected worker generations and grant expiry', suite.substitutedReservation.bind(suite));
test('unit: runner result is fenced to exact lease without host cleanup authority', suite.runnerLease.bind(suite));
test('unit: dispatch admission requires a valid trusted clock', suite.invalidClock.bind(suite));
test('unit: generated projection includes separately versioned capacity protocol schemas', suite.projection.bind(suite));
