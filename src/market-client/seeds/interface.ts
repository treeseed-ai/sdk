declare module "../../support/market-client.ts" {
  interface MarketClient {
    planSeed: OmitThisParameter<typeof import("./creation/plan-seed.ts").planSeedMethod>;
    resolveSeedResources: OmitThisParameter<typeof import("./queries/resolve-seed-resources.ts").resolveSeedResourcesMethod>;
    applySeed: OmitThisParameter<typeof import("./creation/apply-seed.ts").applySeedMethod>;
    listSeedRuns: OmitThisParameter<typeof import("./queries/list-seed-runs.ts").listSeedRunsMethod>;
    exportSeed: OmitThisParameter<typeof import("./creation/export-seed.ts").exportSeedMethod>;
  }
}

export {};
