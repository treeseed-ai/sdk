import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  SandboxProfileBinding,
  SandboxProfileError,
  SandboxProfileSchemas,
} from '../../src/contracts.js';
import { SandboxProfileFixture as Fixture } from '../support/sandbox-profile-program.js';
class SandboxProfileTests {
  static readonly mismatches = [
    { resources: { ...Fixture.content.resources, vcpus: 3 } },
    { resources: { ...Fixture.content.resources, memoryMiB: 2048 } },
    { resources: { ...Fixture.content.resources, scratchMiB: 1024 } },
    { runtime: { ...Fixture.content.runtime, archiveDigest: 'b'.repeat(64) } },
    {
      image: {
        ...Fixture.content.image,
        manifestDigest: 'b'.repeat(64),
        reference: 'fixture.invalid/guest@sha256:' + 'b'.repeat(64),
      },
    },
    { network: { mode: 'offline', destinations: [] } },
    { isolationPolicyDigest: 'b'.repeat(64) },
    { hostProfile: { id: 'profile:foreign', revision: 'b'.repeat(64) } },
  ];
  defaults(): void {
    const { network, ...content } = Fixture.content;
    const profile = SandboxProfileBinding.create(content);
    assert.deepEqual(profile.network, { mode: 'offline', destinations: [] });
    assert.deepEqual(SandboxProfileBinding.assert(profile), profile);
    const changed = structuredClone(profile);
    changed.resources.vcpus++;
    this.invalid(changed);
    assert(SandboxProfileSchemas.profile.safeParse(profile).success);
  }
  malformed(): void {
    const profile = SandboxProfileBinding.create(Fixture.content);
    for (const input of [
      { ...profile, revision: 'b'.repeat(64) },
      { ...profile, timestamp: 12 },
      { ...profile, schemaVersion: 'treeseed.sandbox-profile/v2' },
      { ...profile, image: { ...profile.image, reference: 'fixture.invalid/guest:latest' } },
      { ...profile, resources: { ...profile.resources, vcpus: 0 } },
    ])
      this.invalid(input);
  }
  mismatch(change: object): void {
    const profile = SandboxProfileBinding.create(Fixture.content);
    const compatibility = Fixture.compatibility(profile);
    assert.throws(
      SandboxProfileBinding.assertCompatible.bind(null, profile, { ...compatibility, ...change }),
      {
        name: 'SandboxProfileError',
        code: 'SANDBOX_PROFILE_MISMATCH',
        message: 'SANDBOX_PROFILE_MISMATCH',
      },
    );
  }
  detached(): void {
    const source = structuredClone(Fixture.content);
    const profile = SandboxProfileBinding.create(source);
    source.resources.vcpus++;
    source.network.destinations[0]!.host = 'changed.test';
    assert.equal(profile.resources.vcpus, Fixture.content.resources.vcpus);
    assert.equal(profile.network.destinations[0]!.host, 'a.example.test');
    assert.deepEqual(SandboxProfileBinding.assert(profile), profile);
  }
  hostile(): void {
    const input = Object.defineProperty({}, 'schemaVersion', { get: SandboxProfileTests.throwing });
    assert.throws(SandboxProfileBinding.create.bind(null, input), SandboxProfileError);
    this.invalid(input);
    const profile = SandboxProfileBinding.create(Fixture.content);
    assert.throws(
      SandboxProfileBinding.assertCompatible.bind(null, profile, input),
      SandboxProfileError,
    );
  }
  private invalid(input: unknown): void {
    assert.throws(SandboxProfileBinding.assert.bind(null, input), {
      name: 'SandboxProfileError',
      code: 'SANDBOX_PROFILE_INVALID',
      message: 'SANDBOX_PROFILE_INVALID',
    });
  }
  private static throwing(): never {
    throw new Error('PRIVATE_PROFILE_CANARY');
  }
}
const suite = new SandboxProfileTests();
test(
  'unit: sandbox profiles normalize the offline default and reject mutation',
  suite.defaults.bind(suite),
);
test(
  'unit: sandbox profiles reject malformed revisions mutable images and unknown fields',
  suite.malformed.bind(suite),
);
test('unit: sandbox profile normalization detaches source data', suite.detached.bind(suite));
test(
  'unit: sandbox profile public bindings contain hostile input inspection',
  suite.hostile.bind(suite),
);
for (const [index, change] of SandboxProfileTests.mismatches.entries())
  test(
    'unit: sandbox profile admission rejects exact resource or identity mismatch ' + index,
    suite.mismatch.bind(suite, change),
  );
