import assert from 'node:assert/strict';
import * as sdk from '@treeseed-cordis/sdk/portable';
import { CapacityChannelFixtures as Channel } from './capacity-channel-program.js';
import { CapacityProtocolFixtures as Protocol } from './capacity-protocol-program.js';
import { CapacityFixtures as Capacity } from './capacity-contract-program.js';
import { SandboxControlFixture as Host } from './sandbox-control-program.js';
interface RunnerBinding {
  assertRequest(input: unknown, grant: unknown, generation: unknown, now: number): unknown;
  assertResponse(input: unknown, request: unknown): unknown;
}
interface RunnerSchema {
  safeParse(input: unknown): { success: boolean };
}
export class SandboxRunnerFixture {
  static readonly id = Host.sandboxId;
  static readonly scope = { ...Host.scope, installationId: Capacity.scope.installationId };
  static readonly grant = {
    schemaVersion: 'treeseed.sandbox-runner-grant/v1',
    id: 'grant:runner',
    revision: 1,
    scope: this.scope,
    capacityScope: Capacity.scope,
    state: 'granted',
    expiresAtEpochMs: 10000,
    operations: ['ready', 'run', 'cancel'],
  };
  static frame(operation = 'ready'): object {
    if (operation === 'ready') return { ...Channel.request('runner'), expectedGeneration: null };
    const lease = { ...Capacity.lease, sandboxId: this.id };
    return Channel.request(
      'runner',
      operation,
      operation === 'run' ? { request: { ...Protocol.dispatch, lease } } : { lease },
    );
  }
  static request(frame = this.frame()): object {
    return {
      schemaVersion: 'treeseed.sandbox-runner/v1',
      requestId: 'channel:fixture',
      scope: this.scope,
      sandboxId: this.id,
      frame,
    };
  }
  static reply(frame = Channel.reply('runner')): object {
    return {
      schemaVersion: 'treeseed.sandbox-runner/v1',
      requestId: 'channel:fixture',
      scope: this.scope,
      sandboxId: this.id,
      success: true,
      result: frame,
      problem: null,
    };
  }
  static binding(): RunnerBinding {
    const value = Reflect.get(sdk, 'SandboxRunnerBinding');
    assert.equal(typeof value, 'function', 'portable logical sandbox runner binding must exist');
    return value;
  }
  static schema(name: string): RunnerSchema {
    const value = Reflect.get(sdk, 'SandboxRunnerSchemas');
    assert.equal(typeof value, 'function', 'portable logical sandbox runner schema must exist');
    return Reflect.get(value, name);
  }
}
class SandboxRunnerProgram {
  run(): void {
    const binding = SandboxRunnerFixture.binding();
    for (const operation of ['ready', 'run', 'cancel']) this.operation(binding, operation);
    assert.equal(sdk.PlatformOperations.all.length, 7);
    assert.equal(sdk.SandboxControlSchemas.operation.options.length, 6);
    process.stdout.write('sandbox-runner-ok\n');
  }
  private operation(binding: RunnerBinding, operation: string): void {
    const request = SandboxRunnerFixture.request(SandboxRunnerFixture.frame(operation));
    binding.assertRequest(request, SandboxRunnerFixture.grant, Capacity.process, 1000);
    const lease = { ...Capacity.lease, sandboxId: SandboxRunnerFixture.id };
    const outcome = { ...Protocol.runner, lease };
    const reply = SandboxRunnerFixture.reply(
      Channel.reply('runner', operation, operation === 'ready' ? Channel.ready('runner') : outcome),
    );
    binding.assertResponse(reply, request);
  }
}
if (import.meta.main) new SandboxRunnerProgram().run();
