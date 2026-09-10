import { describe, expect, it } from 'vitest';
import { identityApiRuntimeSchema } from '../../../src/identity/runtime.ts';

const input = () => ({ schemaVersion: 'treeseed.identity-api-runtime/v1', issuer: 'https://identity.example.test/realms/local',
  resource: 'https://api.example.test', scopes: ['treeseed:read'],
  sessionKeys: { id: 'browser-sessions', active: { version: 2, credentialReference: 'session-key-two' },
    historical: [{ version: 1, credentialReference: 'session-key-one' }] },
  applications: [
    { clientId: 'admin-browser', workloadPrincipalId: 'admin-bff', redirectUri: 'https://admin.example.test/auth/callback', scopes: ['treeseed:read'], signingKeyReference: 'admin-browser-key' },
    { clientId: 'market-browser', workloadPrincipalId: 'market-bff', redirectUri: 'https://market.example.test/auth/callback', scopes: ['treeseed:read'], signingKeyReference: 'market-browser-key' },
  ],
});
describe('portable API Identity wiring', () => {
  it('requires explicit boolean enrollment policy and preserves closed-by-absence configurations', () => {
    expect(identityApiRuntimeSchema.parse(input()).registration).toBeUndefined();
    for (const enabled of [true, false]) expect(identityApiRuntimeSchema.parse({ ...input(), registration: { enabled } }).registration).toEqual({ enabled });
    for (const registration of [{ enabled: 'true' }, {}, { enabled: true, team: 'admin' }])
      expect(identityApiRuntimeSchema.safeParse({ ...input(), registration }).success).toBe(false);
  });
  it('binds one API resource to independent application keys and bounded session recovery keys', () => {
    expect(identityApiRuntimeSchema.parse(input())).toEqual(input());
    expect(identityApiRuntimeSchema.parse({ ...input(), applications: [] }).applications).toEqual([]);
  });
  it.each(['shared-client', 'mixed-role', 'shared-callback', 'shared-signing-key', 'encryption-signing-key', 'scope-escalation', 'future-history', 'duplicate-version', 'plaintext', 'path', 'http', 'wildcard'])('rejects %s', fault => {
    const value = input();
    const second = value.applications[1]!;
    if (fault === 'shared-client') second.clientId = value.applications[0]!.clientId;
    if (fault === 'mixed-role') second.workloadPrincipalId = second.clientId;
    if (fault === 'shared-callback') second.redirectUri = value.applications[0]!.redirectUri;
    if (fault === 'shared-signing-key') second.signingKeyReference = value.applications[0]!.signingKeyReference;
    if (fault === 'encryption-signing-key') second.signingKeyReference = value.sessionKeys.active.credentialReference;
    if (fault === 'scope-escalation') second.scopes.push('treeseed:admin');
    if (fault === 'future-history') value.sessionKeys.historical[0]!.version = 3;
    if (fault === 'duplicate-version') value.sessionKeys.historical[0]!.version = 2;
    if (fault === 'plaintext') Object.assign(value, { privateKey: 'private-material' });
    if (fault === 'path') second.signingKeyReference = '/invalid/private.key';
    if (fault === 'http') value.issuer = 'http://identity.example.test';
    if (fault === 'wildcard') second.redirectUri = 'https://market.example.test/*';
    expect(identityApiRuntimeSchema.safeParse(value).success).toBe(false);
  });
});
