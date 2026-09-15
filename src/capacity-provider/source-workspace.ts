import { z } from 'zod';

const id = z.string().min(1).max(256);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const commit = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u);

/** The assignment identity already includes node revision and attempt. */
export function assignmentSourceBranch(assignmentId: string): string {
	if (!/^[A-Za-z0-9._-]+$/u.test(assignmentId)) throw new Error('Invalid assignment branch identity.');
	return `treeseed/assignments/${assignmentId}`;
}

export function simulationSourceBranch(campaignId: string, workdayId: string, assignmentId: string): string {
	for (const [label, value] of Object.entries({ campaignId, workdayId, assignmentId })) {
		if (!/^[A-Za-z0-9._-]+$/u.test(value)) throw new Error(`Invalid simulation ${label}.`);
	}
	return `simulation/${campaignId}/${workdayId}/${assignmentId}`;
}

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
	acquisition: z.enum(['upstream-public', 'upstream-authorized', 'simulation-local']),
	publication: z.enum(['denied', 'assignment-branch', 'simulation-branch']),
	publicationRef: id.optional(),
	credentialBindingId: id.optional(),
	issuedAt: z.string().datetime(),
	expiresAt: z.string().datetime(),
}).strict().superRefine((value, context) => {
	if (Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)) {
		context.addIssue({ code: z.ZodIssueCode.custom, path: ['expiresAt'], message: 'Workspace authorization must have a positive lifetime.' });
	}
	if (value.mode === 'analysis' && value.publication !== 'denied') {
		context.addIssue({ code: z.ZodIssueCode.custom, path: ['publication'], message: 'Analysis cannot publish source changes.' });
	}
	if (value.publication === 'denied' && value.publicationRef) {
		context.addIssue({ code: z.ZodIssueCode.custom, path: ['publicationRef'], message: 'Denied publication cannot name a destination ref.' });
	}
	if (value.publication !== 'denied' && !value.publicationRef) {
		context.addIssue({ code: z.ZodIssueCode.custom, path: ['publicationRef'], message: 'Work publication requires its exact destination ref.' });
	}
	if (value.publication === 'assignment-branch' && !value.credentialBindingId) {
		context.addIssue({ code: z.ZodIssueCode.custom, path: ['credentialBindingId'], message: 'Upstream publication requires a credential binding.' });
	}
	if (value.publication === 'simulation-branch' && value.credentialBindingId) {
		context.addIssue({ code: z.ZodIssueCode.custom, path: ['credentialBindingId'], message: 'Simulation cannot receive an upstream credential binding.' });
	}
	if (value.acquisition === 'upstream-authorized' && !value.credentialBindingId) {
		context.addIssue({ code: z.ZodIssueCode.custom, path: ['credentialBindingId'], message: 'Authorized acquisition requires a credential binding.' });
	}
	if (value.acquisition !== 'upstream-authorized' && value.credentialBindingId) {
		context.addIssue({ code: z.ZodIssueCode.custom, path: ['credentialBindingId'], message: 'Public and simulation-local acquisition cannot receive a credential binding.' });
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
	acquisition: z.enum(['upstream-public', 'upstream-authorized', 'simulation-local']),
	publication: z.enum(['denied', 'assignment-branch', 'simulation-branch']),
	state: z.enum(['active', 'exporting', 'released', 'quarantined']),
	createdAt: z.string().datetime(),
	expiresAt: z.string().datetime(),
}).strict();

export type SourceWorkspaceKey = z.infer<typeof sourceWorkspaceKeySchema>;
export type SourceWorkspaceAuthorization = z.infer<typeof sourceWorkspaceAuthorizationSchema>;
export type SourceWorkspaceLease = z.infer<typeof sourceWorkspaceLeaseSchema>;

/** Provider-manager transport only. Recipient is an ephemeral host key, never a guest key. */
export const sourceWorkspaceRequestSchema = z.object({
	runnerId: id,
	leaseToken: z.string().min(1).max(4096),
	recipientPublicKey: z.string().regex(/^[A-Za-z0-9+/]{43}=$/u),
}).strict();

export const sourceCredentialDeliverySchema = z.object({
	schemaVersion: z.literal('treeseed.source-credential-delivery/v1'),
	id,
	authorizationId: id,
	algorithm: z.literal('x25519-hkdf-sha256-chacha20-poly1305'),
	ephemeralPublicKey: z.string().regex(/^[A-Za-z0-9+/]{43}=$/u),
	nonce: z.string().regex(/^[A-Za-z0-9+/]{16}$/u),
	ciphertext: z.string().min(1).max(16384),
	tag: z.string().regex(/^[A-Za-z0-9+/]{22}==$/u),
	expiresAt: z.string().datetime(),
}).strict();

export const sourceWorkspaceResponseSchema = z.object({
	authorization: sourceWorkspaceAuthorizationSchema,
	repository: z.object({ provider: z.literal('github'), owner: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9-]{0,99}$/u), name: z.string().regex(/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,99}$/u),
		cloneUrl: z.string().url().startsWith('https://github.com/'), ref: id }).strict(),
	credential: sourceCredentialDeliverySchema.nullable(),
}).strict().superRefine((value, context) => {
	if (value.repository.cloneUrl !== `https://github.com/${value.repository.owner}/${value.repository.name}.git`) {
		context.addIssue({ code: z.ZodIssueCode.custom, path: ['repository', 'cloneUrl'], message: 'Source transport must match its provider repository.' });
	}
	if (value.credential && (value.credential.authorizationId !== value.authorization.id || value.credential.expiresAt !== value.authorization.expiresAt)) {
		context.addIssue({ code: z.ZodIssueCode.custom, path: ['credential'], message: 'Source credential delivery must match exact authorization and lifetime.' });
	}
	if (Boolean(value.authorization.credentialBindingId) !== Boolean(value.credential)) {
		context.addIssue({ code: z.ZodIssueCode.custom, path: ['credential'], message: 'Credential delivery must match the declared binding.' });
	}
});

export type SourceCredentialDelivery = z.infer<typeof sourceCredentialDeliverySchema>;
export type SourceWorkspaceRequest = z.infer<typeof sourceWorkspaceRequestSchema>;
export type SourceWorkspaceResponse = z.infer<typeof sourceWorkspaceResponseSchema>;
