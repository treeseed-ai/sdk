import assert from 'node:assert/strict';
import * as sdk from '@treeseed-cordis/sdk/portable';
interface RuntimeBinding {
  assert(input: unknown): unknown;
}
export class GuestRuntimeFixture {
  static readonly limit = 7 * 1024 * 1024;
  static readonly libraries = [
    'ld-linux-x86-64.so.2',
    'libc.so.6',
    'libdl.so.2',
    'libm.so.6',
    'libpthread.so.0',
  ];
  static part(index = 0, size = this.limit): object {
    return {
      file: 'trsd-agent-guest.' + String(index).padStart(3, '0') + '.gzpart',
      size,
      sha256: 'a'.repeat(64),
    };
  }
  static manifest() {
    return {
      schemaVersion: 'treeseed.guest-runtime/v1',
      compiler: 'bun@1.4.4',
      target: 'bun-linux-x64-baseline',
      os: 'linux',
      architecture: 'amd64',
      interpreter: '/lib64/ld-linux-x86-64.so.2',
      requiredLibraries: [...this.libraries],
      compressed: {
        format: 'gzip',
        size: this.limit + 10,
        sha256: 'b'.repeat(64),
        parts: [this.part(), this.part(1, 10)],
      },
      executable: { mode: 0o755, size: 110000000, sha256: 'c'.repeat(64) },
    };
  }
  static binding(): RuntimeBinding {
    const value = Reflect.get(sdk, 'GuestRuntimeBinding');
    assert.equal(typeof value, 'function', 'portable guest payload binding must exist');
    return value;
  }
}
class GuestRuntimeProgram {
  run(): void {
    const binding = GuestRuntimeFixture.binding();
    const input = GuestRuntimeFixture.manifest();
    assert.deepEqual(binding.assert(input), input);
    assert.throws(binding.assert.bind(binding, { ...input, interpreter: '/tmp/private-canary' }), {
      message: 'INVALID_GUEST_RUNTIME',
    });
    assert.equal(sdk.PlatformOperations.all.length, 7);
    process.stdout.write('guest-runtime-ok\n');
  }
}
if (import.meta.main) new GuestRuntimeProgram().run();
