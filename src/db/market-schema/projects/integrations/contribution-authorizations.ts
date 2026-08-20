import { index,integer,pgTable,text,uniqueIndex } from 'drizzle-orm/pg-core';

export const projectContributionAuthorizations = pgTable('project_contribution_authorizations', {
	id:text('id').primaryKey(),projectId:text('project_id').notNull(),generation:integer('generation').notNull(),status:text('status').notNull(),
	repositoryJson:text('repository_json').notNull(),grantVersion:text('grant_version').notNull(),grantDigest:text('grant_digest').notNull(),receiptKeyJson:text('receipt_key_json').notNull(),
	authorizedByPrincipalId:text('authorized_by_principal_id').notNull(),authorizedByDisplayName:text('authorized_by_display_name'),
	agentIdsJson:text('agent_ids_json').notNull(),capacityProviderIdsJson:text('capacity_provider_ids_json').notNull(),
	contributionModesJson:text('contribution_modes_json').notNull(),targetBranchesJson:text('target_branches_json').notNull(),allowedActionsJson:text('allowed_actions_json').notNull(),
	effectiveAt:text('effective_at').notNull(),expiresAt:text('expires_at'),revokedAt:text('revoked_at'),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
},(table)=>[
	uniqueIndex('idx_project_contribution_authorizations_generation').on(table.projectId,table.generation),
	index('idx_project_contribution_authorizations_status').on(table.projectId,table.status),
]);

export const projectContributionAttestationReceipts = pgTable('project_contribution_attestation_receipts', {
	id:text('id').primaryKey(),authorizationId:text('authorization_id').notNull(),authorizationGeneration:integer('authorization_generation').notNull(),
	projectId:text('project_id').notNull(),assignmentId:text('assignment_id').notNull(),checkpointId:text('checkpoint_id'),agentId:text('agent_id').notNull(),capacityProviderId:text('capacity_provider_id').notNull(),
	repositoryJson:text('repository_json').notNull(),baseBranch:text('base_branch').notNull(),baseSha:text('base_sha').notNull(),headBranch:text('head_branch').notNull(),headSha:text('head_sha').notNull(),
	payloadDigest:text('payload_digest').notNull(),signingKeyId:text('signing_key_id').notNull(),signature:text('signature').notNull(),status:text('status').notNull(),issuedAt:text('issued_at').notNull(),createdAt:text('created_at').notNull(),
},(table)=>[
	uniqueIndex('idx_project_contribution_attestation_receipts_assignment_head').on(table.assignmentId,table.headSha,table.authorizationGeneration),
	index('idx_project_contribution_attestation_receipts_project').on(table.projectId,table.status),
]);
