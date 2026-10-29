import assert from 'node:assert/strict';
import type { ZodType } from 'zod';
import * as contracts from '@treeseed-cordis/sdk/provider-control-contracts';
import { ContractProjection, PlatformOperations } from '@treeseed-cordis/sdk';
export interface AvailabilityContract {
  readonly offer: ZodType;
  readonly create: ZodType;
  readonly refresh: ZodType;
  readonly session: ZodType;
  project(): { version: string; schemas: Record<string, object> };
}
/** Canonical wire fixture only: opaque signatures and hashes establish no live authority. */
export class ProviderAvailabilityFixture {
  static readonly time = '2026-10-29T12:00:00.000Z';
  static readonly capability = {
    id: 'treeseed.harmless-probe',
    version: '1.0.0',
    digest: 'sha256:' + 'a'.repeat(64),
  };
  static readonly offer = {
    schemaVersion: 'treeseed.capability-offer/v2',
    offerId: 'probe.offer',
    capabilities: [this.capability],
    features: [],
    configurationSupport: {},
    permissionClasses: [],
    contextModes: ['isolated'],
    inputContracts: [],
    outputContracts: [],
    interactionModes: [],
    conformance: [
      {
        schemaVersion: 'treeseed.capability-conformance/v1',
        providerId: 'provider:fixture',
        capability: this.capability,
        tier: 'signed-attestation',
        status: 'passed',
        evidenceDigest: 'sha256:' + 'c'.repeat(64),
        suite: null,
        issuedAt: this.time,
        expiresAt: null,
        signature: { keyId: 'provider-fixture', algorithm: 'Ed25519', value: 'A'.repeat(86) },
      },
    ],
    contextCapacity: {
      mode: 'unbounded',
      measurement: null,
      transportPayloadBytes: 4096,
      measurementProvenance: {
        provider: 'probe.provider',
        implementation: 'fixture',
        version: '1.0.0',
      },
    },
    limits: {},
    commercial: { currency: null, estimatedCost: null },
    region: null,
    trust: [],
    offerDigest: 'sha256:' + 'd'.repeat(64),
  };
  static readonly lanes = [this.lane('communication'), this.lane('platform'), this.lane('workday')];
  static readonly adapter = {
    id: 'adapter:fixture',
    adapter: 'external.npm-probe',
    runtimeBuild: 'sha256:' + 'b'.repeat(64),
    offers: [this.offer],
    isolation: 'microvm',
    status: 'available',
    capabilities: ['treeseed.harmless-probe'],
    laneIds: this.lanes.map(this.laneId),
    maxConcurrentWorkers: 1,
    activeWorkers: 0,
    nativeLimits: {},
  };
  static readonly create = {
    ttlSeconds: 90,
    status: 'open',
    adapters: [this.adapter],
    lanes: this.lanes,
    capacity: { maxConcurrentWorkers: 1 },
    capabilities: ['treeseed.harmless-probe'],
    runnerPressure: {
      pressure: 'idle',
      maxConcurrentWorkers: 1,
      activeAssignmentIds: [],
      availableWorkers: 1,
    },
  };
  static readonly session = {
    id: 'session:fixture',
    membershipId: 'membership:fixture',
    teamId: 'team:fixture',
    providerId: 'provider:fixture',
    status: 'open',
    sequence: 1,
    openedAt: this.time,
    refreshedAt: this.time,
    expiresAt: '2026-10-29T12:01:30.000Z',
    closedAt: null,
    snapshot: {
      sequence: 1,
      availableFrom: this.time,
      availableUntil: null,
      pressure: 'idle',
      maxConcurrentWorkers: 1,
      activeAssignmentIds: [],
      reservedWorkers: 0,
      borrowedWorkers: 0,
      availableWorkers: 1,
      adapters: [this.adapter],
      lanes: this.lanes.map(this.observedLane),
      capabilities: ['treeseed.harmless-probe'],
      constraints: {},
    },
  };
  private static lane(purpose: string): object {
    return {
      id: 'lane:' + purpose,
      purpose,
      priority: 0,
      reservedConcurrentWorkers: 0,
      maxConcurrentWorkers: 1,
      borrowWhenIdle: true,
      lendWhenIdle: true,
      reclaimPolicy: 'admission',
      queueLimit: 0,
      timeoutSeconds: 30,
      capabilities: ['treeseed.harmless-probe'],
    };
  }
  private static laneId(lane: object): string {
    return Reflect.get(lane, 'id');
  }
  private static observedLane(lane: object): object {
    return {
      id: Reflect.get(lane, 'id'),
      purpose: Reflect.get(lane, 'purpose'),
      status: 'active',
      priority: 0,
      reservedConcurrentWorkers: 0,
      borrowedWorkers: 0,
      lentWorkers: 0,
      queuedAssignments: 0,
      maxConcurrentWorkers: 1,
      activeWorkers: 0,
      capabilities: ['treeseed.harmless-probe'],
    };
  }
  static schemas(): AvailabilityContract {
    const schema = Reflect.get(contracts, 'ProviderAvailabilitySchemas') as
      | AvailabilityContract
      | undefined;
    assert(
      schema && schema.offer && schema.create && schema.refresh && schema.session,
      'Public provider availability contracts missing',
    );
    return schema;
  }
}
class ProviderAvailabilityProgram {
  run(): void {
    const schema = ProviderAvailabilityFixture.schemas();
    assert.deepEqual(
      schema.offer.parse(ProviderAvailabilityFixture.offer),
      ProviderAvailabilityFixture.offer,
    );
    assert.deepEqual(
      schema.create.parse(ProviderAvailabilityFixture.create),
      ProviderAvailabilityFixture.create,
    );
    assert.deepEqual(
      schema.refresh.parse({ ...ProviderAvailabilityFixture.create, expectedSequence: 1 }),
      { ...ProviderAvailabilityFixture.create, expectedSequence: 1 },
    );
    assert.deepEqual(
      schema.session.parse(ProviderAvailabilityFixture.session),
      ProviderAvailabilityFixture.session,
    );
    this.projection(schema);
    assert.equal(PlatformOperations.all.length, 7);
    process.stdout.write('provider-availability-contract-ok\n');
  }
  private projection(schema: AvailabilityContract): void {
    const projected = schema.project();
    assert.equal(projected.version, 'treeseed.provider-availability/v1');
    assert.deepEqual(Object.keys(projected.schemas), ['offer', 'create', 'refresh', 'session']);
    const global = ContractProjection.generate() as { schemas: Record<string, object> };
    for (const name of [
      'providerCapabilityOffer',
      'providerAvailabilityCreate',
      'providerAvailabilityRefresh',
      'providerAvailabilitySession',
    ])
      assert(global.schemas[name], 'Missing generated provider schema: ' + name);
  }
}
if (import.meta.main) new ProviderAvailabilityProgram().run();
