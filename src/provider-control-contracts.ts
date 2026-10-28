import { z } from 'zod';

class ProviderOfferValidation {
  static distribution(value: { weight?: number; sharePercent?: number }): boolean {
    return value.weight === undefined || value.sharePercent === undefined;
  }
}

/** Public legacy provider wire contracts. Parsing does not establish approval or authority. */
export class ProviderControlSchemas {
  static readonly key = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/);
  static readonly timestamp = z.string().datetime({ offset: true });
  static readonly text = z.string().min(1).max(256);
  static readonly metadata = z.record(z.string(), z.json());
  static readonly proof = z.strictObject({
    protected: z
      .string()
      .min(1)
      .max(16384)
      .regex(/^[A-Za-z0-9_-]+$/),
    payload: z
      .string()
      .min(1)
      .max(16384)
      .regex(/^[A-Za-z0-9_-]+$/),
    signature: z
      .string()
      .min(1)
      .max(16384)
      .regex(/^[A-Za-z0-9_-]+$/),
  });
  static readonly publicJwk = z.strictObject({
    kty: z.literal('OKP'),
    crv: z.literal('Ed25519'),
    x: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    kid: this.text.optional(),
    use: z.literal('sig').optional(),
    alg: z.literal('EdDSA').optional(),
  });
  static readonly supplyOffer = z
    .strictObject({
      weight: z.number().finite().positive().optional(),
      sharePercent: z.number().finite().positive().max(100).optional(),
      maxConcurrentRunners: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
      capabilities: z.array(this.text).max(256),
      availability: z
        .strictObject({
          availableFrom: this.timestamp.nullable().optional(),
          availableUntil: this.timestamp.nullable().optional(),
          timeZone: this.text.nullable().optional(),
        })
        .optional(),
      metadata: this.metadata.optional(),
    })
    .refine(ProviderOfferValidation.distribution);
  static readonly submission = z.strictObject({
    schemaVersion: z.literal(1),
    displayName: this.text,
    publicJwk: this.publicJwk,
    proof: this.proof,
    capabilitySummary: z.array(this.text).max(256),
    supplyOffer: this.supplyOffer,
    metadata: this.metadata.optional(),
  });
  static readonly registration = z.strictObject({
    id: this.key,
    teamId: this.key,
    providerId: this.key,
    providerFingerprint: z.string().regex(/^sha256:[A-Za-z0-9_-]{43}$/),
    registrationKeyGeneration: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    status: z.enum(['pending', 'approved', 'rejected', 'cancelled', 'expired']),
    capabilitySummary: z.array(this.text).max(256),
    supplyOffer: this.supplyOffer,
    expiresAt: this.timestamp,
    createdAt: this.timestamp,
    updatedAt: this.timestamp,
    reviewedAt: this.timestamp.nullable().optional(),
    reviewedById: this.key.nullable().optional(),
    rejectionReason: z.string().max(4096).nullable().optional(),
    membershipId: this.key.nullable().optional(),
    metadata: this.metadata.optional(),
  });
  static readonly scope = z.enum([
    'provider:availability:write',
    'provider:assignments:read',
    'provider:assignments:write',
    'provider:usage:write',
    'provider:credentials:rotate',
  ]);
  static readonly scopes = z.array(this.scope).max(5);
  static readonly secret = z
    .string()
    .min(1)
    .max(8192)
    .regex(/^[\x21-\x7e]+$/);
  static readonly credentialIssue = z.strictObject({
    id: this.key,
    membershipId: this.key,
    teamId: this.key,
    providerId: this.key,
    keyPrefix: this.text,
    issuanceGeneration: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    status: z.enum(['active', 'rotating', 'revoked']),
    scopes: this.scopes,
    createdAt: this.timestamp,
    updatedAt: this.timestamp,
    expiresAt: this.timestamp.nullable().optional(),
    lastUsedAt: this.timestamp.nullable().optional(),
    rotatedFromCredentialId: this.key.nullable().optional(),
    revokedAt: this.timestamp.nullable().optional(),
    credential: this.secret,
  });
  static readonly tokenRequest = z.strictObject({
    credentialId: this.key,
    proof: this.proof,
    requestedValiditySeconds: z.number().int().min(60).max(604800).optional(),
  });
  static readonly tokenIssue = z.strictObject({
    id: this.key,
    membershipId: this.key,
    credentialId: this.key,
    status: z.enum(['active', 'revoked', 'expired']),
    scopes: this.scopes,
    issuedAt: this.timestamp,
    expiresAt: this.timestamp,
    revokedAt: this.timestamp.nullable().optional(),
    teamId: this.key,
    providerId: this.key,
    accessToken: this.secret,
    identityVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  });
  static project(): { version: string; schemas: Record<string, object> } {
    const schemas: Record<string, object> = {};
    for (const name of ['submission', 'registration', 'credentialIssue', 'tokenIssue'] as const)
      schemas[name] = z.toJSONSchema(this[name]);
    return { version: 'treeseed.provider-control/v1', schemas };
  }
}
export type ProviderSignedProof = z.infer<typeof ProviderControlSchemas.proof>;
export type ProviderRegistrationSubmission = z.infer<typeof ProviderControlSchemas.submission>;
export type ProviderRegistration = z.infer<typeof ProviderControlSchemas.registration>;
export type ProviderCredentialIssue = z.infer<typeof ProviderControlSchemas.credentialIssue>;
export type ProviderTokenRequest = z.infer<typeof ProviderControlSchemas.tokenRequest>;
export type ProviderTokenIssue = z.infer<typeof ProviderControlSchemas.tokenIssue>;
