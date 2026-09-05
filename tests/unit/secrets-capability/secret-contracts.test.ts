import { describe, expect, it } from 'vitest';
import { CREDENTIAL_AUTHORITY_SCHEMES, SERVICE_PROVIDER_CATALOG, canonicalSecretPath, SECRET_CUSTODY_BACKENDS } from '../../../src/configuration/secrets-capability.ts';
import { CONTROL_PLANE_OPERATIONS, CONTROL_PLANE_CATALOG } from '../../../src/operator-contracts/control-plane-operations.ts';

describe('unified custody contracts', () => {
  it('has exactly central OpenBao and OS custody, with no optional external vault provider', () => {
    expect(SECRET_CUSTODY_BACKENDS).toEqual(['openbao', 'os']);
    expect(CREDENTIAL_AUTHORITY_SCHEMES).toEqual(['app-installation', 'openbao']);
    expect(SERVICE_PROVIDER_CATALOG.map(p => p.id)).toEqual(['github', 'cloudflare', 'railway']);
    for (const provider of SERVICE_PROVIDER_CATALOG) for (const profile of provider.credentialProfiles)
      expect(profile.authoritySchemes).toEqual([profile.id.endsWith('-app') ? 'app-installation' : 'openbao']);
  });
  it('binds every secret scope dimension and rejects escaping input', () => {
    const scope = {team:'a',project:'b',environment:'staging',purpose:'hosting',name:'c'};
    expect(canonicalSecretPath(scope)).toBe('teams/a/projects/b/environments/staging/purposes/hosting/secrets/c');
    for (const key of Object.keys(scope)) expect(() => canonicalSecretPath({...scope,[key]:'../escape'})).toThrow();
  });
  it('removes the browser vault and interactive delivery surfaces rather than aliasing them', () => {
    const catalog = JSON.stringify(CONTROL_PLANE_CATALOG);
    for (const retired of ['vault-key', 'credential-envelopes', 'service-operation-leases', 'wrappedTeamVaultKey', 'credentialLeaseIds'])
      expect(catalog).not.toContain(retired);
    expect(CONTROL_PLANE_OPERATIONS.services.putCredentials).toBeDefined();
  });
});
