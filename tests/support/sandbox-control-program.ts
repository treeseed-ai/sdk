import assert from 'node:assert/strict';
import * as sdk from '@treeseed-cordis/sdk/portable';
/** Portable contract fixtures only; no authentication, runtime or host-custody claim. */
export class SandboxControlFixture {
  static readonly sandboxId = 'sandbox-11111111-1111-4111-8111-111111111111';
  static readonly scope = { installationId:'installation:fixture', serviceId:'worker', providerGeneration:'a'.repeat(64), serviceGeneration:'b'.repeat(64) };
  static readonly grant = { schemaVersion:'treeseed.sandbox-grant/v1', id:'grant:fixture', revision:1, scope:this.scope, state:'granted', expiresAtEpochMs:2000, operations:['ready','create','inspect','assign','execute','destroy'] };
  static request(operation = 'create', parameters: object = { sandboxId: this.sandboxId }): unknown {
    return { schemaVersion:'treeseed.sandbox-control/v1', requestId:'request:fixture', scope:this.scope, operation, parameters };
  }
  static reply(operation = 'create', result: unknown = this.evidence()): unknown {
    return { schemaVersion:'treeseed.sandbox-control/v1', requestId:'request:fixture', scope:this.scope, operation, success:true, result, problem:null };
  }
  static assignment(): object {
    return { sandboxId:this.sandboxId, assignmentId:'assignment:fixture', environmentId:'environment:fixture', environmentDigest:'c'.repeat(64), environmentRevision:'d'.repeat(64) };
  }
  static evidence(): object {
    return { sandboxId:this.sandboxId, inspectionDigest:'e'.repeat(64), assignment:null };
  }
  static receipt(): object {
    return { sandboxId:this.sandboxId, environmentId:'environment:fixture', environmentRevision:'d'.repeat(64), phase:'setup', entrypointDigest:'f'.repeat(64), networkDigest:'c'.repeat(64), inspectionDigest:'e'.repeat(64), exitCode:0, outputBytes:12 };
  }
}
class SandboxControlProgram {
  run(): void {
    assert.equal(typeof sdk.SandboxControlSchemas, 'function');
    const request = sdk.SandboxControlBinding.assertRequest(SandboxControlFixture.request(), SandboxControlFixture.grant, 1000);
    const response = sdk.SandboxControlBinding.assertResponse(SandboxControlFixture.reply(), request);
    assert.equal(response.success, true);
    assert.equal(sdk.PlatformOperations.all.length, 7);
    process.stdout.write('sandbox-control-ok\n');
  }
}
if (import.meta.main) new SandboxControlProgram().run();
