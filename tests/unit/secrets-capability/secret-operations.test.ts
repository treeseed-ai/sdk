import { describe, expect, it } from 'vitest';
import { CONTROL_PLANE_OPERATIONS } from '../../../src/operator-contracts/control-plane-operations.ts';
const operations = CONTROL_PLANE_OPERATIONS.services;
describe('managed secret operations', () => {
  it('requires CAS and redacts input values', () => {
    for (const name of ['credentialStatus','putCredentials','deleteCredentials','validateCredentials'] as const) {
      expect(operations[name].descriptor.confirmation).toBe('never');
      expect(operations[name].descriptor.authentication).toBe('oauth');
    }
    expect(operations.putCredentials.schema.body.parse({expectedVersion:0,values:{apiToken:'synthetic'}})).toBeDefined();
    expect(() => operations.putCredentials.schema.body.parse({values:{apiToken:'synthetic'}})).toThrow();
    expect(() => operations.putCredentials.schema.body.parse({expectedVersion:0,values:{},wrappedTeamVaultKey:'retired'})).toThrow();
    expect(operations.putCredentials.descriptor.redactedPaths).toContain('body.values');
  });
  it('only returns descriptors, never stored values', () => {
    const descriptor = {teamId:'team',connectionId:'connection',profileId:'profile',custody:'openbao',version:1,configured:true,fields:['apiToken']};
    expect(operations.credentialStatus.schema.output.parse(descriptor)).toEqual(descriptor);
    expect(() => operations.credentialStatus.schema.output.parse({...descriptor,values:{apiToken:'secret'}})).toThrow();
  });
});
