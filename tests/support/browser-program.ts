import {
  Context,
  CordisScope,
  type CompositionDescriptor,
  type ProviderLease,
} from '@treeseed-cordis/sdk/composition';
import {
  CapabilityToken,
  ProviderV4Schemas,
  PlatformSchemas,
  PluginSource,
  PluginManagementSchemas,
  SandboxProfileBinding,
  SandboxProfileError,
  CanonicalJson,
  CapacityChannelSchemas,
  CapacityChannelBinding,
} from '@treeseed-cordis/sdk/portable';
interface Value {
  read(): string;
}
class ValueValidation {
  parse(value: unknown): Value {
    if (!value || typeof Reflect.get(value, 'read') !== 'function')
      throw new Error('INVALID_VALUE');
    return value as Value;
  }
}
const token = new CapabilityToken<Value>(
  'fixture.value',
  ProviderV4Schemas.version,
  new ValueValidation(),
);
class FirstPlugin implements Value {
  static live = 0;
  static count(): number {
    return this.live;
  }
  static readonly provide = ['fixture.value'];
  static readonly inject: string[] = [];
  static readonly Config = PlatformSchemas.empty;
  static readonly declaration = ProviderV4Schemas.declaration.parse({
    id: 'fixture.first',
    pluginId: 'fixture',
    capability: token.id,
    target: 'browser',
    contractVersion: ProviderV4Schemas.version,
    provide: this.provide,
    inject: this.inject,
  });
  constructor(context: Context) {
    FirstPlugin.live++;
    context.provide(token.id, this);
    context.effect(this.effect.bind(this));
  }
  private effect(): () => void {
    return this.stop.bind(this);
  }
  private stop(): void {
    FirstPlugin.live--;
  }
  read(): string {
    return 'first';
  }
}
class SecondPlugin extends FirstPlugin {
  static override readonly declaration = { ...FirstPlugin.declaration, id: 'fixture.second' };
  override read(): string {
    return 'second';
  }
}
class BrowserProgram {
  private static readonly profileContent = {
    schemaVersion: 'treeseed.sandbox-profile/v1',
    id: 'profile:browser',
    runtime: { name: 'kata', version: '4.1.0', archiveDigest: 'a'.repeat(64) },
    image: {
      reference: 'fixture.invalid/guest@sha256:' + 'a'.repeat(64),
      manifestDigest: 'a'.repeat(64),
      os: 'linux',
      architecture: 'amd64',
    },
    resources: { vcpus: 1, memoryMiB: 512, scratchMiB: 256 },
    isolationPolicyDigest: 'a'.repeat(64),
  };
  private static readonly managerContext = {
    role: 'manager',
    scope: {
      installationId: 'fixture.installation',
      installationDirectory: '/fixture/capacity',
      capacityProviderId: 'fixture.capacity',
      project: 'fixture.project',
      platformProfile: 'default',
      workerId: 'fixture.worker',
    },
    generation: { compositionGeneration: 'a'.repeat(64), processGeneration: 'b'.repeat(64) },
  };
  private static readonly managerRequest = {
    schemaVersion: 'treeseed.capacity-channel/v1',
    requestId: 'fixture.manager',
    scope: this.managerContext.scope,
    role: 'manager',
    operation: 'ready',
    expectedGeneration: null,
    parameters: {},
  };
  private static readonly managerResponse = {
    schemaVersion: 'treeseed.capacity-channel/v1',
    requestId: 'fixture.manager',
    scope: this.managerContext.scope,
    role: 'manager',
    operation: 'ready',
    generation: this.managerContext.generation,
    success: true,
    problem: null,
    result: {
      schemaVersion: 'treeseed.capacity-readiness/v1',
      ...this.managerContext,
      ready: true,
      blockers: [],
    },
  };
  private static manager(): void {
    CapacityChannelBinding.assertRequest(this.managerRequest, this.managerContext);
    CapacityChannelBinding.assertResponse(this.managerResponse, this.managerRequest);
    this.assert(
      !CapacityChannelSchemas.request.safeParse({ ...this.managerRequest, operation: 'cancel' })
        .success,
    );
  }
  static descriptor(next: boolean): CompositionDescriptor {
    const plugin = next ? SecondPlugin : FirstPlugin;
    return {
      registrations: [
        {
          token,
          plugin,
          declaration: plugin.declaration,
          configuration: {},
          artifact: { kind: 'bundled', identity: plugin.declaration.id },
        },
      ],
      selections: [
        { scopeId: 'browser-fixture', capability: token.id, providerId: plugin.declaration.id },
      ],
    };
  }
  static assert(condition: unknown): asserts condition {
    if (!condition) throw new Error('BROWSER_COMPOSITION_ASSERTION');
  }
  static async run(): Promise<string> {
    this.sources();
    this.manager();
    await this.profile();
    const scope = await this.mount();
    let lease = await scope.acquire(token);
    try {
      this.assert(lease.value.read() === 'first' && FirstPlugin.count() === 1);
      await this.replace(scope, lease);
      lease = await scope.acquire(token);
      this.assert(lease.value.read() === 'second');
    } finally {
      await lease.release();
      await scope.dispose();
    }
    this.assert(FirstPlugin.count() === 0);
    return 'native-browser-ok';
  }
  private static sources(): void {
    this.assert(PluginSource.parse('@fixture/plugin@^1').kind === 'npm');
    this.assert(
      PluginManagementSchemas.source.safeParse('@fixture/plugin@latest random').success === false,
    );
  }
  private static mount(): Promise<CordisScope> {
    return CordisScope.start(this.descriptor(false), {
      scopeId: 'browser-fixture',
      target: 'browser',
      principalId: 'fixture',
      resourceScope: 'browser-fixture',
    });
  }
  private static async replace(scope: CordisScope, lease: ProviderLease<Value>): Promise<void> {
    const generation = scope.generation;
    this.assert(
      (await scope.beginReplacement(this.descriptor(true), generation, 1)).state === 'pending',
    );
    await lease.release();
    this.assert((await scope.continueReplacement(1000)).state === 'mounted');
    const candidate = await scope.inspectCandidate(token);
    try {
      this.assert(candidate.value.read() === 'second' && FirstPlugin.count() === 1);
    } finally {
      await candidate.release();
    }
    scope.commitReplacement();
    this.assert(scope.generation !== generation);
  }
  private static async profile(): Promise<void> {
    const profile = await SandboxProfileBinding.create(this.profileContent);
    const accepted = await SandboxProfileBinding.assert(profile);
    this.assert(CanonicalJson.stringify(profile) === CanonicalJson.stringify(accepted));
    this.assert(profile.network.mode === 'offline');
    let rejected = false;
    try {
      await SandboxProfileBinding.assert({ ...profile, revision: 'b'.repeat(64) });
    } catch (error) {
      rejected = error instanceof SandboxProfileError && error.code === 'SANDBOX_PROFILE_INVALID';
    }
    this.assert(rejected);
  }
}
declare global {
  interface Window {
    sdkQualification: Promise<string>;
  }
}
window.sdkQualification = BrowserProgram.run();
