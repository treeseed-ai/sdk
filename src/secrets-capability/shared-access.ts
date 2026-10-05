import { sharedResourceGrantSchema, serviceBindingSchema, type SharedResourceGrant, type ServiceBinding } from './shared-resources.ts';

export interface SharedAccessRequest {
  resourceKind: 'connection' | 'vault'; resourceId: string; ownerTeamId: string | null;
  teamId: string; permission: string; environment: 'staging' | 'production' | 'shared';
  resourceIdWithinProvider: string; projectId?: string; assignmentId?: string;
}
export interface CurrentSharingAuthority {
  actorCanUse: boolean;
  ownerOrganizationId: string | null;
  recipientOrganizationId: string | null;
  deploymentAudiencePolicyId: string | null;
}

/** Pure policy check only. API supplies fresh trusted authority and atomically reserves quota before execution. */
export function authorizeSharedGrant(input: SharedResourceGrant, request: SharedAccessRequest, authority: CurrentSharingAuthority, now: Date) {
  const grant = sharedResourceGrantSchema.parse(input);
  const deny = (reason: string): never => { throw new Error(reason); };
  if (!Number.isFinite(now.getTime())) deny('invalid_authorization_time');
  if (!authority.actorCanUse) deny('actor_not_authorized');
  if (grant.status !== 'active' || grant.expiresAt && Date.parse(grant.expiresAt) <= now.getTime()) deny('grant_inactive');
  if (grant.recipientTeamId !== request.teamId || grant.resource.kind !== request.resourceKind
    || grant.resource.id !== request.resourceId || grant.resource.ownerTeamId !== request.ownerTeamId) deny('grant_resource_mismatch');
  if (grant.authority.kind === 'organization') {
    if (authority.ownerOrganizationId !== grant.authority.organizationId
      || authority.recipientOrganizationId !== grant.authority.organizationId) deny('organization_membership_required');
  } else if (authority.deploymentAudiencePolicyId !== grant.authority.audiencePolicyId) deny('deployment_audience_required');
  if (!grant.permissions.includes(request.permission) || grant.scope.environment !== request.environment
    || !grant.scope.resourceIds.includes(request.resourceIdWithinProvider)) deny('grant_scope_mismatch');
  if (grant.scope.projectIds.length && (!request.projectId || !grant.scope.projectIds.includes(request.projectId))) deny('project_scope_mismatch');
  if (grant.scope.assignmentIds.length && (!request.assignmentId || !grant.scope.assignmentIds.includes(request.assignmentId))) deny('assignment_scope_mismatch');
  return {grantId: grant.id, grantVersion: grant.version, limits: {...grant.limits}};
}

export interface BindingSelection {
  teamId: string; projectId: string; capability: string; environment: ServiceBinding['environment'];
}
/** Once bound, never consult a lower-priority default. Eligibility is evaluated by the API after selection. */
export function selectServiceBinding(request: BindingSelection, pinned: ServiceBinding | null,
  defaults: {explicit: ServiceBinding[]; team: ServiceBinding[]; organization: ServiceBinding[]; deployment: ServiceBinding[]}) {
  const matches = (value: ServiceBinding) => value.teamId === request.teamId && value.projectId === request.projectId
    && value.capability === request.capability && value.environment === request.environment;
  if (pinned) {
    const binding = serviceBindingSchema.parse(pinned);
    if (!matches(binding)) throw new Error('binding_scope_mismatch');
    return binding;
  }
  for (const tier of ['explicit', 'team', 'organization', 'deployment'] as const) {
    const candidates = defaults[tier].map(value => serviceBindingSchema.parse(value)).filter(matches);
    if (candidates.length > 1) throw new Error('ambiguous_service_default');
    if (candidates[0]) return candidates[0];
  }
  throw new Error('service_binding_unavailable');
}
