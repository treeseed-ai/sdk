import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as sdk from '@treeseed-cordis/sdk/portable';

interface Schema {
  parse(value: unknown): unknown;
  safeParse(value: unknown): { success: boolean };
}
interface Schemas {
  lease: Schema;
  result: Schema;
}
interface Binding {
  assertLease(input: unknown, expected: unknown, now: number): unknown;
  assertResult(input: unknown, lease: unknown): unknown;
}

/** Schema fixtures only: no real issuer, grant, sandbox, process or accepted cleanup evidence. */
export class CapacityFixtures {
  static readonly digest = 'a'.repeat(64);
  static readonly process = { compositionGeneration: this.digest, processGeneration: this.digest };
  static readonly scope = {
    installationId: 'fixture.installation',
    installationDirectory: '/fixture/capacity',
    capacityProviderId: 'fixture.capacity',
    project: 'fixture.project',
    platformProfile: 'default',
    workerId: 'fixture.worker',
  };
  static readonly authority = {
    issuer: 'https://identity.example.invalid/realms/fixture',
    subject: 'fixture.subject',
    teamId: 'fixture.team',
    providerId: 'fixture.capacity',
    credentialId: 'fixture.credential',
    credentialRevision: 1,
    grantId: 'fixture.grant',
    grantRevision: 1,
    capabilities: ['agent.probe'],
    state: 'granted',
    expiresAtEpochMs: 5000,
  };
  static readonly generations = {
    manager: this.process,
    worker: this.process,
    runner: this.process,
    pool: this.digest,
    sandbox: this.digest,
    environment: this.digest,
  };
  static readonly lease = {
    schemaVersion: 'treeseed.capacity-lease/v1',
    operation: 'capacity-probe',
    id: 'fixture.lease',
    assignmentId: 'fixture.assignment',
    sandboxId: 'fixture.sandbox',
    scope: this.scope,
    authority: this.authority,
    generations: this.generations,
    compatibilityDigest: this.digest,
    fence: 1,
    expiresAtEpochMs: 4000,
  };
  static readonly expectation = {
    lease: this.lease,
    authority: this.authority,
    generations: this.generations,
    fence: 1,
  };
  static readonly result = {
    schemaVersion: 'treeseed.capacity-result/v1',
    lease: this.lease,
    state: 'completed',
    output: 'harmless fixture',
    blockers: [],
    cleanup: {
      sandboxId: 'fixture.sandbox',
      providerGeneration: this.digest,
      disposition: 'destroyed',
      inspectionDigest: this.digest,
    },
  };
  static readonly invalidCleanup = [
    { ...this.result.cleanup, disposition: 'failed' },
    { ...this.result.cleanup, inspectionDigest: null },
    { ...this.result.cleanup, sandboxId: 'other.sandbox' },
  ];
}

class CapacityContractProgram {
  private readonly schemas = Reflect.get(sdk, 'CapacitySchemas') as Schemas;
  private readonly binding = Reflect.get(sdk, 'CapacityContractBinding') as Binding;

  run(): void {
    assert.equal(
      typeof Reflect.get(sdk, 'CapacitySchemas'),
      'function',
      'capacity contracts must exist',
    );
    this.accepted();
    this.authority();
    this.generations();
    this.results();
    this.safeFailure();
    this.projection();
    assert.equal(sdk.PlatformOperations.all.length, 7);
    process.stdout.write('capacity-contract-ok\n');
  }

  private accepted(): void {
    this.schemas.lease.parse(CapacityFixtures.lease);
    assert.deepEqual(
      this.binding.assertLease(CapacityFixtures.lease, CapacityFixtures.expectation, 2000),
      CapacityFixtures.lease,
    );
    assert.deepEqual(
      this.binding.assertResult(CapacityFixtures.result, CapacityFixtures.lease),
      CapacityFixtures.result,
    );
  }

  private authority(): void {
    this.block({
      ...CapacityFixtures.expectation,
      authority: { ...CapacityFixtures.authority, state: 'revoked' },
    });
    this.block({
      ...CapacityFixtures.expectation,
      authority: { ...CapacityFixtures.authority, teamId: 'other.team' },
    });
    this.block({
      ...CapacityFixtures.expectation,
      authority: {
        ...CapacityFixtures.authority,
        issuer: 'https://other.example.invalid/realms/fixture',
      },
    });
    this.expiry();
  }

  private expiry(): void {
    assert.throws(
      this.binding.assertLease.bind(
        null,
        CapacityFixtures.lease,
        CapacityFixtures.expectation,
        4500,
      ),
      /CAPACITY_LEASE_EXPIRED/,
    );
  }

  private generations(): void {
    const generation = { ...CapacityFixtures.process, processGeneration: 'b'.repeat(64) };
    for (const role of ['manager', 'worker', 'runner']) {
      this.block({
        ...CapacityFixtures.expectation,
        generations: { ...CapacityFixtures.generations, [role]: generation },
      });
    }
    this.block({ ...CapacityFixtures.expectation, fence: 2 });
    const forged = { ...CapacityFixtures.lease, expiresAtEpochMs: 4900 };
    assert.throws(
      this.binding.assertLease.bind(null, forged, CapacityFixtures.expectation, 2000),
      /CAPACITY_/,
    );
  }

  private results(): void {
    this.cleanup();
    this.reject({ ...CapacityFixtures.result, output: null });
    const lease = { ...CapacityFixtures.lease, assignmentId: 'other.assignment' };
    assert.throws(
      this.binding.assertResult.bind(
        null,
        { ...CapacityFixtures.result, lease },
        CapacityFixtures.lease,
      ),
      /CAPACITY_/,
    );
  }

  private cleanup(): void {
    for (const cleanup of CapacityFixtures.invalidCleanup) {
      this.reject({ ...CapacityFixtures.result, cleanup });
    }
  }

  private reject(value: unknown): void {
    assert.equal(this.schemas.result.safeParse(value).success, false);
  }

  private projection(): void {
    const value = JSON.parse(readFileSync('dist/contract.json', 'utf8'));
    assert.equal(value.contractVersion, '0.6.0-cordis.1');
    for (const name of ['capacityLease', 'capacityReadiness', 'capacityResult']) {
      assert.equal(typeof value.schemas[name], 'object');
    }
  }
  private safeFailure(): void {
    const lease = {
      ...CapacityFixtures.lease,
      authority: { ...CapacityFixtures.authority, issuer: 'secret-output-canary' },
    };
    assert.throws(
      this.binding.assertLease.bind(null, lease, CapacityFixtures.expectation, 2000),
      /INVALID_CAPACITY_CONTRACT/,
    );
  }
  private block(expected: unknown): void {
    assert.throws(
      this.binding.assertLease.bind(null, CapacityFixtures.lease, expected, 2000),
      /CAPACITY_/,
    );
  }
}

if (import.meta.main) new CapacityContractProgram().run();
