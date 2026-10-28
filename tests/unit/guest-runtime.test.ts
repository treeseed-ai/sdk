import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { GuestRuntimeFixture as Fixture } from '../support/guest-runtime-program.js';
class GuestRuntimeUnit {
  positive(): void {
    const input = Fixture.manifest();
    assert.deepEqual(Fixture.binding().assert(input), input);
    const reversed = { ...input, requiredLibraries: [...input.requiredLibraries].reverse() };
    assert.deepEqual(Fixture.binding().assert(reversed), reversed);
    const single = {
      ...input,
      compressed: { ...input.compressed, size: 10, parts: [Fixture.part(0, 10)] },
    };
    assert.deepEqual(Fixture.binding().assert(single), single);
  }
  runtime(): void {
    const input = Fixture.manifest();
    for (const patch of [
      { compiler: 'bun@latest' },
      { target: 'bun-linux-x64-musl-baseline' },
      { os: 'darwin' },
      { architecture: 'arm64' },
      { interpreter: '/tmp/private-canary' },
      { requiredLibraries: ['libc.so.6'] },
      { requiredLibraries: Array(5).fill('libc.so.6') },
      { command: '/bin/sh' },
    ])
      this.reject({ ...input, ...patch });
  }
  chunks(): void {
    const input = Fixture.manifest();
    for (const parts of [
      [],
      [Fixture.part(1, 10)],
      [Fixture.part(0, 0)],
      [Fixture.part(0, Fixture.limit + 1)],
      [Fixture.part(0, 1), Fixture.part(1, 9)],
      [Fixture.part(), Fixture.part(0, 10)],
      [Fixture.part(), { ...Fixture.part(1, 10), file: '../private-canary' }],
    ])
      this.reject({ ...input, compressed: { ...input.compressed, parts } });
  }
  identities(): void {
    const input = Fixture.manifest();
    for (const patch of [
      { size: input.compressed.size + 1 },
      { size: 64 * 1024 * 1024 + 1 },
      { size: 1.1 },
      { sha256: 'G'.repeat(64) },
      { sha256: 'short' },
      { format: 'zip' },
    ])
      this.reject({ ...input, compressed: { ...input.compressed, ...patch } });
    for (const patch of [
      { size: 63 },
      { size: 128 * 1024 * 1024 + 1 },
      { mode: 0o777 },
      { sha256: 'private-canary' },
      { path: '/tmp/private-canary' },
    ])
      this.reject({ ...input, executable: { ...input.executable, ...patch } });
  }
  upperBound(): void {
    const input = Fixture.manifest();
    const parts = Array.from({ length: 17 }, Fixture.part.bind(Fixture));
    this.reject({ ...input, compressed: { ...input.compressed, parts } });
    this.reject(null);
    this.reject('private-canary');
  }
  private reject(input: unknown): void {
    assert.throws(Fixture.binding().assert.bind(Fixture.binding(), input), {
      name: 'GuestRuntimeContractError',
      message: 'INVALID_GUEST_RUNTIME',
    });
  }
}
const suite = new GuestRuntimeUnit();
test(
  'unit: guest payload admits qualified single and multipart identities and library set order',
  suite.positive.bind(suite),
);
test(
  'unit: guest payload rejects unqualified runtimes and undeclared host powers',
  suite.runtime.bind(suite),
);
test(
  'unit: guest payload rejects gaps duplicates paths zero chunks and short intermediate parts',
  suite.chunks.bind(suite),
);
test(
  'unit: guest payload binds exact bounded stream and executable identities',
  suite.identities.bind(suite),
);
test(
  'unit: guest payload bounds manifest part count and emits only fixed safe failures',
  suite.upperBound.bind(suite),
);
