import assert from 'node:assert/strict';
import * as sdk from '@treeseed-cordis/sdk/portable';

interface Schema {
  parse(value: unknown): { network: unknown };
  safeParse(value: unknown): { success: boolean };
}
interface Network {
  intersect(requested: unknown, host: unknown, assignment: unknown): unknown;
}

/** Exact-shaped data fixtures only, not verified package or OCI artifacts. */
export class EnvironmentFixtures {
  static readonly digest = 'a'.repeat(64);
  static readonly entry = {
    file: { path: 'dist/setup', sha256: this.digest, size: 1 },
    arguments: [],
    deadlineMs: 30000,
    outputLimitBytes: 4096,
  };
  static readonly definition = {
    schemaVersion: 'treeseed.agent-environment/v1',
    id: 'fixture.environment',
    revision: this.digest,
    artifact: { package: '@fixture/environment', version: '1.0.0', integrity: this.digest },
    image: {
      reference: 'fixture/base@sha256:' + this.digest,
      manifestDigest: this.digest,
      os: 'linux',
      architecture: 'amd64',
    },
    setup: this.entry,
    verification: this.entry,
  };
  static readonly offline = { mode: 'offline', destinations: [] };
  static readonly destination = { protocol: 'tcp', host: 'registry.example.invalid', port: 443 };
  static readonly online = { mode: 'allow-list', destinations: [this.destination] };
}

class EnvironmentContractProgram {
  private readonly schema = (Reflect.get(sdk, 'EnvironmentSchemas') as { definition: Schema })
    ?.definition;
  private readonly network = Reflect.get(sdk, 'EnvironmentNetwork') as Network;

  run(): void {
    assert.equal(
      typeof Reflect.get(sdk, 'EnvironmentSchemas'),
      'function',
      'environment contracts must exist',
    );
    assert.deepEqual(
      this.schema.parse(EnvironmentFixtures.definition).network,
      EnvironmentFixtures.offline,
    );
    this.entrypoints();
    this.permissions();
    process.stdout.write('environment-contract-ok\n');
  }

  private entrypoints(): void {
    this.reject({
      setup: {
        ...EnvironmentFixtures.entry,
        file: {
          ...EnvironmentFixtures.entry.file,
          path: '../host-escape',
        },
      },
    });
    this.reject({ setup: { ...EnvironmentFixtures.entry, deadlineMs: 0 } });
    this.reject({ setup: { ...EnvironmentFixtures.entry, outputLimitBytes: 0 } });
    this.reject({ image: { ...EnvironmentFixtures.definition.image, architecture: 'arm64' } });
    this.reject({
      image: { ...EnvironmentFixtures.definition.image, reference: 'fixture/base:latest' },
    });
    this.reject({
      image: { ...EnvironmentFixtures.definition.image, manifestDigest: 'b'.repeat(64) },
    });
  }

  private permissions(): void {
    const online = EnvironmentFixtures.online;
    const offline = EnvironmentFixtures.offline;
    assert.deepEqual(this.network.intersect(online, online, online), online);
    assert.deepEqual(this.network.intersect(offline, online, online), offline);
    assert.throws(
      this.network.intersect.bind(null, online, offline, online),
      /ENVIRONMENT_NETWORK_DENIED/,
    );
    assert.throws(
      this.network.intersect.bind(null, online, online, offline),
      /ENVIRONMENT_NETWORK_DENIED/,
    );
    this.reject({
      network: { ...online, destinations: [online.destinations[0], online.destinations[0]] },
    });
    this.reject({
      network: { ...online, destinations: [{ ...EnvironmentFixtures.destination, host: '*' }] },
    });
  }

  private reject(change: object): void {
    assert.equal(
      this.schema.safeParse({ ...EnvironmentFixtures.definition, ...change }).success,
      false,
    );
  }
}

if (import.meta.main) new EnvironmentContractProgram().run();
