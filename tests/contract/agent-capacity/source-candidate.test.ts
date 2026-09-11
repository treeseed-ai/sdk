import { describe, expect, it } from 'vitest';
import { sourceCandidateAttestationSchema, sourceCandidateRequestSchema, sourceCandidateChunkBytes } from '../../../src/capacity-provider/source-candidate.ts';
import { ProviderProtocolClient } from '../../../src/capacity-provider/client.ts';

const attestation = sourceCandidateAttestationSchema.parse({ schemaVersion: 'treeseed.source-candidate-attestation/v1', providerId: 'provider',
  assignmentId: 'assignment', attempt: 1, leaseId: 'lease', source: { controlPlaneId: 'control', teamId: 'team', projectId: 'project', repositoryId: 'repo',
    commit: 'a'.repeat(40), formatVersion: 1, profile: 'source-only' }, commit: 'b'.repeat(40), parentCandidateId: null,
  bundle: { digest: `sha256:${'c'.repeat(64)}`, bytes: 3, chunks: [`sha256:${'c'.repeat(64)}`] },
  verification: { clean: true, objectClosure: true, ancestry: true, isolatedVerifier: true, executionStopped: true, verifierStopped: true }, verifiedAt: '2026-09-10T00:00:00.000Z' });
const candidate = { attestation, signature: { algorithm: 'Ed25519' as const, keyId: 'provider-key', value: Buffer.alloc(64).toString('base64url') } };
const chunk = { action: 'chunk' as const, runnerId: 'runner', leaseToken: 'private-lease', candidate, index: 0, content: 'YWJj' };
describe('bounded source candidate transport', () => {
	it('requires assignment-scoped bounded source reads and correlates returned artifact identity', async () => {
		const request = { runnerId: 'runner', leaseToken: 'lease', artifactId: 'artifact', index: 0 };
		const response = { artifactId: 'artifact', index: 0, digest: attestation.bundle.digest, content: 'YWJj' };
		const client = new ProviderProtocolClient({ controlPlaneUrl: 'https://control.test', accessToken: 'token', fetchImpl: async () => Response.json({ data: response }) });
		expect(await client.readAssignmentSourceChunk('assignment', request)).toEqual(response);
		await expect(client.readAssignmentSourceChunk('assignment', { ...request, index: -1 })).rejects.toThrow();
		response.artifactId = 'other';
		await expect(client.readAssignmentSourceChunk('assignment', request)).rejects.toThrow('correlation');
	});
  it('requires complete isolated-verifier evidence and bounded chunk accounting', () => {
    expect(sourceCandidateRequestSchema.parse(chunk)).toEqual(chunk);
    expect(sourceCandidateAttestationSchema.safeParse({ ...attestation, verification: { ...attestation.verification, verifierStopped: false } }).success).toBe(false);
    expect(sourceCandidateAttestationSchema.safeParse({ ...attestation, bundle: { ...attestation.bundle, bytes: sourceCandidateChunkBytes + 1 } }).success).toBe(false);
    expect(sourceCandidateRequestSchema.safeParse({ ...chunk, content: 'a'.repeat(sourceCandidateChunkBytes * 2) }).success).toBe(false);
    expect(sourceCandidateRequestSchema.safeParse({ ...chunk, credential: 'not-allowed' }).success).toBe(false);
  });
  it('correlates each chunk receipt with the signed digest and index', async () => {
    const client = new ProviderProtocolClient({ controlPlaneUrl: 'https://control.test', accessToken: 'token',
      fetchImpl: async () => Response.json({ data: { accepted: true, index: 0, digest: attestation.bundle.chunks[0] } }) });
    expect(await client.publishAssignmentSourceCandidate('assignment', chunk)).toMatchObject({ accepted: true });
    await expect(client.publishAssignmentSourceCandidate('other', chunk)).rejects.toThrow('correlation');
    await expect(client.publishAssignmentSourceCandidate('assignment', { ...chunk, index: 1 })).rejects.toThrow('correlation');
  });
  it('refuses a durable receipt for another commit or lease', async () => {
    const receipt = { schemaVersion: 'treeseed.source-candidate-receipt/v1', id: 'candidate', leaseId: attestation.leaseId, source: attestation.source,
      parentCandidateId: null, commit: attestation.commit, bundle: { artifactId: 'artifact', digest: attestation.bundle.digest, bytes: 3 },
      verification: { objectClosure: true, ancestry: true, authority: true }, persistedAt: '2026-09-10T00:01:00.000Z' };
    const client = new ProviderProtocolClient({ controlPlaneUrl: 'https://control.test', accessToken: 'token', fetchImpl: async () => Response.json({ data: receipt }) });
    const request = { action: 'commit' as const, runnerId: 'runner', leaseToken: 'private-lease', candidate };
    expect(await client.publishAssignmentSourceCandidate('assignment', request)).toEqual(receipt);
    receipt.commit = 'd'.repeat(40);
    await expect(client.publishAssignmentSourceCandidate('assignment', request)).rejects.toThrow('correlation');
  });
});
