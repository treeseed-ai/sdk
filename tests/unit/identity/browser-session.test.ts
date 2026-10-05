import { describe, expect, it } from 'vitest';
import { browserLoginTransactionSchema, browserSessionRequests, browserSessionResponses } from '../../../src/identity/browser-session.ts';

describe('server-only application session contracts', () => {
  const opaque = 'a'.repeat(43);
  it('cannot select an application, issuer, resource or refresh token in a bridge request', () => {
    for (const extra of [{ clientId: 'other-app' }, { issuer: 'https://other.test' }, { resource: 'https://other-api.test' }, { refreshToken: 'secret' }]) {
      expect(browserSessionRequests.credentials.safeParse({ handle: opaque, ...extra }).success).toBe(false);
    }
    expect(browserSessionRequests.credentials.parse({ handle: opaque })).toEqual({ handle: opaque });
    expect(browserSessionRequests.finish.safeParse({ browserBinding: opaque, callback: 'http://admin.test/callback?code=x' }).success).toBe(false);
  });
  it('binds encrypted PKCE state to explicit issuer/client/resource/scopes', () => {
    const transaction = { state: opaque, nonce: opaque, verifier: opaque, expiresAt: Date.now() + 60000, issuer: 'https://identity.test',
      clientId: 'admin', redirectUri: 'https://admin.test/callback', resource: 'https://api.test', scopes: ['treeseed:read'] };
    expect(browserLoginTransactionSchema.parse(transaction)).toEqual(transaction);
    expect(browserLoginTransactionSchema.safeParse({ ...transaction, scopes: ['read', 'read'] }).success).toBe(false);
  });
  it('never allows refresh/ID tokens or workload principals in a browser credential result', () => {
    const result = { accessToken: 'server-only-token', resource: 'https://api.test', expiresAt: Date.now() + 60000,
      principal: { principalId: 'mapped-user', kind: 'human', identity: { issuer: 'https://identity.test', subject: 'subject' }, audience: 'https://api.test', scopes: ['read'] } };
    expect(browserSessionResponses.credentials.safeParse(result).success).toBe(true);
    expect(browserSessionResponses.credentials.safeParse({ ...result, refreshToken: 'secret' }).success).toBe(false);
    expect(browserSessionResponses.credentials.safeParse({ ...result, resource: 'https://market-api.test' }).success).toBe(false);
    expect(browserSessionResponses.credentials.safeParse({ ...result, principal: { ...result.principal, kind: 'service' } }).success).toBe(false);
  });
});
