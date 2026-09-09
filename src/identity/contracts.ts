import { z } from 'zod';

/** Discovery descriptors are identifiers, not permission to fetch arbitrary URLs. */
export const identityEndpointSchema = z.string().url().superRefine((value, context) => {
	const url = new URL(value);
	if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) {
		context.addIssue({ code: z.ZodIssueCode.custom, message: 'Identity endpoints require HTTPS without credentials, query, or fragment.' });
	}
});

const identifier = z.string().min(1).refine((value) => value.trim() === value, 'Identifier must not have surrounding whitespace.');
const scopes = z.array(z.string().regex(/^[\x21\x23-\x5B\x5D-\x7E]+$/u)).refine(
	(value) => new Set(value).size === value.length, 'Scopes must be unique.',
);

/** Always qualify a subject by its issuer; email is never an identity key. */
export const externalIdentitySchema = z.object({
	issuer: identityEndpointSchema,
	subject: identifier,
}).strict();

export const resourceTokenRequestSchema = z.object({
	resource: identityEndpointSchema,
	scopes,
}).strict();

export type ResourceTokenRequest = z.infer<typeof resourceTokenRequestSchema>;

/** RFC 9728 resource discovery. Unknown extensions are not authority. Consumers
 * must match resource exactly and explicitly select one advertised issuer.
 * TreeSeed credentials are transported only in the Authorization header.
 */
export const protectedResourceMetadataSchema = z.object({
	resource: identityEndpointSchema,
	authorization_servers: z.array(identityEndpointSchema).min(1).max(16).refine(
		value => new Set(value).size === value.length, 'Authorization servers must be unique.',
	),
	scopes_supported: scopes.refine(value => value.length <= 256 && value.every(scope => scope.length <= 128), 'Scope inventory is too large.').optional(),
	bearer_methods_supported: z.array(z.literal('header')).length(1).optional(),
	resource_documentation: identityEndpointSchema.optional(),
});
export type ProtectedResourceMetadata = z.infer<typeof protectedResourceMetadataSchema>;

/** Implemented by Identity; implementations must isolate caches by resource and authority. */
export interface IdentityCredentials {
	token(request: ResourceTokenRequest): Promise<string>;
}

/** Authenticated input to local authorization, never a role or membership grant. */
export const identityPrincipalSchema = z.object({
	principalId: identifier,
	kind: z.enum(['human', 'service', 'provider', 'agent']),
	identity: externalIdentitySchema,
	actor: externalIdentitySchema.optional(),
	audience: identityEndpointSchema,
	scopes,
}).strict();

export const federationRelationshipSchema = z.object({
	id: identifier,
	version: z.number().int().positive(),
	localIssuer: identityEndpointSchema,
	trustedIssuer: identityEndpointSchema,
	status: z.enum(['active', 'disabled']),
	permittedClientIds: z.array(identifier).nonempty(),
	releasedClaims: z.array(z.enum(['name', 'email', 'email_verified', 'preferred_username'])),
	transitive: z.literal(false),
	accountLinking: z.literal('authenticated-proof'),
}).strict().superRefine((value, context) => {
	if (value.localIssuer === value.trustedIssuer) {
		context.addIssue({ code: z.ZodIssueCode.custom, path: ['trustedIssuer'], message: 'Federation must identify a different issuer.' });
	}
	for (const field of ['permittedClientIds', 'releasedClaims'] as const) {
		if (new Set(value[field]).size !== value[field].length) {
			context.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: 'Entries must be unique.' });
		}
	}
});

export type ExternalIdentity = z.infer<typeof externalIdentitySchema>;
export type IdentityPrincipal = z.infer<typeof identityPrincipalSchema>;
export type FederationRelationship = z.infer<typeof federationRelationshipSchema>;
