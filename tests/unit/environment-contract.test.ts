import { test, expect } from 'bun:test';
import * as sdk from '../../src/contracts.js';
import { EnvironmentFixtures as Fixture } from '../support/environment-contract-program.js';

interface Network {
  intersect(request: unknown, host: unknown, grant: unknown): unknown;
}
interface Schemas {
  definition: { safeParse(value: unknown): { success: boolean } };
}
class EnvironmentContractTests {
  private readonly network = Reflect.get(sdk, 'EnvironmentNetwork') as Network;
  private readonly schemas = Reflect.get(sdk, 'EnvironmentSchemas') as Schemas;

  private denied(request: unknown, host: unknown, grant: unknown, code: string): void {
    try {
      this.network.intersect(request, host, grant);
      throw new Error('unexpected acceptance');
    } catch (error) {
      expect((error as Error).message).toBe(code);
      expect(JSON.stringify(error)).not.toContain('secret-output-canary');
    }
  }

  malformed(): void {
    for (const host of ['*', 'Example.invalid', '001.2.3.4', '256.0.0.1', 'a..b', '::1']) {
      const request = {
        mode: 'allow-list',
        destinations: [{ ...Fixture.destination, host }],
      };
      this.denied(request, Fixture.online, Fixture.online, 'INVALID_ENVIRONMENT_CONTRACT');
    }
    this.denied(null, Fixture.online, Fixture.online, 'INVALID_ENVIRONMENT_CONTRACT');
    this.denied(Fixture.online, null, Fixture.online, 'INVALID_ENVIRONMENT_CONTRACT');
    this.denied(Fixture.online, Fixture.online, null, 'INVALID_ENVIRONMENT_CONTRACT');
  }

  denial(): void {
    this.denied(Fixture.online, Fixture.offline, Fixture.online, 'ENVIRONMENT_NETWORK_DENIED');
    this.denied(Fixture.online, Fixture.online, Fixture.offline, 'ENVIRONMENT_NETWORK_DENIED');
    const other = { ...Fixture.online, destinations: [{ ...Fixture.destination, port: 80 }] };
    this.denied(Fixture.online, other, Fixture.online, 'ENVIRONMENT_NETWORK_DENIED');
    const secret = { ...Fixture.online, credential: 'secret-output-canary' };
    this.denied(secret, Fixture.online, Fixture.online, 'INVALID_ENVIRONMENT_CONTRACT');
  }

  canonical(): void {
    const first = { ...Fixture.destination, host: 'a.example.invalid' };
    const last = { ...Fixture.destination, host: 'z.example.invalid' };
    const request = { mode: 'allow-list', destinations: [last, first] };
    const original = structuredClone(request);
    const result = this.network.intersect(request, request, request);
    expect(result).toEqual({ mode: 'allow-list', destinations: [first, last] });
    expect(request).toEqual(original);
    expect(result).not.toBe(request);
  }

  bounded(): void {
    for (const change of [
      { setup: { ...Fixture.entry, arguments: ['invalid\0argument'] } },
      { setup: { ...Fixture.entry, deadlineMs: 86400001 } },
      { verification: { ...Fixture.entry, outputLimitBytes: 1048577 } },
      { credential: 'secret-output-canary' },
      { image: { ...Fixture.definition.image, os: 'windows' } },
    ]) {
      expect(this.schemas.definition.safeParse({ ...Fixture.definition, ...change }).success).toBe(false);
    }
  }
}
const suite = new EnvironmentContractTests();
test('unit: environment destinations require canonical bounded network identities', suite.malformed.bind(suite));
test('unit: environment policy cannot exceed host and assignment grants or expose unsafe fields', suite.denial.bind(suite));
test('unit: granted environment destinations sort without mutating policy inputs', suite.canonical.bind(suite));
test('unit: environment entrypoints reject unbounded execution or credential fields', suite.bounded.bind(suite));
