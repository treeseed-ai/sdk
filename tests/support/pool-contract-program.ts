import assert from 'node:assert/strict';
import * as sdk from '@treeseed-cordis/sdk/portable';
import { EnvironmentFixtures } from './environment-contract-program.js';
import { CapacityFixtures } from './capacity-contract-program.js';

interface Schema {
  parse(value: unknown): unknown;
  safeParse(value: unknown): { success: boolean };
}
interface Schemas {
  compatibility: Schema;
  policy: Schema;
  base: Schema;
}

/** Schema fixtures, not evidence of runtime/image custody, a virgin guest or usable hardware. */
export class PoolFixtures {
  static readonly compatibility = {
    schemaVersion: 'treeseed.pool-compatibility/v1',
    runtime: { name: 'kata', version: '4.1.0', archiveDigest: CapacityFixtures.digest },
    image: EnvironmentFixtures.definition.image,
    resources: { vcpus: 2, memoryMiB: 1024, scratchMiB: 512 },
    network: { mode: 'offline', destinations: [] },
    isolationPolicyDigest: CapacityFixtures.digest,
    generations: {
      worker: CapacityFixtures.process,
      runner: CapacityFixtures.generations.runner.compositionGeneration,
      pool: CapacityFixtures.digest,
      sandbox: CapacityFixtures.digest,
      environment: CapacityFixtures.digest,
    },
  };
  static readonly policy = { warmTarget: 8, maximumSandboxes: 32, claimDeadlineMs: 5000 };
  static readonly base = {
    schemaVersion: 'treeseed.virgin-sandbox/v1',
    id: 'fixture.sandbox',
    compatibilityDigest: CapacityFixtures.digest,
    inspectionDigest: CapacityFixtures.digest,
    credentials: 'absent',
    assigned: false,
  };
}

class PoolContractProgram {
  private readonly schemas = Reflect.get(sdk, 'PoolSchemas') as Schemas;

  run(): void {
    assert.equal(typeof Reflect.get(sdk, 'PoolSchemas'), 'function', 'pool contracts must exist');
    this.schemas.compatibility.parse(PoolFixtures.compatibility);
    this.schemas.policy.parse(PoolFixtures.policy);
    this.schemas.base.parse(PoolFixtures.base);
    this.policy();
    this.compatibility();
    this.virgin();
    process.stdout.write('pool-contract-ok\n');
  }

  private policy(): void {
    const policy = PoolFixtures.policy;
    for (const value of [
      { ...policy, warmTarget: 33 },
      { ...policy, maximumSandboxes: 0 },
      { ...policy, warmTarget: -1 },
      { ...policy, claimDeadlineMs: 0 },
    ]) {
      assert.equal(this.schemas.policy.safeParse(value).success, false);
    }
    this.schemas.policy.parse({ ...policy, warmTarget: 0 });
  }

  private compatibility(): void {
    const value = PoolFixtures.compatibility;
    for (const resources of [
      { ...value.resources, vcpus: 0 },
      { ...value.resources, memoryMiB: -1 },
    ]) {
      assert.equal(this.schemas.compatibility.safeParse({ ...value, resources }).success, false);
    }
    const image = { ...value.image, manifestDigest: 'b'.repeat(64) };
    assert.equal(this.schemas.compatibility.safeParse({ ...value, image }).success, false);
    const generations = { ...value.generations, worker: null };
    assert.equal(this.schemas.compatibility.safeParse({ ...value, generations }).success, false);
  }

  private virgin(): void {
    for (const change of [
      { assigned: true },
      { credentials: 'present' },
      { inspectionDigest: null },
      { compatibilityDigest: null },
    ]) {
      assert.equal(this.schemas.base.safeParse({ ...PoolFixtures.base, ...change }).success, false);
    }
  }
}

if (import.meta.main) new PoolContractProgram().run();
