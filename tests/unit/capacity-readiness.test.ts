import { test, expect } from 'bun:test';
import {
  CapacityContractBinding,
  CapacityContractError,
  CapacitySchemas,
  type CapacityReadiness,
} from '../../src/contracts.js';
import { CapacityFixtures } from '../support/capacity-contract-program.js';

class CapacityReadinessTests {
  private readonly ready: CapacityReadiness = {
    schemaVersion: 'treeseed.capacity-readiness/v1',
    role: 'worker',
    scope: CapacityFixtures.scope,
    generation: CapacityFixtures.process,
    ready: true,
    blockers: [],
  };

  live(): void {
    expect(
      CapacityContractBinding.assertReady(
        this.ready,
        CapacityFixtures.scope,
        'worker',
        CapacityFixtures.process,
      ),
    ).toEqual(this.ready);
  }

  stale(): void {
    const restarted = { ...CapacityFixtures.process, processGeneration: 'b'.repeat(64) };
    expect(
      CapacityContractBinding.assertReady.bind(
        null,
        this.ready,
        CapacityFixtures.scope,
        'worker',
        restarted,
      ),
    ).toThrow('STALE_CAPACITY_GENERATION');
  }

  scope(): void {
    const other = { ...CapacityFixtures.scope, installationDirectory: '/other/installation' };
    expect(
      CapacityContractBinding.assertReady.bind(
        null,
        this.ready,
        other,
        'worker',
        CapacityFixtures.process,
      ),
    ).toThrow('CAPACITY_SCOPE_MISMATCH');
  }

  target(): void {
    expect(
      CapacityContractBinding.assertReady.bind(
        null,
        this.ready,
        CapacityFixtures.scope,
        'manager',
        CapacityFixtures.process,
      ),
    ).toThrow('CAPACITY_TARGET_UNREADY');
    const blocker = new CapacityContractError('CAPACITY_TARGET_UNREADY').blocker();
    const unready = { ...this.ready, ready: false, blockers: [blocker] };
    expect(
      CapacityContractBinding.assertReady.bind(
        null,
        unready,
        CapacityFixtures.scope,
        'worker',
        CapacityFixtures.process,
      ),
    ).toThrow('CAPACITY_TARGET_UNREADY');
  }

  contradictory(): void {
    expect(CapacitySchemas.readiness.safeParse({ ...this.ready, ready: false }).success).toBe(
      false,
    );
    const blocker = new CapacityContractError('CAPACITY_TARGET_UNREADY').blocker();
    expect(
      CapacitySchemas.readiness.safeParse({ ...this.ready, blockers: [blocker] }).success,
    ).toBe(false);
  }
}

const suite = new CapacityReadinessTests();
test(
  'unit: capacity readiness accepts the exact current process acknowledgement',
  suite.live.bind(suite),
);
test(
  'unit: a restarted process invalidates its previous readiness acknowledgement',
  suite.stale.bind(suite),
);
test('unit: capacity readiness cannot cross installation scope', suite.scope.bind(suite));
test(
  'unit: wrong and unready capacity roles cannot acknowledge readiness',
  suite.target.bind(suite),
);
test('unit: capacity readiness cannot contradict its blockers', suite.contradictory.bind(suite));
