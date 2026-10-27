import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as sdk from '@treeseed-cordis/sdk/portable';

interface Schema { parse(value: unknown): unknown; safeParse(value: unknown): { success: boolean }; }
interface SeedApi { bundle: Schema; plan: Schema; receipt: Schema; }

/** All identities/digests below are explicit schema fixtures, never accepted release artifacts. */
export class SeedFixtures {
  static readonly digest = 'a'.repeat(64);
  static readonly provider = {
    id: 'fixture.provider', capability: 'fixture.resource', target: 'agent',
    scopeId: 'installation:fixture:agent:manager',
    contractVersion: '1.0.0', artifact: {
      package: '@fixture/provider', version: '1.0.0', integrity: this.digest,
    }, executableDigest: this.digest,
  };
  static readonly resource = {
    key: 'resource:one', kind: 'fixture.resource',
    schema: { id: 'fixture.resource.schema', version: '1.0.0', digest: this.digest },
    requires: ['fixture.resource'], dependsOn: [], payload: { value: 'harmless fixture' },
  };
  static readonly requirement = {
    key: 'fixture.resource', scopeId: this.provider.scopeId,
    capability: 'fixture.resource', providerId: 'fixture.provider', target: 'agent',
    contractVersion: '1.0.0', source: '@fixture/provider@1.0.0',
  };
  static readonly bundle = {
    schemaVersion: 'treeseed.seed-bundle/v4', name: 'fixture.seed', version: 1,
    digest: this.digest, requirements: [this.requirement], resources: [this.resource],
  };
  static readonly binding = {
    installationId: 'installation:fixture', installationDirectory: '/fixture/installation',
    project: 'fixture-project', profile: 'default', principalId: 'subject:fixture',
    resourceScope: 'installation:fixture', grantId: 'grant:fixture', grantRevision: 1,
  };
  static readonly resourcePlan = {
    key: this.resource.key, kind: this.resource.kind, schema: this.resource.schema,
    requires: this.resource.requires, dependsOn: [], providerRequirement: this.requirement.key,
    provider: this.provider, owner: 'agent', configurationDigest: this.digest, desiredDigest: this.digest,
    expectedGeneration: null, desiredGeneration: null, previousRecord: null, effects: [],
  };
  static readonly lock = {
    requirement: 'fixture.resource', provider: this.provider,
    closureDigest: this.digest, source: this.requirement.source,
    receipt: {
      kind: 'npm', locator: this.requirement.source, name: '@fixture/provider', version: '1.0.0',
      archiveDigest: this.digest, closureDigest: this.digest, helperDigests: [this.digest],
      sri: 'sha256-' + Buffer.from(this.digest, 'hex').toString('base64'),
      registry: 'https://registry.example.invalid',
    },
  };
  static readonly plan = {
    schemaVersion: 'treeseed.seed-plan/v1', id: 'seed-plan-' + this.digest,
    digest: this.digest, seedDigest: this.digest, binding: this.binding,
    locks: [this.lock], resources: [this.resourcePlan], blockers: [],
  };
  static readonly resourceReceipt = {
    key: this.resource.key, provider: this.provider, desiredDigest: this.digest,
    state: 'verified', owner: 'agent', record: 'fixture-record:one',
    observedDigest: this.digest, generation: null, blockers: [],
  };
  static readonly receipt = {
    schemaVersion: 'treeseed.seed-receipt/v1', requestId: 'request:fixture',
    planId: this.plan.id, planDigest: this.digest, binding: this.binding,
    expectedResources: [this.resourcePlan], resources: [this.resourceReceipt],
    state: 'completed', blockers: [],
  };
}

class SeedContractProgram {
  private readonly schemas: SeedApi;

  constructor() {
    assert.equal(typeof Reflect.get(sdk, 'SeedSchemas'), 'function', 'portable seed contracts must exist');
    this.schemas = Reflect.get(sdk, 'SeedSchemas') as SeedApi;
  }

