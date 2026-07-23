import { sql } from 'drizzle-orm';
import { bigint, check, foreignKey, index, integer, pgTable, primaryKey, real, serial, text, uniqueIndex } from 'drizzle-orm/pg-core';


export const catalogItems = pgTable('catalog_items', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	kind: text('kind').notNull(),
	slug: text('slug').notNull(),
	title: text('title').notNull(),
	summary: text('summary'),
	visibility: text('visibility').notNull(),
	listingEnabled: integer('listing_enabled').notNull().default(0),
	offerMode: text('offer_mode').notNull(),
	manifestKey: text('manifest_key'),
	artifactKey: text('artifact_key'),
	searchText: text('search_text'),
	metadataJson: text('metadata_json'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_catalog_items_team_kind_slug').on(table.teamId, table.kind, table.slug),
	index('idx_catalog_items_team_kind').on(table.teamId, table.kind, table.updatedAt),
	index('idx_catalog_items_visibility_listing').on(table.visibility, table.listingEnabled, table.updatedAt)
]);

export const catalogArtifactVersions = pgTable('catalog_artifact_versions', {
	id: text('id').primaryKey(),
	itemId: text('item_id').notNull(),
	teamId: text('team_id').notNull(),
	kind: text('kind').notNull(),
	version: text('version').notNull(),
	contentKey: text('content_key').notNull(),
	manifestKey: text('manifest_key'),
	metadataJson: text('metadata_json'),
	publishedAt: text('published_at').notNull(),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_catalog_artifact_versions_item_version').on(table.itemId, table.version),
	index('idx_catalog_artifact_versions_team_kind').on(table.teamId, table.kind, table.publishedAt)
]);

export const catalogItemCollaborators = pgTable('catalog_item_collaborators', {
	id: text('id').primaryKey(),
	itemId: text('item_id').notNull(),
	subjectType: text('subject_type').notNull(),
	subjectId: text('subject_id').notNull(),
	role: text('role').notNull(),
	metadataJson: text('metadata_json'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_catalog_item_collaborators_subject_role').on(table.itemId, table.subjectType, table.subjectId, table.role)
]);

export const commerceVendors = pgTable('commerce_vendors', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	displayName: text('display_name').notNull(),
	slug: text('slug').notNull(),
	status: text('status').notNull().default('submitted'),
	trustLevel: text('trust_level').notNull().default('public_publisher'),
	professionalEntitlementId: text('professional_entitlement_id'),
	stripeAccountId: text('stripe_account_id'),
	salesEnabled: integer('sales_enabled').notNull().default(0),
	serviceSalesEnabled: integer('service_sales_enabled').notNull().default(0),
	capacityListingsEnabled: integer('capacity_listings_enabled').notNull().default(0),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_commerce_vendors_team_id').on(table.teamId),
	uniqueIndex('idx_commerce_vendors_slug').on(table.slug),
	index('idx_commerce_vendors_status').on(table.status, table.updatedAt),
	index('idx_commerce_vendors_trust_level').on(table.trustLevel, table.updatedAt)
]);

