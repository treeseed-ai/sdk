import { z } from 'zod';

/** Public selection contains references only; the API resolves current service custody. */
export const aiStorageBindingSchema = z.object({
	connectionId: z.string().uuid(),
	bucket: z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/u),
}).strict();

export const aiStorageProofSchema = z.object({
	schemaVersion: z.literal('treeseed.ai-storage-proof/v1'),
	teamId: z.string().uuid(), projectId: z.string().uuid(), nodeId: z.string().uuid(),
	service: z.enum(['inference', 'training', 'lab']),
	storeId: z.enum(['managed-inference', 'managed-training', 'managed-lab']),
	action: z.enum(['read', 'write', 'list', 'delete']),
	key: z.string().max(1024).refine(value => !/[\\\x00-\x1f\x7f%?#]/u.test(value)
		&& (!value || !value.split('/').some(part => !part || part === '.' || part === '..')), 'Use a relative artifact key.'),
	issuedAt: z.number().int().positive(), nonce: z.string().uuid(),
}).strict().refine(value => value.action === 'list' || value.key.length > 0, 'An object key is required.');

export type AiStorageProof = z.infer<typeof aiStorageProofSchema>;
export const aiStorageRequestSchema = z.object({
	proof: aiStorageProofSchema,
	signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/u),
}).strict();

/** Domain-separated, deterministic bytes signed by a Deployment-owned Ed25519 identity. */
export function aiStorageProofMessage(input: AiStorageProof): string {
	const proof = aiStorageProofSchema.parse(input);
	return `treeseed.ai-storage-proof/v1\n${JSON.stringify(Object.fromEntries(Object.entries(proof).sort(([a], [b]) => a.localeCompare(b))))}`;
}
