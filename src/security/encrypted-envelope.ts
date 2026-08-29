import { z } from 'zod';

const base64Url = z.string().min(1).regex(/^[A-Za-z0-9_-]+$/u);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const identifier = z.string().regex(/^[a-z][a-z0-9._-]{0,127}$/u);

export const encryptedEnvelopeAadSchema = z.object({
	purpose: identifier,
	teamId: z.string().min(1).max(256).optional(),
	resourceType: identifier,
	resourceId: z.string().min(1).max(512),
	topicId: z.string().min(1).max(256).optional(),
	sendId: z.string().min(1).max(256).optional(),
	invocationId: z.string().min(1).max(256).optional(),
	assignmentId: z.string().min(1).max(256).optional(),
	sequence: z.number().int().nonnegative().optional(),
	eventType: z.string().min(1).max(256).optional(),
	schemaVersion: z.string().min(1).max(128),
}).strict();

export const encryptedEnvelopeSchema = z.object({
	schemaVersion: z.literal('treeseed.encrypted-envelope/v1'),
	algorithm: z.literal('aes-256-gcm'),
	keyProvider: identifier,
	keyId: identifier,
	keyVersion: z.number().int().positive(),
	wrappedDek: z.object({ nonce: base64Url, authenticationTag: base64Url, ciphertext: base64Url }).strict(),
	payload: z.object({ nonce: base64Url, authenticationTag: base64Url, ciphertext: base64Url }).strict(),
	aad: encryptedEnvelopeAadSchema,
	aadDigest: digest,
	ciphertextDigest: digest,
	createdAt: z.string().datetime(),
}).strict();

export type EncryptedEnvelopeAad = z.infer<typeof encryptedEnvelopeAadSchema>;
export type EncryptedEnvelope = z.infer<typeof encryptedEnvelopeSchema>;
