import { z } from 'zod';

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u);
const path = z.string().min(1).max(512).refine(value =>
  value.split('/').every(segment => /^[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(segment)), 'Canonical relative vault path required.');
const endpoint = z.string().url().refine(value => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/';
}, 'HTTPS origin without credentials, query or fragment required.');

/** Configuration validation is not DNS/routing authorization; Deployment enforces transport policy. */
export const vaultDescriptorSchema = z.object({
  id, ownerTeamId: id.nullable(), displayName: z.string().trim().min(1).max(160),
  backend: z.enum(['managed-openbao', 'external-openbao', 'hashicorp-vault']),
  endpoint, secretsMount: path, namespace: path.nullable(),
  networkRouteId: id, tlsTrustId: id,
  authentication: z.object({
    method: z.literal('approle'), mount: path, roleId: z.string().min(1).max(256),
    bootstrapCredentialRef: id,
  }).strict(),
  status: z.enum(['unverified', 'ready', 'unavailable', 'revoked']),
  version: z.number().int().nonnegative().safe(),
}).strict();
export type VaultDescriptor = z.infer<typeof vaultDescriptorSchema>;

export const vaultAllocationSchema = z.object({
  id, vaultId: id, teamId: id, grantId: id.nullable(), pathPrefix: path,
  permissions: z.array(z.enum(['read', 'write', 'delete'])).min(1),
  version: z.number().int().nonnegative().safe(),
}).strict();

export const vaultCredentialReferenceSchema = z.discriminatedUnion('mode', [
  z.object({mode: z.literal('managed'), vaultId: id, allocationId: id, recordPath: path}).strict(),
  z.object({
    mode: z.literal('existing'), vaultId: id, allocationId: id, recordPath: path,
    fieldMapping: z.record(id, id).refine(value => Object.keys(value).length > 0, 'At least one field mapping is required.'),
    pinnedVersion: z.number().int().positive().safe().nullable(),
  }).strict(),
]);
export type VaultCredentialReference = z.infer<typeof vaultCredentialReferenceSchema>;

export function assertCredentialRecordMutation(reference: VaultCredentialReference) {
  vaultCredentialReferenceSchema.parse(reference);
  if (reference.mode === 'existing') throw new Error('existing_secret_read_only');
}
