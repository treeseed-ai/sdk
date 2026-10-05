import { z } from 'zod';
import { identityEndpointSchema, identityPrincipalSchema, resourceTokenRequestSchema } from './contracts.ts';

const opaque = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const clientId = z.string().min(1).max(256);
const authorizationUrl = z.string().url().max(8192).superRefine((value, context) => {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash)
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Authorization URLs require HTTPS without credentials or fragments.' });
});

/** Encrypted, single-use server-side state; never an application cookie value. */
export const browserLoginTransactionSchema = z.object({
  state: opaque, nonce: opaque, verifier: opaque, expiresAt: z.number().int().positive(),
  issuer: identityEndpointSchema, clientId, redirectUri: identityEndpointSchema,
  resource: identityEndpointSchema, scopes: resourceTokenRequestSchema.shape.scopes,
}).strict();
export type BrowserLoginTransaction = z.infer<typeof browserLoginTransactionSchema>;

/** Private BFF protocol, authenticated with a registered application workload.
 * These operations are not user/browser or agent-tool credential endpoints.
 * The server chooses the app namespace from authentication, not request fields.
 */
export const BROWSER_SESSION_BRIDGE_PATH = '/internal/identity/browser/v1';
export const BROWSER_SESSION_PERMISSION = 'identity:sessions:manage';
export const BROWSER_SESSION_SCOPE = 'treeseed:identity:sessions';
export const browserSessionRequests = {
  begin: z.object({ browserBinding: opaque }).strict(),
  finish: z.object({ browserBinding: opaque, callback: authorizationUrl }).strict(),
  credentials: z.object({ handle: opaque }).strict(),
  logout: z.object({ handle: opaque }).strict(),
};
export const browserSessionResponses = {
  begin: z.object({ authorizationUrl }).strict(),
  finish: z.object({ handle: opaque, expiresAt: z.string().datetime() }).strict(),
  credentials: z.object({ accessToken: z.string().min(1).max(16384), resource: identityEndpointSchema,
    expiresAt: z.number().int().positive(), principal: identityPrincipalSchema }).strict().superRefine((value, context) => {
      if (value.resource !== value.principal.audience || value.principal.kind !== 'human')
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Browser credentials require a human principal for this resource.' });
    }),
  logout: z.object({ loggedOut: z.literal(true), upstreamRevoked: z.boolean() }).strict(),
};
export type BrowserSessionCredentials = z.infer<typeof browserSessionResponses.credentials>;
