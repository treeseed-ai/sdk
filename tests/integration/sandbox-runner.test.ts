import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import * as root from '../../src/contracts.js';
import * as portable from '../../src/portable.js';
import { SandboxRunnerFixture as Fixture } from '../support/sandbox-runner-program.js';
import { CapacityChannelFixtures as Channel } from '../support/capacity-channel-program.js';
class SandboxRunnerProjection {
  request(): void {
    const document = JSON.parse(readFileSync('dist/contract.json', 'utf8'));
    const schema = z.fromJSONSchema(document.schemas.sandboxRunnerRequest);
    assert.equal(schema.safeParse(Fixture.request()).success, true);
    assert.equal(schema.safeParse(Fixture.request(Channel.request('worker'))).success, false);
    assert.equal(schema.safeParse({ ...Fixture.request(), command: '/bin/sh' }).success, false);
    assert.equal(document.schemas.sandboxRunnerGrant.properties.operations.uniqueItems, true);
  }
  response(): void {
    const document = JSON.parse(readFileSync('dist/contract.json', 'utf8'));
    const schema = z.fromJSONSchema(document.schemas.sandboxRunnerResponse);
    assert.equal(schema.safeParse(Fixture.reply()).success, true);
    assert.equal(schema.safeParse(Fixture.reply(Channel.reply('worker'))).success, false);
    assert.equal(
      schema.safeParse({
        ...Fixture.reply(),
        success: false,
        problem: { code: 'SANDBOX_OPERATION_FAILED' },
      }).success,
      false,
    );
  }
  portable(): void {
    assert.equal(typeof Reflect.get(root, 'SandboxRunnerSchemas'), 'function');
    assert.equal(
      Reflect.get(root, 'SandboxRunnerSchemas'),
      Reflect.get(portable, 'SandboxRunnerSchemas'),
    );
    assert.equal(
      Reflect.get(root, 'SandboxRunnerBinding'),
      Reflect.get(portable, 'SandboxRunnerBinding'),
    );
    assert.equal(root.PlatformOperations.all.length, 7);
    assert.equal(root.SandboxControlSchemas.operation.options.length, 6);
  }
}
const suite = new SandboxRunnerProjection();
test(
  'integration: generated host runner requests retain positive guest-only schemas',
  suite.request.bind(suite),
);
test(
  'integration: generated host runner responses exclude worker outcomes and false success',
  suite.response.bind(suite),
);
test(
  'integration: root and portable exports expose one host runner bridge contract',
  suite.portable.bind(suite),
);
