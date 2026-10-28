import assert from 'node:assert/strict';
import * as sdk from '@treeseed-cordis/sdk/portable';
import { CapacityFixtures } from './capacity-contract-program.js';
import { CapacityProtocolFixtures } from './capacity-protocol-program.js';
interface ChannelBinding {
  assertRequest(input: unknown, trusted: unknown): unknown;
  assertResponse(input: unknown, request: unknown): unknown;
}
interface ChannelSchema {
  safeParse(input: unknown): { success: boolean };
}
export class CapacityChannelFixtures {
  static readonly scope = CapacityFixtures.scope;
  static readonly generation = CapacityFixtures.process;
  static context(role = 'worker'): object {
    return { scope: this.scope, role, generation: this.generation };
  }
  static request(role = 'worker', operation = 'ready', parameters: object = {}): object {
    return {
      schemaVersion: 'treeseed.capacity-channel/v1',
      requestId: 'channel:fixture',
      scope: this.scope,
      role,
      operation,
      expectedGeneration: this.generation,
      parameters,
    };
  }
  static reply(role = 'worker', operation = 'ready', result: unknown = this.ready(role)): object {
    return {
      schemaVersion: 'treeseed.capacity-channel/v1',
      requestId: 'channel:fixture',
      scope: this.scope,
      role,
      operation,
      generation: this.generation,
      success: true,
      result,
      problem: null,
    };
  }
  static ready(role: string): object {
    return {
      schemaVersion: 'treeseed.capacity-readiness/v1',
      role,
      scope: this.scope,
      generation: this.generation,
      ready: true,
      blockers: [],
    };
  }
  static binding(): ChannelBinding {
    const binding = Reflect.get(sdk, 'CapacityChannelBinding');
    assert.equal(typeof binding, 'function', 'portable capacity channel binding must exist');
    return binding;
  }
  static schema(name: string): ChannelSchema {
    const schemas = Reflect.get(sdk, 'CapacityChannelSchemas');
    assert.equal(typeof schemas, 'function', 'portable capacity channel schemas must exist');
    return Reflect.get(schemas, name);
  }
}
class CapacityChannelProgram {
  run(): void {
    const fixture = CapacityChannelFixtures;
    const binding = fixture.binding();
    const request = fixture.request();
    binding.assertRequest(request, fixture.context());
    binding.assertResponse(fixture.reply(), request);
    const run = fixture.request('runner', 'run', { request: CapacityProtocolFixtures.dispatch });
    binding.assertRequest(run, fixture.context('runner'));
    binding.assertResponse(fixture.reply('runner', 'run', CapacityProtocolFixtures.runner), run);
    assert.equal(sdk.PlatformOperations.all.length, 7);
    process.stdout.write('capacity-channel-ok\n');
  }
}
if (import.meta.main) new CapacityChannelProgram().run();
