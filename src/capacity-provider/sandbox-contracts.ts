import { z } from 'zod';

const identifier = z.string().regex(/^[a-z][a-z0-9._-]{0,127}$/u);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const sandboxProfile = identifier;

export const sandboxAssignmentSchema = z.object({
	schemaVersion: z.literal('treeseed.sandbox-assignment/v1'),
	assignmentId: z.string().min(1), attempt: z.number().int().positive(), runnerId: z.string().min(1),
	providerId: z.string().min(1), teamId: z.string().min(1), projectId: z.string().min(1),
	profile: sandboxProfile,
	environmentContract: z.object({ id: identifier, version: z.string().regex(/^\d+\.\d+\.\d+$/u), digest, capabilities: z.array(identifier) }).strict().optional(),
	guestImage: z.string().min(1), guestImageDigest: digest,
	identityManifestDigest: digest, contextManifestDigest: digest,
	resources: z.object({ cpuCores: z.number().positive(), memoryBytes: z.number().int().positive(), diskBytes: z.number().int().positive(),
		durationSeconds: z.number().int().positive(), processLimit: z.number().int().positive(), outputBytes: z.number().int().positive() }).strict(),
	inputs: z.array(z.object({ id: identifier, digest, bytes: z.number().int().nonnegative(), disposition: z.enum(['read-only', 'copy-on-write']), mediaType: z.string().min(1), targetPath: z.string().startsWith('/workspace/') }).strict()),
	outputs: z.array(z.object({ id: identifier, path: z.string().startsWith('/run/treeseed-output/'), mediaType: z.string().min(1), maxBytes: z.number().int().positive() }).strict()),
	network: z.object({ defaultDeny: z.literal(true), relayUrl: z.string().url().startsWith('https://'), allowedServices: z.array(identifier), connectedDevelopmentSessionId: z.string().min(1).optional() }).strict(),
	modelPolicy: z.object({ provider: identifier, model: z.string().min(1), reasoningEffort: z.enum(['minimal', 'low', 'medium', 'high', 'xhigh']).optional(), capabilities: z.array(identifier), maxInputTokens: z.number().int().positive().optional(), maxOutputTokens: z.number().int().positive().optional(), maxCost: z.number().nonnegative().optional() }).strict(),
	credentialHandles: z.array(z.object({ id: identifier, profileId: identifier, revealAllowed: z.literal(false) }).strict()),
	treeDxHandleIds: z.array(z.string().min(1)), leaseExpiresAt: z.string().datetime(),
	signature: z.object({ keyId: identifier, algorithm: z.literal('Ed25519'), value: z.string().min(1) }).strict(),
}).strict();

export const sandboxEventSchema = z.object({
	schemaVersion: z.literal('treeseed.sandbox-event/v1'), sandboxId: z.string().min(1), assignmentId: z.string().min(1),
	sequence: z.number().int().nonnegative(), occurredAt: z.string().datetime(),
	type: z.enum(['sandbox.created', 'sandbox.ready', 'execution.started', 'execution.progress', 'tool.requested', 'tool.completed', 'execution.completed', 'execution.failed', 'sandbox.destroyed']),
	payload: z.record(z.unknown()).default({}),
}).strict();

export const sandboxLeaseRenewalSchema = z.object({
	schemaVersion: z.literal('treeseed.sandbox-lease-renewal/v1'), sandboxId: z.string().min(1), assignmentId: z.string().min(1), providerId: z.string().min(1), teamId: z.string().min(1),
	leaseExpiresAt: z.string().datetime(), issuedAt: z.string().datetime(), signature: z.object({ keyId: identifier, algorithm: z.literal('Ed25519'), value: z.string().min(1) }).strict(),
}).strict();

export const sandboxResultSchema = z.object({
	schemaVersion: z.literal('treeseed.sandbox-result/v1'), sandboxId: z.string().min(1), assignmentId: z.string().min(1),
	status: z.enum(['completed', 'failed', 'cancelled', 'expired']), summary: z.string(),
	responseMarkdown: z.string().optional(),
	artifacts: z.array(z.object({ id: identifier, path: z.string().startsWith('/run/treeseed-output/'), digest, mediaType: z.string().min(1), bytes: z.number().int().nonnegative() }).strict()),
	usage: z.record(z.unknown()).default({}), diagnostics: z.record(z.unknown()).default({}),
	teardown: z.object({ verified: z.boolean(), completedAt: z.string().datetime().nullable() }).strict(),
}).strict();

export const providerEnvironmentReceiptSchema = z.object({
	schemaVersion: z.literal('treeseed.provider-environment-receipt/v1'), assignmentId: z.string().min(1), offerId: identifier,
	providerId: z.string().min(1), imageDigest: digest,
	baseLineage: z.object({ baseImageDigest: digest, provenanceDigest: digest, architectures: z.array(z.enum(['amd64', 'arm64'])).min(1) }).strict(),
	securityAttestationDigest: digest, brokerVersion: z.string().min(1),
	teardown: z.object({ verified: z.boolean(), completedAt: z.string().datetime().nullable() }).strict(), createdAt: z.string().datetime(),
	signature: z.object({ keyId: identifier, algorithm: z.literal('Ed25519'), value: z.string().min(1) }).strict(),
}).strict();

export type SandboxAssignment = z.infer<typeof sandboxAssignmentSchema>;
export type SandboxEvent = z.infer<typeof sandboxEventSchema>;
export type SandboxLeaseRenewal = z.infer<typeof sandboxLeaseRenewalSchema>;
export type SandboxResult = z.infer<typeof sandboxResultSchema>;
export type ProviderEnvironmentReceipt = z.infer<typeof providerEnvironmentReceiptSchema>;
export type SandboxEnvironmentProfile = z.infer<typeof sandboxProfile>;