export const commerceVendorStripeAccounts = pgTable('commerce_vendor_stripe_accounts', {
	id: text('id').primaryKey(),
	vendorId: text('vendor_id').notNull(),
	teamId: text('team_id').notNull(),
	environment: text('environment').notNull().default('test'),
	stripeAccountId: text('stripe_account_id').notNull(),
	accountStatus: text('account_status').notNull().default('pending'),
	onboardingStatus: text('onboarding_status').notNull().default('not_started'),
	chargesEnabled: integer('charges_enabled').notNull().default(0),
	payoutsEnabled: integer('payouts_enabled').notNull().default(0),
	detailsSubmitted: integer('details_submitted').notNull().default(0),
	requirementsCurrentlyDueJson: text('requirements_currently_due_json').notNull().default('[]'),
	requirementsEventuallyDueJson: text('requirements_eventually_due_json').notNull().default('[]'),
	requirementsPastDueJson: text('requirements_past_due_json').notNull().default('[]'),
	requirementsDisabledReason: text('requirements_disabled_reason'),
	capabilitiesJson: text('capabilities_json').notNull().default('{}'),
	onboardingStartedAt: text('onboarding_started_at'),
	onboardingCompletedAt: text('onboarding_completed_at'),
	lastSyncedAt: text('last_synced_at'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_commerce_vendor_stripe_accounts_vendor_env').on(table.vendorId, table.environment),
	uniqueIndex('idx_commerce_vendor_stripe_accounts_stripe_env').on(table.stripeAccountId, table.environment),
	index('idx_commerce_vendor_stripe_accounts_team_env').on(table.teamId, table.environment),
	index('idx_commerce_vendor_stripe_accounts_status').on(table.accountStatus, table.updatedAt)
]);

export const commerceProducts = pgTable('commerce_products', {
	id: text('id').primaryKey(),
	vendorId: text('vendor_id').notNull(),
	sellerTeamId: text('seller_team_id').notNull(),
	kind: text('kind').notNull(),
	slug: text('slug').notNull(),
	title: text('title').notNull(),
	summary: text('summary'),
	description: text('description'),
	status: text('status').notNull().default('draft'),
	visibility: text('visibility').notNull().default('private'),
	catalogItemId: text('catalog_item_id'),
	currentVersionId: text('current_version_id'),
	ownershipModel: text('ownership_model').notNull().default('team_owned'),
	ownershipRecordId: text('ownership_record_id'),
	supportPolicy: text('support_policy'),
	license: text('license'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_commerce_products_team_kind_slug').on(table.sellerTeamId, table.kind, table.slug),
	index('idx_commerce_products_vendor_status').on(table.vendorId, table.status, table.updatedAt),
	index('idx_commerce_products_catalog_item').on(table.catalogItemId),
	index('idx_commerce_products_ownership_model').on(table.ownershipModel, table.updatedAt)
]);

export const commerceOwnershipRecords = pgTable('commerce_ownership_records', {
	id: text('id').primaryKey(),
	productId: text('product_id').notNull(),
	model: text('model').notNull(),
	canonicalOwnerType: text('canonical_owner_type').notNull(),
	canonicalOwnerId: text('canonical_owner_id'),
	sellerTeamId: text('seller_team_id').notNull(),
	stewardTeamId: text('steward_team_id'),
	governancePolicyId: text('governance_policy_id'),
	publicSummary: text('public_summary'),
	buyerVisible: integer('buyer_visible').notNull().default(1),
	effectiveAt: text('effective_at').notNull(),
	supersededAt: text('superseded_at'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_commerce_ownership_product_effective').on(table.productId, table.effectiveAt),
	index('idx_commerce_ownership_seller_effective').on(table.sellerTeamId, table.effectiveAt),
	index('idx_commerce_ownership_model_effective').on(table.model, table.effectiveAt)
]);

export const commerceStewardshipAssignments = pgTable('commerce_stewardship_assignments', {
	id: text('id').primaryKey(),
	ownershipRecordId: text('ownership_record_id').notNull(),
	productId: text('product_id').notNull(),
	role: text('role').notNull(),
	assigneeType: text('assignee_type').notNull(),
	assigneeId: text('assignee_id'),
	displayName: text('display_name'),
	responsibilitiesJson: text('responsibilities_json').notNull().default('[]'),
	visibleToBuyers: integer('visible_to_buyers').notNull().default(1),
	startsAt: text('starts_at').notNull(),
	endsAt: text('ends_at'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_commerce_stewards_product_role').on(table.productId, table.role),
	index('idx_commerce_stewards_ownership_role').on(table.ownershipRecordId, table.role),
	index('idx_commerce_stewards_assignee').on(table.assigneeType, table.assigneeId)
]);

export const commerceContributions = pgTable('commerce_contributions', {
	id: text('id').primaryKey(),
	productId: text('product_id').notNull(),
	productVersionId: text('product_version_id'),
	contributorType: text('contributor_type').notNull(),
	contributorId: text('contributor_id'),
	displayName: text('display_name'),
	role: text('role').notNull(),
	summary: text('summary'),
	attributionVisibility: text('attribution_visibility').notNull().default('public'),
	agreementRef: text('agreement_ref'),
	benefitWeight: real('benefit_weight'),
	effectiveAt: text('effective_at').notNull(),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_commerce_contributions_product_effective').on(table.productId, table.effectiveAt),
	index('idx_commerce_contributions_version_effective').on(table.productVersionId, table.effectiveAt),
	index('idx_commerce_contributions_contributor').on(table.contributorType, table.contributorId)
]);

export const commerceGovernancePolicies = pgTable('commerce_governance_policies', {
	id: text('id').primaryKey(),
	productId: text('product_id'),
	teamId: text('team_id'),
	policyKind: text('policy_kind').notNull(),
	title: text('title').notNull(),
	approvalRulesJson: text('approval_rules_json').notNull().default('{}'),
	quorumRulesJson: text('quorum_rules_json').notNull().default('{}'),
	buyerVisibleSummary: text('buyer_visible_summary'),
	status: text('status').notNull().default('draft'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_commerce_governance_policies_product').on(table.productId, table.status),
	index('idx_commerce_governance_policies_team').on(table.teamId, table.policyKind, table.status)
]);

export const commerceOwnershipTransfers = pgTable('commerce_ownership_transfers', {
	id: text('id').primaryKey(),
	productId: text('product_id').notNull(),
	fromOwnershipRecordId: text('from_ownership_record_id').notNull(),
	toOwnershipRecordId: text('to_ownership_record_id').notNull(),
	status: text('status').notNull().default('draft'),
	reason: text('reason').notNull(),
	approvalEvidenceJson: text('approval_evidence_json').notNull().default('{}'),
	buyerVisibleImpact: text('buyer_visible_impact'),
	effectiveAt: text('effective_at').notNull(),
	requestedByType: text('requested_by_type').notNull().default('user'),
	requestedById: text('requested_by_id').notNull().default('system'),
	approvedByType: text('approved_by_type'),
	approvedById: text('approved_by_id'),
	approvedAt: text('approved_at'),
	rejectedAt: text('rejected_at'),
	supersededAt: text('superseded_at'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
}, (table) => [
	index('idx_commerce_ownership_transfers_product').on(table.productId, table.effectiveAt),
	index('idx_commerce_ownership_transfers_product_status').on(table.productId, table.status, table.effectiveAt),
	index('idx_commerce_ownership_transfers_from_status').on(table.fromOwnershipRecordId, table.status),
	index('idx_commerce_ownership_transfers_to_status').on(table.toOwnershipRecordId, table.status)
]);

export const commerceSuccessionEvents = pgTable('commerce_succession_events', {
	id: text('id').primaryKey(),
	productId: text('product_id').notNull(),
	ownershipRecordId: text('ownership_record_id'),
	stewardshipAssignmentId: text('stewardship_assignment_id'),
	successorType: text('successor_type').notNull(),
	successorId: text('successor_id').notNull(),
	eventType: text('event_type').notNull(),
	status: text('status').notNull().default('submitted'),
	reason: text('reason'),
	evidenceJson: text('evidence_json').notNull().default('{}'),
	effectiveAt: text('effective_at'),
	createdByType: text('created_by_type').notNull(),
	createdById: text('created_by_id').notNull(),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
}, (table) => [
	index('idx_commerce_succession_events_product').on(table.productId, table.eventType, table.createdAt),
	index('idx_commerce_succession_events_ownership').on(table.ownershipRecordId, table.eventType),
	index('idx_commerce_succession_events_successor').on(table.successorType, table.successorId)
]);
