import { z } from 'zod';
import { identityEndpointSchema, resourceTokenRequestSchema } from './contracts.ts';

const reference = z.string().regex(/^[a-z][a-z0-9-]{0,62}$/u);
const clientId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u);
const scopes = resourceTokenRequestSchema.shape.scopes.refine(value => value.length <= 256 && value.every(scope => scope.length <= 128), 'Bounded scope inventory required.');
const sessionKey = z.object({ version: z.number().int().positive(), credentialReference: reference }).strict();

/** Portable API authentication wiring. Deployment resolves protected bootstrap
 * references; these declarations contain neither secret values nor file paths.
 * Application authorization and issuer/subject mappings remain in the API DB.
 */
export const identityApiRuntimeSchema = z.object({
  schemaVersion: z.literal('treeseed.identity-api-runtime/v1'),
  issuer: identityEndpointSchema,
  resource: identityEndpointSchema,
  /** Explicit enrollment policy, never inferred from issuer or email domain. */
  registration: z.object({ enabled: z.boolean() }).strict().optional(),
  scopes,
  sessionKeys: z.object({
    id: reference,
    active: sessionKey,
    historical: z.array(sessionKey).max(8),
  }).strict(),
  applications: z.array(z.object({
    clientId,
    workloadPrincipalId: clientId,
    redirectUri: identityEndpointSchema.refine(value => !value.includes('*'), 'Exact callback required.'),
    scopes,
    signingKeyReference: reference,
  }).strict()).max(128),
}).strict().superRefine((value, context) => {
  const fail = (message: string) => context.addIssue({ code: z.ZodIssueCode.custom, message });
  const versions = new Set<number>(), references = new Set<string>(), identities = new Set<string>(), callbacks = new Set<string>();
  for (const key of [value.sessionKeys.active, ...value.sessionKeys.historical]) {
    if (versions.has(key.version) || references.has(key.credentialReference)) fail('Session key versions and references must be unique.');
    if (key !== value.sessionKeys.active && key.version >= value.sessionKeys.active.version) fail('Historical session keys must precede the active version.');
    versions.add(key.version); references.add(key.credentialReference);
  }
  for (const application of value.applications) {
    for (const id of [application.clientId, application.workloadPrincipalId]) {
      if (identities.has(id)) fail('Application clients and workload principals must be independently registered.');
      identities.add(id);
    }
    if (callbacks.has(application.redirectUri)) fail('Applications must have distinct exact callbacks.');
    callbacks.add(application.redirectUri);
    if (references.has(application.signingKeyReference)) fail('Session encryption and application signing keys must be independent.');
    references.add(application.signingKeyReference);
    if (application.scopes.some(scope => !value.scopes.includes(scope))) fail('Application scopes must be supported by the selected API resource.');
  }
});
export type IdentityApiRuntime = z.infer<typeof identityApiRuntimeSchema>;
