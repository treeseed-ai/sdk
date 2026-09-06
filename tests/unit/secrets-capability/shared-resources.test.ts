import {describe, expect, it} from 'vitest';
import {sharedResourceGrantSchema, serviceBindingSchema, organizationTeamSchema} from '../../../src/secrets-capability/shared-resources.ts';
import {vaultCredentialReferenceSchema, assertCredentialRecordMutation} from '../../../src/secrets-capability/vault-contracts.ts';
import {authorizeSharedGrant, selectServiceBinding} from '../../../src/secrets-capability/shared-access.ts';

const grant = {
  id: 'grant', resource: {kind: 'connection', id: 'connection', ownerTeamId: 'owner'}, recipientTeamId: 'consumer',
  authority: {kind: 'organization', organizationId: 'org'}, origin: 'explicit', defaultPolicyId: null,
  permissions: ['object-storage'], scope: {environment: 'staging', resourceIds: ['bucket'], projectIds: [], assignmentIds: []},
  limits: {maxConcurrentOperations: 2, maxOperationsPerWindow: 10, windowSeconds: 60},
  status: 'active', version: 1, expiresAt: null,
};
describe('shared resource contracts', () => {
  const request={resourceKind:'connection' as const,resourceId:'connection',ownerTeamId:'owner',teamId:'consumer',permission:'object-storage',environment:'staging' as const,resourceIdWithinProvider:'bucket'};
  const authority={actorCanUse:true,ownerOrganizationId:'org',recipientOrganizationId:'org',deploymentAudiencePolicyId:null};
  const now=new Date('2026-01-01T00:00:00Z');
  it('rechecks both memberships and never widens a service grant to vault access', () => {
    const parsed=sharedResourceGrantSchema.parse(grant);
    expect(authorizeSharedGrant(parsed,request,authority,now).grantId).toBe('grant');
    for(const changed of [{actorCanUse:false},{ownerOrganizationId:null},{recipientOrganizationId:'other'}])
      expect(() => authorizeSharedGrant(parsed,request,{...authority,...changed},now)).toThrow();
    for(const changed of [{resourceKind:'vault' as const},{teamId:'other'},{ownerTeamId:'other'},{environment:'production' as const},{resourceIdWithinProvider:'other'}])
      expect(() => authorizeSharedGrant(parsed,{...request,...changed},authority,now)).toThrow();
  });
  it('denies expired/revoked grants and requires explicit deployment audience authority', () => {
    for(const changed of [{status:'revoked'},{expiresAt:now.toISOString()}])
      expect(() => authorizeSharedGrant(sharedResourceGrantSchema.parse({...grant,...changed}),request,authority,now)).toThrow('grant_inactive');
    const deployment=sharedResourceGrantSchema.parse({...grant,authority:{kind:'deployment',audiencePolicyId:'policy'}});
    expect(() => authorizeSharedGrant(deployment,request,authority,now)).toThrow('deployment_audience_required');
    expect(authorizeSharedGrant(deployment,request,{...authority,deploymentAudiencePolicyId:'policy'},now).grantId).toBe('grant');
  });
  it('preserves pinned bindings and rejects ambiguous defaults', () => {
    const binding=serviceBindingSchema.parse({id:'binding',teamId:'consumer',projectId:'project',capability:'object-storage',environment:'staging',connectionId:'connection',ownerTeamId:'owner',grantId:'grant',version:1});
    const selection={teamId:'consumer',projectId:'project',capability:'object-storage',environment:'staging' as const};
    const defaults={explicit:[],team:[],organization:[],deployment:[{...binding,id:'other'}]};
    expect(selectServiceBinding(selection,binding,defaults).id).toBe('binding');
    expect(selectServiceBinding(selection,null,defaults).id).toBe('other');
    expect(() => selectServiceBinding(selection,null,{...defaults,team:[binding,binding]})).toThrow('ambiguous_service_default');
  });
  it('requires one organization or independent membership', () => {
    expect(organizationTeamSchema.parse({teamId:'team', organizationId:null, version:1}).organizationId).toBeNull();
    expect(() => organizationTeamSchema.parse({teamId:'team', organizationId:['one','two'], version:1})).toThrow();
  });
  it('requires bounded grants and explicit default provenance', () => {
    expect(sharedResourceGrantSchema.parse(grant).resource.kind).toBe('connection');
    expect(() => sharedResourceGrantSchema.parse({...grant, limits:{}})).toThrow();
    expect(() => sharedResourceGrantSchema.parse({...grant, origin:'default-policy'})).toThrow();
    expect(() => sharedResourceGrantSchema.parse({...grant, scope:{...grant.scope, resourceIds:['*']}})).toThrow();
  });
  it('requires grants on shared bindings', () => {
    const binding={id:'binding',teamId:'consumer',projectId:'project',capability:'object-storage',environment:'staging',connectionId:'connection',ownerTeamId:'owner',grantId:null,version:1};
    expect(() => serviceBindingSchema.parse(binding)).toThrow();
    expect(serviceBindingSchema.parse({...binding,grantId:'grant'}).grantId).toBe('grant');
  });
  it('keeps existing secrets read-only and rejects escaping references', () => {
    const reference=vaultCredentialReferenceSchema.parse({mode:'existing',vaultId:'vault',allocationId:'allocation',recordPath:'team/record',fieldMapping:{apiToken:'token'},pinnedVersion:null});
    expect(() => assertCredentialRecordMutation(reference)).toThrow('existing_secret_read_only');
    for(const recordPath of ['../record','/record','team//record','team/%2e%2e/record'])
      expect(() => vaultCredentialReferenceSchema.parse({...reference,recordPath})).toThrow();
    expect(() => vaultCredentialReferenceSchema.parse({...reference,values:{token:'forbidden'}})).toThrow();
  });
});
