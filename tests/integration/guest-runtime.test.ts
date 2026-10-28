import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import * as root from '../../src/contracts.js';
import * as portable from '../../src/portable.js';
import { GuestRuntimeFixture as Fixture } from '../support/guest-runtime-program.js';
class GuestRuntimeProjection {
  schema(): void {
    const document = JSON.parse(readFileSync('dist/contract.json', 'utf8'));
    assert.ok(document.schemas.guestRuntime, 'guest payload must have a generated schema');
    const schema = z.fromJSONSchema(document.schemas.guestRuntime);
    assert.equal(schema.safeParse(Fixture.manifest()).success, true);
    assert.equal(schema.safeParse({ ...Fixture.manifest(), command: '/bin/sh' }).success, false);
    assert.equal(schema.safeParse({ ...Fixture.manifest(), architecture: 'arm64' }).success, false);
    assert.equal(document.schemas.guestRuntime.properties.requiredLibraries.uniqueItems, true);
  }
  exports(): void {
    assert.equal(typeof Reflect.get(root, 'GuestRuntimeSchemas'), 'function');
    assert.equal(
      Reflect.get(root, 'GuestRuntimeSchemas'),
      Reflect.get(portable, 'GuestRuntimeSchemas'),
    );
    assert.equal(
      Reflect.get(root, 'GuestRuntimeBinding'),
      Reflect.get(portable, 'GuestRuntimeBinding'),
    );
    assert.equal(root.PlatformOperations.all.length, 7);
  }
}
const suite = new GuestRuntimeProjection();
test(
  'integration: generated guest payload schema preserves bounded positive runtime requirements',
  suite.schema.bind(suite),
);
test(
  'integration: root and portable exports share one standalone guest payload contract',
  suite.exports.bind(suite),
);
