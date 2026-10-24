import { test, expect } from 'bun:test';
import { PlatformOperations, PlatformSchemas, ContractProjection } from '../src/contracts.js';
class PlanningContractTests {
  configuration():void {
    const input={installationId:'fixture',engineContext:'default',installationDirectory:'/tmp/fixture',origin:'https://localhost:8443',runtimeState:'stopped',plugins:[{id:'fixture',package:'@fixture/plugin',version:'1.0.0',integrity:'a'.repeat(64)}],credentialReferences:['secret://password'],release:{directory:'/tmp/release',manifestDigest:'b'.repeat(64)}};
    expect(PlatformOperations.plan.definition.input.safeParse(input).success).toBe(true);
    expect(PlatformOperations.plan.definition.input.safeParse({...input,release:undefined}).success).toBe(false);
    expect(PlatformOperations.plan.definition.input.safeParse({...input,credentialReferences:['plaintext-canary']}).success).toBe(false);
    expect(PlatformOperations.plan.definition.input.safeParse({...input,credentialReferences:['secret://password','secret://password']}).success).toBe(false);
  }
  projection():void {
    const result=ContractProjection.generate() as {contractVersion:string;schemas?:object};
    expect(result.contractVersion).toBe('0.2.0-cordis.1');expect(result.schemas).toBeDefined();expect(PlatformOperations.all.length).toBe(7);
    expect(PlatformSchemas.plan.safeParse({id:'pretend',digest:'a'.repeat(64),expectedComposition:null,artifacts:[],effects:[],blockers:[]}).success).toBe(false);
  }
}
const suite=new PlanningContractTests();
test('integration: exact local planning input and safe secret references',suite.configuration.bind(suite));
test('unit: versioned planning projection retains seven operations',suite.projection.bind(suite));
