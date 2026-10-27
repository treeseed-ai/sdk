import assert from 'node:assert/strict';
import * as sdk from '@treeseed-cordis/sdk/portable';

interface Schemas { definition: { parse(value: unknown): unknown; safeParse(value: unknown): { success: boolean } }; }
interface Binding { resolve(input: unknown, capabilities: unknown): unknown; }

/** Schema-only fixtures: no installed provider, accepted artifact or live authority claim. */
export class ActivityFixtures {
  static readonly digest = 'a'.repeat(64);
  static readonly provider = {
    id: 'fixture.profile', capability: 'agent.profile.fixture', target: 'agent',
    scopeId: 'installation:fixture:manager:profile', contractVersion: '1.0.0',
    artifact: { package: '@fixture/profile', version: '1.0.0', integrity: this.digest },
    executableDigest: this.digest,
  };
  static readonly capability = {
    typeId: 'external.health-probe', revision: this.digest, provider: this.provider,
    parameterSchema: { id: 'fixture.profile.parameters', version: '1.0.0', digest: this.digest },
    handler: { capability: 'agent.handler.probe', contractVersion: '1.0.0' },
    orchestration: { capability: 'agent.orchestration.probe', contractVersion: '1.0.0' },
  };
  static readonly profile = {
    id: 'fixture.check', typeId: this.capability.typeId, capabilityRevision: this.digest,
    handler: { providerId: 'fixture.handler', capability: 'agent.handler.probe', contractVersion: '1.0.0' },
    environmentId: 'fixture.environment', parameters: { message: 'harmless fixture' }, dependsOn: [],
  };
  static readonly definition = {
    schemaVersion: 'treeseed.agent-definition/v1', id: 'fixture.agent', revision: this.digest,
    profiles: [this.profile],
  };
}

class ActivityContractProgram {
  private readonly schemas = Reflect.get(sdk, 'ActivitySchemas') as Schemas;
  private readonly binding = Reflect.get(sdk, 'ActivityContractBinding') as Binding;

  run(): void {
    assert.equal(typeof Reflect.get(sdk, 'ActivitySchemas'), 'function', 'activity contracts must exist');
    this.externalType();
    this.selection();
    this.dependencies();
    assert.equal(sdk.PlatformOperations.all.length, 7);
    process.stdout.write('activity-contract-ok\n');
  }

  private externalType(): void {
    this.schemas.definition.parse(ActivityFixtures.definition);
    const result = this.binding.resolve(ActivityFixtures.definition, [ActivityFixtures.capability]);
    assert.equal(Array.isArray(result), true);
    assert.equal((result as unknown[]).length, 1);
  }

  private selection(): void {
    this.block(ActivityFixtures.definition, []);
    this.block(ActivityFixtures.definition, [ActivityFixtures.capability, ActivityFixtures.capability]);
    const incompatible = { ...ActivityFixtures.capability, handler: {
      ...ActivityFixtures.capability.handler, contractVersion: '2.0.0',
    } };
    this.block(ActivityFixtures.definition, [incompatible]);
    const profile = { ...ActivityFixtures.profile, capabilityRevision: 'b'.repeat(64) };
    this.block({ ...ActivityFixtures.definition, profiles: [profile] }, [ActivityFixtures.capability]);
  }

  private dependencies(): void {
    const profile = ActivityFixtures.profile;
    this.reject([profile, profile]);
    this.reject([{ ...profile, dependsOn: ['missing.profile'] }]);
    const other = { ...profile, id: 'fixture.other', dependsOn: [profile.id] };
    this.reject([{ ...profile, dependsOn: [other.id] }, other]);
    this.reject([{ ...profile, parameters: 'invalid-parameter-shape' }]);
  }

  private reject(profiles: unknown[]): void {
    assert.equal(this.schemas.definition.safeParse({ ...ActivityFixtures.definition, profiles }).success, false);
  }

  private block(definition: unknown, capabilities: unknown): void {
    assert.throws(this.binding.resolve.bind(null, definition, capabilities), /ACTIVITY_/);
  }
}

if (import.meta.main) new ActivityContractProgram().run();
