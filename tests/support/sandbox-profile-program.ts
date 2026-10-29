import assert from 'node:assert/strict';
import * as sdk from '@treeseed-cordis/sdk/portable';
import { ContractProjection } from '@treeseed-cordis/sdk';
import { PoolFixtures } from './pool-contract-program.js';
interface Profile {
  id: string;
  revision: string;
  network: { mode: string; destinations: object[] };
}
interface Binding {
  create(input: unknown): Promise<Profile>;
  assert(input: unknown): Promise<Profile>;
  assertCompatible(input: unknown, compatibility: unknown): Promise<Profile>;
}
/** Portable fixture declarations only; never proof of physical resource enforcement. */
export class SandboxProfileFixture {
  static readonly content = {
    schemaVersion: 'treeseed.sandbox-profile/v1',
    id: 'profile:fixture',
    runtime: PoolFixtures.compatibility.runtime,
    image: PoolFixtures.compatibility.image,
    resources: PoolFixtures.compatibility.resources,
    network: {
      mode: 'allow-list',
      destinations: [
        { protocol: 'tcp', host: 'z.example.test', port: 443 },
        { protocol: 'tcp', host: 'a.example.test', port: 443 },
      ],
    },
    isolationPolicyDigest: PoolFixtures.digest,
  };
  static compatibility(profile: { id: string; revision: string }): object {
    return {
      ...structuredClone(PoolFixtures.compatibility),
      network: structuredClone(this.content.network),
      hostProfile: { id: profile.id, revision: profile.revision },
    };
  }
}
class SandboxProfileProgram {
  private readonly binding = Reflect.get(sdk, 'SandboxProfileBinding') as Binding;
  async run(): Promise<void> {
    assert.equal(
      typeof Reflect.get(sdk, 'SandboxProfileBinding'),
      'function',
      'verified profile binding missing',
    );
    const profile = await this.binding.create(SandboxProfileFixture.content);
    const compatibility = SandboxProfileFixture.compatibility(profile);
    assert.deepEqual(await this.binding.assertCompatible(profile, compatibility), profile);
    await this.canonical(profile);
    await this.wire(profile);
    this.projection();
    process.stdout.write('sandbox-profile-contract-ok\n');
  }
  private async canonical(profile: Profile): Promise<void> {
    const network = SandboxProfileFixture.content.network;
    const reordered = await this.binding.create({
      ...SandboxProfileFixture.content,
      network: {
        ...network,
        destinations: [...network.destinations].reverse(),
      },
    });
    assert.equal(reordered.revision, profile.revision);
  }
  private async wire(profile: Profile): Promise<void> {
    const availability = {
      state: 'available',
      configurationDigest: 'c'.repeat(64),
      capabilityVersion: sdk.SandboxControlSchemas.version,
    };
    assert(sdk.SandboxControlSchemas.availability.safeParse(availability).success);
    assert(sdk.SandboxControlSchemas.availability.safeParse({ ...availability, profile }).success);
    assert(
      !sdk.SandboxControlSchemas.availability.safeParse({ ...availability, profile: null }).success,
    );
    await assert.rejects(
      this.binding.assertCompatible.bind(this.binding, profile, PoolFixtures.compatibility),
    );
    assert.equal(sdk.PlatformOperations.all.length, 7);
  }
  private projection(): void {
    const projection = ContractProjection.generate() as {
      contractVersion: string;
      schemas: Record<string, unknown>;
    };
    assert.equal(projection.contractVersion, '0.6.0-cordis.1');
    assert(projection.schemas.sandboxResourceProfile);
    assert(projection.schemas.sandboxProfileReference);
  }
}
if (import.meta.main) await new SandboxProfileProgram().run();
