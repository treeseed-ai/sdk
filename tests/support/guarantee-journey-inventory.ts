import { resolve } from 'node:path';

import { auditTreeseedGuaranteeJourneys } from '../../src/guarantees/index';

export type TreeseedGuaranteeJourneyInventoryItem = {
  guaranteeId: string;
  journeyIndex: number;
  ownerPackage: string;
  status: string;
  type: string;
  subtype: string;
  routeExists: boolean;
  currentRoute?: string;
  resolvedRoute?: string;
  scenePath?: string;
  sourcePath: string;
  classification: string;
  workflowStepCount: number;
  interactiveStepCount: number;
};

export type TreeseedGuaranteeJourneyInventory = {
  workspaceRoot: string;
  totals: {
    sceneBacked: number;
    activeSceneBacked: number;
    activeWeak: number;
    activeMissingRoutes: number;
    missingRoutes: number;
    weakSceneContracts: number;
  };
  items: TreeseedGuaranteeJourneyInventoryItem[];
};

function journeyIndexFromGuaranteeId(guaranteeId: string): number {
  const match = guaranteeId.match(/\.(\d+)$/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

export function loadGuaranteeJourneyInventory(workspaceRoot = resolve(process.cwd(), '../..')): TreeseedGuaranteeJourneyInventory {
  const audit = auditTreeseedGuaranteeJourneys({
    workspaceRoot,
    now: new Date('2026-01-01T00:00:00.000Z'),
  });

  const sceneBackedItems = audit.items
    .filter((item) => Boolean(item.scenePath))
    .map((item) => ({
      guaranteeId: item.guaranteeId,
      journeyIndex: journeyIndexFromGuaranteeId(item.guaranteeId),
      ownerPackage: item.ownerPackage,
      status: item.status,
      type: item.type,
      subtype: item.subtype,
      routeExists: item.routeExists,
      currentRoute: item.currentRoute,
      resolvedRoute: item.resolvedRoute,
      scenePath: item.scenePath,
      sourcePath: item.sourcePath,
      classification: item.classification,
      workflowStepCount: item.sceneWorkflowStepCount,
      interactiveStepCount: item.interactiveStepCount,
    }))
    .sort((left, right) => left.journeyIndex - right.journeyIndex || left.guaranteeId.localeCompare(right.guaranteeId));

  return {
    workspaceRoot,
    totals: {
      sceneBacked: audit.totals.sceneBacked,
      activeSceneBacked: audit.totals.activeSceneBacked,
      activeWeak: audit.totals.activeSceneBackedWeak,
      activeMissingRoutes: audit.totals.activeMissingRoutes,
      missingRoutes: audit.totals.missingRoutes,
      weakSceneContracts: audit.totals.weakSceneContracts,
    },
    items: sceneBackedItems,
  };
}
