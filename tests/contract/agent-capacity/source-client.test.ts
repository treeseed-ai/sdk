import { describe, expect, it } from 'vitest';
import { ProviderProtocolClient } from '../../../src/capacity-provider/client.ts';

const request = { runnerId: 'runner', leaseToken: 'lease-secret', recipientPublicKey: Buffer.alloc(32, 1).toString('base64') };
const response = { authorization: { schemaVersion: 'treeseed.source-workspace-authorization/v1', id: 'authority', providerId: 'provider', assignmentId: 'assignment', attempt: 1,
  source: { controlPlaneId: 'control', teamId: 'team', projectId: 'project', repositoryId: 'repo', commit: 'a'.repeat(40), formatVersion: 1, profile: 'source-only' }, mode: 'analysis', publication: 'denied', credentialBindingId: 'binding', issuedAt: '2026-09-10T00:00:00.000Z', expiresAt: '2026-09-10T00:01:00.000Z' },
  repository: { provider: 'github', owner: 'treeseed-ai', name: 'sdk', cloneUrl: 'https://github.com/treeseed-ai/sdk.git', ref: 'staging' },
  credential: { schemaVersion: 'treeseed.source-credential-delivery/v1', id: 'delivery', authorizationId: 'authority', algorithm: 'x25519-hkdf-sha256-chacha20-poly1305', ephemeralPublicKey: Buffer.alloc(32, 2).toString('base64'), nonce: Buffer.alloc(12).toString('base64'), tag: Buffer.alloc(16).toString('base64'), ciphertext: 'sealed', expiresAt: '2026-09-10T00:01:00.000Z' } };
describe('host provider source authorization transport', () => {
  it('uses canonical routing, fresh Identity credentials, POST body and per-call idempotency', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []; let generation = 0;
    const client = new ProviderProtocolClient({ controlPlaneUrl: 'https://control.test', accessTokenProvider: async () => `membership-${++generation}`,
      fetchImpl: async (url, init) => { calls.push({ url: String(url), init }); return Response.json({ data: response }); } });
    expect(await client.authorizeAssignmentSource('assignment', request)).toEqual(response);
    await client.authorizeAssignmentSource('assignment', request);
    expect(calls.map(call => call.url)).toEqual(Array(2).fill('https://control.test/v1/provider/assignments/assignment/source-workspace'));
    expect(calls.map(call => new Headers(call.init?.headers).get('authorization'))).toEqual(['Bearer membership-1', 'Bearer membership-2']);
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual(request);
    expect(calls[0]?.init?.method).toBe('POST');
    expect(new Headers(calls[0]?.init?.headers).get('idempotency-key')).not.toBe(new Headers(calls[1]?.init?.headers).get('idempotency-key'));
  });
  it('rejects malformed input before sending a request', async () => {
    const client = new ProviderProtocolClient({ controlPlaneUrl: 'https://control.test', fetchImpl: async () => { throw new Error('unexpected IO'); } });
    await expect(client.authorizeAssignmentSource('assignment', { ...request, recipientPublicKey: 'bad' })).rejects.not.toThrow('unexpected IO');
  });
  it('rejects miscorrelated API responses', async () => {
    const client = new ProviderProtocolClient({ controlPlaneUrl: 'https://control.test', accessToken: 'token', fetchImpl: async () => Response.json({ data: response }) });
    await expect(client.authorizeAssignmentSource('different', request)).rejects.toThrow('correlation');
  });
});
