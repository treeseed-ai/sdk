import { z } from 'zod';
import { sourceWorkspaceKeySchema } from '../source-workspace.ts';

export const sourceCandidateChunkBytes = 524_288;
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const commit = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u);
const id = z.string().min(1).max(256);

/** Signed by the registered provider host AFTER separate-VM verification, never by the guest. */
export const sourceCandidateAttestationSchema = z.object({
  schemaVersion: z.literal('treeseed.source-candidate-attestation/v1'),
  providerId: id, assignmentId: id, attempt: z.number().int().positive(), leaseId: id,
  source: sourceWorkspaceKeySchema, commit,
  parentCandidateId: id.nullable(),
  bundle: z.object({ digest, bytes: z.number().int().positive().max(sourceCandidateChunkBytes * 1024),
    chunks: z.array(digest).min(1).max(1024) }).strict(),
  verification: z.object({ clean: z.literal(true), objectClosure: z.literal(true), ancestry: z.literal(true),
    isolatedVerifier: z.literal(true), executionStopped: z.literal(true), verifierStopped: z.literal(true) }).strict(),
  verifiedAt: z.string().datetime(),
}).strict().superRefine((value, context) => {
  if (value.bundle.chunks.length !== Math.ceil(value.bundle.bytes / sourceCandidateChunkBytes)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['bundle', 'chunks'], message: 'Candidate chunk count must match its bounded size.' });
  }
});

export const signedSourceCandidateSchema = z.object({
  attestation: sourceCandidateAttestationSchema,
  signature: z.object({ algorithm: z.literal('Ed25519'), keyId: id,
    value: z.string().regex(/^[A-Za-z0-9_-]{86}$/u) }).strict(),
}).strict();
const authority = { runnerId: id, leaseToken: z.string().min(1).max(4096), candidate: signedSourceCandidateSchema };
export const sourceCandidateRequestSchema = z.discriminatedUnion('action', [
  z.object({ ...authority, action: z.literal('chunk'), index: z.number().int().min(0).max(1023),
    content: z.string().min(4).max(Math.ceil(sourceCandidateChunkBytes / 3) * 4).regex(/^[A-Za-z0-9+/]+={0,2}$/u) }).strict(),
  z.object({ ...authority, action: z.literal('commit') }).strict(),
]);
export type SourceCandidateAttestation = z.infer<typeof sourceCandidateAttestationSchema>;
export type SignedSourceCandidate = z.infer<typeof signedSourceCandidateSchema>;
export type SourceCandidateRequest = z.infer<typeof sourceCandidateRequestSchema>;

export const sourceChunkRequestSchema = z.object({ runnerId: id, leaseToken: z.string().min(1).max(4096),
  artifactId: id, index: z.number().int().min(0).max(1023) }).strict();
export const sourceChunkResponseSchema = z.object({ artifactId: id, index: z.number().int().min(0).max(1023), digest,
  content: z.string().min(4).max(Math.ceil(sourceCandidateChunkBytes / 3) * 4).regex(/^[A-Za-z0-9+/]+={0,2}$/u) }).strict();
export type SourceChunkRequest = z.infer<typeof sourceChunkRequestSchema>;
