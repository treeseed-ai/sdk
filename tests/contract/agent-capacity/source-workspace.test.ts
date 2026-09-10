import { describe, expect, it } from 'vitest';
import { sourceWorkspaceAuthorizationSchema, sourceWorkspaceKeySchema, sourceCandidateReceiptSchema } from '../../../src/capacity-provider/source-workspace.ts';

const source = { controlPlaneId: 'control-plane', teamId: 'team', projectId: 'project', repositoryId: 'source-repository',
	commit: 'a'.repeat(40), formatVersion: 1, profile: 'source-only' };
const authorization = { schemaVersion: 'treeseed.source-workspace-authorization/v1', id: 'grant', providerId: 'provider',
	assignmentId: 'assignment', attempt: 1, source, mode: 'analysis', publication: 'denied', credentialBindingId: 'binding',
	issuedAt: '2026-01-01T00:00:00Z', expiresAt: '2026-01-01T00:10:00Z' };

describe('exact-source workspace public contracts', () => {
	it('requires an immutable commit, not a branch or abbreviated ref', () => {
		expect(sourceWorkspaceKeySchema.safeParse(source).success).toBe(true);
		for (const commit of ['staging', 'main', 'abc1234', '../repository', 'a'.repeat(41)]) {
			expect(sourceWorkspaceKeySchema.safeParse({ ...source, commit }).success).toBe(false);
		}
	});
	it('does not expose backend paths, secret values, or storage implementation', () => {
		for (const field of ['path', 'qcow2', 'token', 'password', 'cloneUrl']) {
			expect(sourceWorkspaceKeySchema.safeParse({ ...source, [field]: 'untrusted' }).success).toBe(false);
			expect(sourceWorkspaceAuthorizationSchema.safeParse({ ...authorization, [field]: 'untrusted' }).success).toBe(false);
		}
	});
	it('separates disposable writes from publication and denies publication in analysis', () => {
		expect(sourceWorkspaceAuthorizationSchema.safeParse(authorization).success).toBe(true);
		expect(sourceWorkspaceAuthorizationSchema.safeParse({ ...authorization, publication: 'candidate-only' }).success).toBe(false);
		expect(sourceWorkspaceAuthorizationSchema.safeParse({ ...authorization, mode: 'work' }).success).toBe(true);
		expect(sourceWorkspaceAuthorizationSchema.safeParse({ ...authorization, mode: 'work', publication: 'main' }).success).toBe(false);
	});
	it('rejects inverted authority lifetimes', () => {
		expect(sourceWorkspaceAuthorizationSchema.safeParse({ ...authorization, expiresAt: authorization.issuedAt }).success).toBe(false);
	});
	it('requires durable object and ancestry evidence, never a disposable filesystem path', () => {
		const receipt = { schemaVersion: 'treeseed.source-candidate-receipt/v1', id: 'candidate', leaseId: 'lease', source,
			parentCandidateId: null, commit: 'b'.repeat(40), bundle: { artifactId: 'durable-artifact', digest: `sha256:${'c'.repeat(64)}`, bytes: 100 },
			verification: { objectClosure: true, ancestry: true, authority: true }, persistedAt: authorization.expiresAt };
		expect(sourceCandidateReceiptSchema.safeParse(receipt).success).toBe(true);
		expect(sourceCandidateReceiptSchema.safeParse({ ...receipt, verification: { ...receipt.verification, objectClosure: false } }).success).toBe(false);
	});
});
