import { test, expect } from 'bun:test';
import { PlatformOperations, PlatformSchemas, ContractProjection, CanonicalJson, PluginDefinition, PlanningBlockedError } from '../src/contracts.js';
class PlanningContractTests {
  configuration():void {
    const input={installationId:'fixture',engineContext:'default',installationDirectory:'/tmp/fixture',origin:'https://localhost:8443',runtimeState:'stopped',plugins:[{id:'fixture',package:'@fixture/plugin',version:'1.0.0',integrity:'a'.repeat(64)}],credentialReferences:['secret://password'],release:{directory:'/tmp/release',manifestDigest:'b'.repeat(64)}};
    expect(PlatformOperations.plan.definition.input.safeParse(input).success).toBe(true);
    expect(PlatformOperations.plan.definition.input.safeParse({...input,release:undefined}).success).toBe(false);
    expect(PlatformOperations.plan.definition.input.safeParse({...input,credentialReferences:['plaintext-canary']}).success).toBe(false);
    expect(PlatformOperations.plan.definition.input.safeParse({...input,credentialReferences:['secret://password','secret://password']}).success).toBe(false);
  }
  metadata():void {
    const metadata=PluginDefinition.define({id:'fixture',contractVersion:'0.2.0-cordis.1',provide:['z','a'],inject:[]});expect(metadata.provide).toEqual(['a','z']);expect(Object.isFrozen(metadata)).toBe(true);
    expect(CanonicalJson.digest({b:[1,2],a:{second:2,first:1}})).toBe(CanonicalJson.digest({a:{first:1,second:2},b:[1,2]}));expect(CanonicalJson.digest({a:[1,2]})).not.toBe(CanonicalJson.digest({a:[2,1]}));
    expect(new PlanningBlockedError([{code:'BLOCKED',message:'Safe explanation'}]).blockers).toEqual([{code:'BLOCKED',message:'Safe explanation'}]);
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

test('unit: declaration projection, canonical hashing and structured blockers',suite.metadata.bind(suite));
