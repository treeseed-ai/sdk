import { expect, it } from 'vitest';
import { aiStorageBindingSchema, aiStorageProofSchema, aiStorageProofMessage } from '../../src/deployment/ai-storage';
import { AI_INSTANCE_OPERATIONS } from '../../src/operator-contracts/catalog/infrastructure/ai-instance-operations';
const id = '10000000-0000-4000-8000-000000000001';
const proof = { schemaVersion: 'treeseed.ai-storage-proof/v1' as const, teamId: id, projectId: id, nodeId: id,
	service: 'training' as const, storeId: 'managed-training' as const, action: 'read' as const, key: 'models/file.json', issuedAt: 1, nonce: id };
it('accepts only credential-free explicit storage selection', () => {
	expect(aiStorageBindingSchema.parse({ connectionId: id, bucket: 'ai-storage' })).toEqual({ connectionId: id, bucket: 'ai-storage' });
	expect(aiStorageBindingSchema.safeParse({ connectionId: id, bucket: 'ai-storage', apiToken: 'not-allowed' }).success).toBe(false);
	for (const op of [AI_INSTANCE_OPERATIONS.storagePut, AI_INSTANCE_OPERATIONS.storageRemove])
		expect(op.descriptor).toMatchObject({ concurrency: { required: true, writeHeader: 'If-Match' }, idempotency: { required: true } });
});
it('uses stable proof bytes regardless of field insertion order', () => {
	expect(aiStorageProofMessage(proof)).toBe(aiStorageProofMessage(Object.fromEntries(Object.entries(proof).reverse()) as typeof proof));
	expect(aiStorageProofSchema.safeParse({ ...proof, endpoint: 'https://untrusted.invalid' }).success).toBe(false);
});
it.each(['../key', '/key', 'x//key', 'x\\key', '%2e%2e/key', '', 'x?query'])('rejects ambiguous object key %s', key => {
	expect(aiStorageProofSchema.safeParse({ ...proof, key }).success).toBe(false);
});
it('allows an empty prefix only for listing a bounded allocation', () => {
	expect(aiStorageProofSchema.safeParse({ ...proof, action: 'list', key: '' }).success).toBe(true);
});
