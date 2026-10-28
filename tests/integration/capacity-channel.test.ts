import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { CapacityChannelFixtures as Fixture } from '../support/capacity-channel-program.js';
import * as root from '../../src/contracts.js';
import * as portable from '../../src/portable.js';
class CapacityChannelProjection {
  request(): void {
    const document = JSON.parse(readFileSync('dist/contract.json', 'utf8'));
    const schema = z.fromJSONSchema(document.schemas.capacityChannelRequest);
    assert.equal(schema.safeParse(Fixture.request()).success, true);
    assert.equal(schema.safeParse(Fixture.request('runner', 'reserve', {})).success, false);
    assert.equal(schema.safeParse({ ...Fixture.request(), command: '/bin/sh' }).success, false);
  }
  reply(): void {
    const document = JSON.parse(readFileSync('dist/contract.json', 'utf8'));
    const schema = z.fromJSONSchema(document.schemas.capacityChannelResponse);
    assert.equal(schema.safeParse(Fixture.reply()).success, true);
    assert.equal(schema.safeParse({ ...Fixture.reply(), hostSocket: '/run/runtime' }).success, false);
    assert.equal(schema.safeParse(Fixture.reply('worker', 'ready', Fixture.ready('manager'))).success, false);
  }
  portable(): void {
    assert.equal(Reflect.get(root, 'CapacityChannelSchemas'), Reflect.get(portable, 'CapacityChannelSchemas'));
    assert.equal(Reflect.get(root, 'CapacityChannelBinding'), Reflect.get(portable, 'CapacityChannelBinding'));
    assert.equal(root.PlatformOperations.all.length, 7);
  }
}
const suite = new CapacityChannelProjection();
test('integration: generated capacity service requests preserve positive worker and guest shapes', suite.request.bind(suite));
test('integration: generated capacity service replies exclude host configuration and foreign roles', suite.reply.bind(suite));
test('integration: root and portable capacity service projections expose one owner contract', suite.portable.bind(suite));
