import assert from 'node:assert/strict';
import * as sdk from '@treeseed-cordis/sdk/portable';
import { CapacityFixtures } from './capacity-contract-program.js';
import { ActivityFixtures } from './activity-contract-program.js';
import { EnvironmentFixtures } from './environment-contract-program.js';

interface Binding {
  assertDispatch(input: unknown, reservation: unknown, now: number): unknown;
  assertRunner(input: unknown, lease: unknown): unknown;
}
interface Schema {
  parse(input: unknown): unknown;
  safeParse(input: unknown): { success: boolean };
}
interface Schemas {
  reservation: Schema;
  dispatch: Schema;
  runnerOutcome: Schema;
}
/** Data-only protocol fixtures; no trusted live grant, reservation or real guest. */
export class CapacityProtocolFixtures {
  static readonly request = {
    schemaVersion: 'treeseed.capacity-reserve/v1',
    requestId: 'fixture.request',
    assignmentId: CapacityFixtures.lease.assignmentId,
    scope: CapacityFixtures.scope,
    authority: CapacityFixtures.authority,
    manager: CapacityFixtures.process,
    expectedWorker: CapacityFixtures.process,
    compatibilityDigest: CapacityFixtures.digest,
    fence: 1,
    expiresAtEpochMs: 4000,
  };
  static readonly reservation = {
    schemaVersion: 'treeseed.capacity-reservation/v1',
    id: 'fixture.reservation',
    request: this.request,
    sandboxId: CapacityFixtures.lease.sandboxId,
    inspectionDigest: CapacityFixtures.digest,
    generations: CapacityFixtures.generations,
  };
  static readonly dispatch = {
    schemaVersion: 'treeseed.capacity-dispatch/v1',
    reservationId: this.reservation.id,
    requestId: this.request.requestId,
    lease: CapacityFixtures.lease,
    definition: ActivityFixtures.definition,
    profileId: ActivityFixtures.profile.id,
    environment: EnvironmentFixtures.definition,
    input: 'harmless fixture',
  };
  static readonly runner = {
    schemaVersion: 'treeseed.capacity-runner-outcome/v1',
    lease: CapacityFixtures.lease,
    state: 'completed',
    output: 'harmless fixture',
    blockers: [],
  };
}
export class CapacityProtocolProgram {
  private readonly binding = Reflect.get(sdk, 'CapacityProtocolBinding') as Binding;
  private readonly schemas = Reflect.get(sdk, 'CapacityProtocolSchemas') as Schemas;
  run(): void {
    assert.equal(typeof Reflect.get(sdk, 'CapacityProtocolSchemas'), 'function');
    this.binding.assertDispatch(
      CapacityProtocolFixtures.dispatch,
      CapacityProtocolFixtures.reservation,
      2000,
    );
    this.binding.assertRunner(CapacityProtocolFixtures.runner, CapacityFixtures.lease);
    this.denied();
    this.runner();
    assert.equal(sdk.PlatformOperations.all.length, 7);
    process.stdout.write('capacity-protocol-ok\n');
  }
  private denied(): void {
    for (const change of [
      { requestId: 'other.request' },
      { reservationId: 'other.reservation' },
      { profileId: 'unknown.profile' },
      { environment: { ...EnvironmentFixtures.definition, id: 'other.environment' } },
      { lease: { ...CapacityFixtures.lease, sandboxId: 'other.sandbox' } },
    ])
      assert.throws(
        this.binding.assertDispatch.bind(
          null,
          { ...CapacityProtocolFixtures.dispatch, ...change },
          CapacityProtocolFixtures.reservation,
          2000,
        ),
      );
    assert.throws(
      this.binding.assertDispatch.bind(
        null,
        CapacityProtocolFixtures.dispatch,
        CapacityProtocolFixtures.reservation,
        4000,
      ),
    );
  }
  private runner(): void {
    for (const change of [
      { cleanup: CapacityFixtures.result.cleanup },
      { output: 'x'.repeat(4097) },
      { state: 'cancelled' },
      { blockers: [{ code: 'LEAK', message: 'SECRET_CANARY' }] },
    ])
      assert.equal(
        this.schemas.runnerOutcome.safeParse({ ...CapacityProtocolFixtures.runner, ...change })
          .success,
        false,
      );
  }
}
if (import.meta.main) new CapacityProtocolProgram().run();
