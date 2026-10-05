import { z } from 'zod';

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u);
const version = z.number().int().nonnegative().safe();
const environment = z.enum(['staging', 'production', 'shared']);
const timestamp = z.string().datetime();

export const organizationSchema = z.object({
  id, name: z.string().trim().min(1).max(160), version,
}).strict();
export const organizationMemberSchema = z.object({
  organizationId: id, userId: id, role: z.enum(['owner', 'admin', 'member']), version,
}).strict();
export const organizationTeamSchema = z.object({
  teamId: id, organizationId: id.nullable(), version,
}).strict();
export const organizationTeamInvitationSchema = z.object({
  id, organizationId: id, teamId: id, organizationAuthorizedBy: id,
  teamAuthorizedBy: id.nullable(), expiresAt: timestamp,
  status: z.enum(['pending', 'accepted', 'rejected', 'revoked', 'expired']), version,
}).strict();

export const sharedResourceSchema = z.discriminatedUnion('kind', [
  z.object({kind: z.literal('connection'), id, ownerTeamId: id}).strict(),
  z.object({kind: z.literal('vault'), id, ownerTeamId: id.nullable()}).strict(),
]);
export const sharedResourceGrantSchema = z.object({
  id, resource: sharedResourceSchema, recipientTeamId: id,
  authority: z.discriminatedUnion('kind', [
    z.object({kind: z.literal('organization'), organizationId: id}).strict(),
    z.object({kind: z.literal('deployment'), audiencePolicyId: id}).strict(),
  ]),
  origin: z.enum(['explicit', 'default-policy']), defaultPolicyId: id.nullable(),
  permissions: z.array(id).min(1),
  scope: z.object({
    environment, resourceIds: z.array(z.string().min(1).max(512)).min(1),
    projectIds: z.array(id), assignmentIds: z.array(id),
  }).strict(),
  limits: z.object({
    maxConcurrentOperations: z.number().int().positive().safe(),
    maxOperationsPerWindow: z.number().int().positive().safe(),
    windowSeconds: z.number().int().positive().safe(),
  }).strict(),
  status: z.enum(['active', 'revoked']), version, expiresAt: timestamp.nullable(),
}).strict().superRefine((grant, context) => {
  if ((grant.origin === 'default-policy') !== (grant.defaultPolicyId !== null))
    context.addIssue({code: 'custom', path: ['defaultPolicyId'], message: 'Default grants require exactly one policy reference.'});
  if (grant.authority.kind === 'organization' && grant.resource.ownerTeamId === null)
    context.addIssue({code: 'custom', path: ['resource', 'ownerTeamId'], message: 'Organization resources require an owning team.'});
  if (grant.scope.resourceIds.includes('*'))
    context.addIssue({code: 'custom', path: ['scope', 'resourceIds'], message: 'Unbounded resource grants are prohibited.'});
});
export type SharedResourceGrant = z.infer<typeof sharedResourceGrantSchema>;

export const serviceBindingSchema = z.object({
  id, teamId: id, projectId: id, capability: id, environment,
  connectionId: id, ownerTeamId: id, grantId: id.nullable(), version,
}).strict().superRefine((binding, context) => {
  if (binding.teamId !== binding.ownerTeamId && binding.grantId === null)
    context.addIssue({code: 'custom', path: ['grantId'], message: 'Shared bindings require a grant.'});
});
export type ServiceBinding = z.infer<typeof serviceBindingSchema>;
