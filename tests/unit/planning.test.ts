import { test, expect } from 'bun:test';
import { PlatformOperations, PlatformSchemas, ContractProjection, CanonicalJson, PluginDefinition, PlanningBlockedError } from '../../src/contracts.js';
class PlanningContractTestsUnit {

  metadata():void {
    const metadata=PluginDefinition.define({id:'fixture',contractVersion:'0.2.0-cordis.1',provide:['z','a'],inject:[]});expect(metadata.provide).toEqual(['a','z']);expect(Object.isFrozen(metadata)).toBe(true);
    expect(CanonicalJson.digest({b:[1,2],a:{second:2,first:1}})).toBe(CanonicalJson.digest({a:{first:1,second:2},b:[1,2]}));expect(CanonicalJson.digest({a:[1,2]})).not.toBe(CanonicalJson.digest({a:[2,1]}));
    expect(new PlanningBlockedError([{code:'BLOCKED',message:'Safe explanation'}]).blockers).toEqual([{code:'BLOCKED',message:'Safe explanation'}]);
  }

  projection():void {
    expect(PlatformSchemas.plan.shape.recipe).toBeDefined();expect(PlatformSchemas.plan.shape.pluginBindings).toBeDefined();
    const result=ContractProjection.generate() as {contractVersion:string;schemas?:object};
    expect(result.contractVersion).toBe('0.5.0-cordis.1');expect(result.schemas).toBeDefined();expect(PlatformOperations.all.length).toBe(7);
    expect(PlatformSchemas.plan.safeParse({id:'pretend',digest:'a'.repeat(64),expectedComposition:null,artifacts:[],effects:[],blockers:[]}).success).toBe(false);
  }
}
const suite=new PlanningContractTestsUnit();
test('unit: versioned planning projection retains seven operations',suite.projection.bind(suite));
test('unit: declaration projection, canonical hashing and structured blockers',suite.metadata.bind(suite));
