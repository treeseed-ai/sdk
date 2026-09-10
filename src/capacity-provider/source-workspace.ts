import { z } from 'zod';

const id = z.string().min(1).max(256);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const commit = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u);

/** Portable identity of canonical source. Physical storage belongs exclusively to Deployment. */
export const sourceWorkspaceKeySchema = z.object({
	controlPlaneId: id,
	teamId: id,
	projectId: id,
	repositoryId: id,
	commit,
	formatVersion: z.literal(1),
	profile: z.literal('source-only'),
}).strict();

/** Authorization is resolved again at lease acquisition; a READY cache entry grants no access. */
export const sourceWorkspaceAuthorizationSchema = z.object({
	schemaVersion: z.literal('treeseed.source-workspace-authorization/v1'),
	id,
	providerId: id,
	assignmentId: id,
	attempt: z.number().int().positive(),
	source: sourceWorkspaceKeySchema,
	mode: z.enum(['analysis', 'work']),
	publication: z.enum(['denied', 'candidate-only']),
	credentialBindingId: id,
	issuedAt: z.string().datetime(),
	expiresAt: z.string().datetime(),
}).strict().superRefine((value, context) => {
	if (Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)) {
		context.addIssue({ code: z.ZodIssueCode.custom, path: ['expiresAt'], message: 'Workspace authorization must have a positive lifetime.' });
	}
	if (value.mode === 'analysis' && value.publication !== 'denied') {
		context.addIssue({ code: z.ZodIssueCode.custom, path: ['publication'], message: 'Analysis cannot publish source changes.' });
	}
});

export const sourceWorkspaceLeaseSchema = z.object({
	schemaVersion: z.literal('treeseed.source-workspace-lease/v1'),
	id,
	authorizationId: id,
	providerId: id,
	assignmentId: id,
	attempt: z.number().int().positive(),
	source: sourceWorkspaceKeySchema,
	workspaceDigest: digest,
	mode: z.enum(['analysis', 'work']),
	publication: z.enum(['denied', 'candidate-only']),
	state: z.enum(['active', 'exporting', 'released', 'quarantined']),
	createdAt: z.string().datetime(),
	expiresAt: z.string().datetime(),
}).strict();

/** This receipt is durable before execution storage can be destroyed. It is not merge authority. */
export const sourceCandidateReceiptSchema = z.object({
	schemaVersion: z.literal('treeseed.source-candidate-receipt/v1'),
	id,
	leaseId: id,
	source: sourceWorkspaceKeySchema,
	parentCandidateId: id.nullable(),
	commit,
	bundle: z.object({ artifactId: id, digest, bytes: z.number().int().positive().safe() }).strict(),
	verification: z.object({ objectClosure: z.literal(true), ancestry: z.literal(true), authority: z.literal(true) }).strict(),
	persistedAt: z.string().datetime(),
}).strict();

export type SourceWorkspaceKey = z.infer<typeof sourceWorkspaceKeySchema>;
export type SourceWorkspaceAuthorization = z.infer<typeof sourceWorkspaceAuthorizationSchema>;
export type SourceWorkspaceLease = z.infer<typeof sourceWorkspaceLeaseSchema>;
export type SourceCandidateReceipt = z.infer<typeof sourceCandidateReceiptSchema>;
