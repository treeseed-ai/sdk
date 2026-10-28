import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { SandboxControlSchemas } from '../../src/contracts.js';
import * as portable from '../../src/portable.js';
import { SandboxControlFixture as Fixture } from '../support/sandbox-control-program.js';
class SandboxProjectionIntegration {
  generated(): void {
    const document = JSON.parse(readFileSync('dist/contract.json', 'utf8'));
    const request = z.fromJSONSchema(document.schemas.sandboxControlRequest);
    assert.equal(request.safeParse(Fixture.request()).success, true);
    const escaped = Fixture.request('execute', {
      sandboxId: Fixture.sandboxId,
      phase: 'setup',
      command: ['/bin/sh'],
    });
    assert.equal(request.safeParse(escaped).success, false);
  }
  responses(): void {
    const document = JSON.parse(readFileSync('dist/contract.json', 'utf8'));
    const response = z.fromJSONSchema(document.schemas.sandboxControlResponse);
    assert.equal(response.safeParse(Fixture.reply()).success, true);
    const exposed = Fixture.reply('create', {
      ...Fixture.evidence(),
      hostSocket: '/run/containerd.sock',
    });
    assert.equal(response.safeParse(exposed).success, false);
  }
  grants(): void {
    const document = JSON.parse(readFileSync('dist/contract.json', 'utf8'));
    const grant = z.fromJSONSchema(document.schemas.sandboxControlGrant);
    assert.equal(grant.safeParse(Fixture.grant).success, true);
    assert.equal(
      grant.safeParse({ ...Fixture.grant, operations: ['create', 'create'] }).success,
      false,
    );
  }
  portable(): void {
    assert.equal(portable.SandboxControlSchemas, SandboxControlSchemas);
    assert.equal(portable.SandboxControlSchemas.version, '1.0.0-cordis.1');
    for (const name of ['command', 'image', 'hostPath', 'runtimeSocket']) {
      const parameters = { sandboxId: Fixture.sandboxId, [name]: 'ungranted' };
      assert.equal(
        SandboxControlSchemas.request.safeParse(Fixture.request('create', parameters)).success,
        false,
      );
    }
  }
}
const suite = new SandboxProjectionIntegration();
test(
  'integration: generated sandbox control projections preserve positive private boundaries',
  suite.generated.bind(suite),
);
test(
  'integration: root and portable sandbox contracts expose identical closed host request schemas',
  suite.portable.bind(suite),
);
test(
  'integration: generated sandbox grants reject duplicate operation authority',
  suite.grants.bind(suite),
);
test(
  'integration: generated sandbox replies exclude physical host authority and raw endpoints',
  suite.responses.bind(suite),
);
