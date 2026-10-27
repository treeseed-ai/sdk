import { test, expect } from 'bun:test';
import { PlatformOperations, PlatformSchemas, ContractProjection, CanonicalJson, PluginDefinition, PlanningBlockedError } from '../../src/contracts.js';
class PlanningContractTestsIntegration {

  configuration():void {
    const input={installationId:'fixture',engineContext:'default',installationDirectory:'/tmp/fixture',origin:'https://localhost:8443',runtimeState:'stopped',plugins:[{id:'fixture',package:'@fixture/plugin',version:'1.0.0',integrity:'a'.repeat(64)}],credentialReferences:['secret://password'],release:{directory:'/tmp/release',manifestDigest:'b'.repeat(64)}};
    expect(PlatformOperations.plan.definition.input.safeParse(input).success).toBe(true);
    expect(PlatformOperations.plan.definition.input.safeParse({...input,release:undefined}).success).toBe(false);
    expect(PlatformOperations.plan.definition.input.safeParse({...input,credentialReferences:['plaintext-canary']}).success).toBe(false);
    expect(PlatformOperations.plan.definition.input.safeParse({...input,credentialReferences:['secret://password','secret://password']}).success).toBe(false);
  }
}
const suite=new PlanningContractTestsIntegration();
test('integration: exact local planning input and safe secret references',suite.configuration.bind(suite));
