import assert from 'node:assert/strict';
import * as sdk from '@treeseed-cordis/sdk/portable';
class SandboxControlProgram {
  run(): void {
    assert.equal(typeof Reflect.get(sdk, 'SandboxControlSchemas'), 'function', 'portable bounded sandbox schema must exist');
    assert.equal(typeof Reflect.get(sdk, 'SandboxControlBinding'), 'function', 'portable scope/reply binding must exist');
    assert.equal(sdk.PlatformOperations.all.length, 7);
    process.stdout.write('sandbox-control-ok\n');
  }
}
new SandboxControlProgram().run();
