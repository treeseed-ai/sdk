import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { loadGuaranteeJourneyInventory } from './guarantee-journey-inventory';

describe('guarantee journey inventory', () => {
  it('summarizes the scene-backed guarantee registry deterministically', () => {
    const inventory = loadGuaranteeJourneyInventory();
    const hasRootGuarantees = existsSync(resolve(inventory.workspaceRoot, 'guarantees'));

    if (!hasRootGuarantees) {
      expect(inventory.totals.sceneBacked).toBe(0);
      expect(inventory.items).toHaveLength(0);
      return;
    }

    expect(inventory.totals.sceneBacked).toBe(139);
    expect(inventory.totals.activeSceneBacked).toBeGreaterThan(0);
    expect(inventory.totals.activeWeak).toBe(0);
    expect(inventory.totals.activeMissingRoutes).toBe(0);
    expect(inventory.totals.weakSceneContracts).toBe(0);
    expect(inventory.items).toHaveLength(139);
    expect(inventory.items.map((item) => item.journeyIndex)).toEqual(
      [...inventory.items.map((item) => item.journeyIndex)].sort((left, right) => left - right),
    );
  });

  it('requires every scene-backed guarantee to carry service journey intent', () => {
    const inventory = loadGuaranteeJourneyInventory();

    for (const item of inventory.items) {
      expect(item.workflowStepCount, item.guaranteeId).toBeGreaterThanOrEqual(2);
      expect(item.interactiveStepCount, item.guaranteeId).toBeGreaterThanOrEqual(1);
      expect(
        ['valid-service-journey', 'missing-product-route', 'planned-product-contract', 'non-ui-guarantee'],
        item.guaranteeId,
      ).toContain(item.classification);
    }
  });
});
