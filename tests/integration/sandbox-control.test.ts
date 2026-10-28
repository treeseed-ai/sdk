import { test } from 'bun:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import { readFileSync } from 'node:fs';
import { SandboxControlSchemas } from '../../src/contracts.js';
import * as portable from '../../src/portable.js';
import { SandboxControlFixture as Fixture } from '../support/sandbox-control-program.js';
class SandboxProjectionIntegration {
  generated(): void {
    const document = JSON.parse(readFileSync('dist/contract.json', 'utf8'));
    const validator = new Ajv2020({ strict: false });
    const request = validator.compile(document.schemas.sandboxControlRequest);
    assert.equal(request(Fixture.request()), true);
    assert.equal(
      request(
        Fixture.request('execute', {
          sandboxId: Fixture.sandboxId,
          phase: 'setup',
          command: ['/bin/sh'],
        }),
      ),
      false,
    );
  }
  responses(): void {
    const document = JSON.parse(readFileSync('dist/contract.json', 'utf8'));
    const validator = new Ajv2020({ strict: false });
    const response = validator.compile(document.schemas.sandboxControlResponse);
    assert.equal(response(Fixture.reply()), true);
    assert.equal(
      response(
        Fixture.reply('create', { ...Fixture.evidence(), hostSocket: '/run/containerd.sock' }),
      ),
      false,
    );
  }
  grants(): void {
    const document = JSON.parse(readFileSync('dist/contract.json', 'utf8'));
    const validator = new Ajv2020({ strict: false });
    const grant = validator.compile(document.schemas.sandboxControlGrant);
    assert.equal(grant(Fixture.grant), true);
    assert.equal(grant({ ...Fixture.grant, operations: ['create', 'create'] }), false);
  }
  portable(): void {
    assert.equal(portable.SandboxControlSchemas, SandboxControlSchemas);
    assert.equal(portable.SandboxControlSchemas.version, '1.0.0-cordis.1');
    const inputs = ['command', 'image', 'hostPath', 'runtimeSocket'];
    for (const name of inputs) {
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
