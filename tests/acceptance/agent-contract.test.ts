import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
class AgentContractProgram {
    publicArtifact(): void {
        const code = `import assert from 'node:assert/strict';
import * as sdk from '@treeseed-cordis/sdk/portable';
class Program {
 static run() {
  assert.equal(typeof sdk.AgentSchemas, 'function', 'portable Agent contract must exist');
  const authority={scopeId:'installation:fixture:agent',principalId:'subject:fixture',resourceScope:'resource:fixture',grantId:'grant:fixture',grantRevision:1,state:'granted'};
  const request={protocol:1,operation:'composition-probe',executionId:'execution:one',scopeId:authority.scopeId,principalId:authority.principalId,resourceScope:authority.resourceScope,grantId:authority.grantId,grantRevision:1,expectedGeneration:'a'.repeat(64),handlerId:'fixture.echo',text:'harmless fixture'};
  assert.deepEqual(sdk.AgentContractBinding.assert(request,authority,request.expectedGeneration),request);
  for (const input of [{...request,principalId:'subject:other'},{...request,grantId:'grant:other'},{...request,expectedGeneration:'b'.repeat(64)}]) {
   assert.throws(sdk.AgentContractBinding.assert.bind(null,input,authority,request.expectedGeneration),sdk.AgentContractError);
  }
  assert.equal(sdk.PlatformOperations.all.length,7);
  process.stdout.write('agent-contract-ok\\n');
 }
}
Program.run();`;
        const result = spawnSync('node', ['--input-type=module', '-e', code], { encoding: 'utf8' });
        expect(result.stderr).toBe('');
        expect(result.status).toBe(0);
        expect(result.stdout).toBe('agent-contract-ok\n');
    }
}
const suite = new AgentContractProgram();
test('acceptance: built public portable Agent contracts bind scope grant and generation', suite.publicArtifact.bind(suite));