  run(): void {
    this.valid();
    this.graph();
    this.bindings();
    this.completion();
    this.projection();
    this.selections();
    assert.equal(sdk.PlatformOperations.all.length, 7);
    process.stdout.write('seed-contract-ok\n');
  }

  private valid(): void {
    this.schemas.bundle.parse(SeedFixtures.bundle);
    this.schemas.plan.parse(SeedFixtures.plan);
    this.schemas.receipt.parse(SeedFixtures.receipt);
    const resource = { ...SeedFixtures.resource, kind: 'external.new-resource' };
    this.schemas.bundle.parse({ ...SeedFixtures.bundle, resources: [resource] });
  }

  private graph(): void {
    const resource = SeedFixtures.resource;
    this.reject(this.schemas.bundle, { ...SeedFixtures.bundle, resources: [resource, resource] });
    this.reject(this.schemas.bundle, { ...SeedFixtures.bundle,
      resources: [{ ...resource, dependsOn: ['resource:missing'] }] });
    this.reject(this.schemas.bundle, { ...SeedFixtures.bundle,
      resources: [{ ...resource, requires: ['fixture.missing'] }] });
    const other = { ...resource, key: 'resource:two', dependsOn: [resource.key] };
    this.reject(this.schemas.bundle, { ...SeedFixtures.bundle,
      resources: [{ ...resource, dependsOn: [other.key] }, other] });
  }

  private bindings(): void {
    this.reject(this.schemas.plan, { ...SeedFixtures.plan, id: 'seed-plan-' + 'b'.repeat(64) });
    const provider = { ...SeedFixtures.provider, artifact: {
      ...SeedFixtures.provider.artifact, integrity: 'b'.repeat(64),
    } };
    this.reject(this.schemas.plan, { ...SeedFixtures.plan,
      resources: [{ ...SeedFixtures.resourcePlan, provider }] });
    this.reject(this.schemas.bundle, { ...SeedFixtures.bundle, credential: 'secret-canary' });
  }

  private completion(): void {
    this.reject(this.schemas.receipt, { ...SeedFixtures.receipt, resources: [] });
    this.reject(this.schemas.receipt, { ...SeedFixtures.receipt, resources: [
      { ...SeedFixtures.resourceReceipt, observedDigest: 'b'.repeat(64) },
    ] });
    this.reject(this.schemas.receipt, { ...SeedFixtures.receipt,
      resources: [SeedFixtures.resourceReceipt, SeedFixtures.resourceReceipt] });
    this.schemas.receipt.parse({ ...SeedFixtures.receipt, state: 'pending', resources: [] });
  }

  private reject(schema: Schema, value: unknown): void { assert.equal(schema.safeParse(value).success, false); }

  private projection(): void {
    const value = JSON.parse(readFileSync('dist/contract.json', 'utf8'));
    assert.equal(value.contractVersion, '0.8.0-cordis.1');
    for (const key of ['seedBundle', 'seedPlan', 'seedReceipt', 'seedResourcePlan', 'seedResourceReceipt']) {
      assert.equal(typeof value.schemas[key], 'object');
    }
  }

  private selections(): void {
    const other = { ...SeedFixtures.lock, requirement: 'fixture.other' };
    this.reject(this.schemas.plan, { ...SeedFixtures.plan, locks: [SeedFixtures.lock, other] });
    const provider = { ...other.provider, scopeId: 'installation:fixture:agent:worker' };
    this.schemas.plan.parse({ ...SeedFixtures.plan, locks: [SeedFixtures.lock, { ...other, provider }] });
    const receipt = { ...SeedFixtures.resourceReceipt, owner: 'other.owner' };
    this.reject(this.schemas.receipt, { ...SeedFixtures.receipt, resources: [receipt] });
  }
}

if (import.meta.main) new SeedContractProgram().run();
