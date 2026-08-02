import { bigint,index,integer,pgTable,text,uniqueIndex } from 'drizzle-orm/pg-core';


export const commerceCapacityListings = pgTable('commerce_capacity_listings', {
	id: text('id').primaryKey(),
	productId: text('product_id').notNull(),
	vendorId: text('vendor_id').notNull(),
	sellerTeamId: text('seller_team_id').notNull(),
	capacityProviderId: text('capacity_provider_id'),
	executionProviderId: text('execution_provider_id'),
	status: text('status').notNull().default('draft'),
	accessLevel: text('access_level').notNull().default('public_summary'),
	runtimeIsolationLevel: text('runtime_isolation_level').notNull().default('none'),
	humanInvolvementLevel: text('human_involvement_level').notNull().default('none'),
	aiInvolvementLevel: text('ai_involvement_level').notNull().default('none'),
	dataAccessLevel: text('data_access_level').notNull().default('none'),
	secretAccessLevel: text('secret_access_level').notNull().default('none'),
	supportedServiceTypesJson: text('supported_service_types_json').notNull().default('[]'),
	supportedRegionsJson: text('supported_regions_json').notNull().default('[]'),
	runtimeRequirementsJson: text('runtime_requirements_json').notNull().default('{}'),
	dataHandlingSummary: text('data_handling_summary'),
	buyerVisibleRiskSummary: text('buyer_visible_risk_summary'),
	governanceRequirementsJson: text('governance_requirements_json').notNull().default('{}'),
	supportPolicy: text('support_policy'),
	availabilitySummary: text('availability_summary'),
	ownershipSnapshotJson: text('ownership_snapshot_json').notNull().default('{}'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_commerce_capacity_listings_product').on(table.productId),
	index('idx_commerce_capacity_listings_vendor_status').on(table.vendorId, table.status, table.updatedAt),
	index('idx_commerce_capacity_listings_seller_status').on(table.sellerTeamId, table.status, table.updatedAt),
	index('idx_commerce_capacity_listings_provider_status').on(table.capacityProviderId, table.status),
	index('idx_commerce_capacity_listings_execution_provider_status').on(table.executionProviderId, table.status),
	index('idx_commerce_capacity_listings_access_status').on(table.accessLevel, table.status, table.updatedAt)
]);

export const commerceCapacityListingInquiries = pgTable('commerce_capacity_listing_inquiries', {
	id: text('id').primaryKey(),
	listingId: text('listing_id').notNull(),
	productId: text('product_id').notNull(),
	vendorId: text('vendor_id').notNull(),
	sellerTeamId: text('seller_team_id').notNull(),
	buyerTeamId: text('buyer_team_id'),
	buyerUserId: text('buyer_user_id'),
	status: text('status').notNull().default('requested'),
	requestedServiceType: text('requested_service_type'),
	requestedScope: text('requested_scope').notNull(),
	dataAccessRequestedJson: text('data_access_requested_json').notNull().default('{}'),
	secretAccessRequestedJson: text('secret_access_requested_json').notNull().default('{}'),
	relatedProjectId: text('related_project_id'),
	relatedWorkdayId: text('related_workday_id'),
	governanceEvidenceJson: text('governance_evidence_json').notNull().default('{}'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_commerce_capacity_inquiries_listing_status').on(table.listingId, table.status, table.updatedAt),
	index('idx_commerce_capacity_inquiries_buyer_team').on(table.buyerTeamId, table.status, table.updatedAt),
	index('idx_commerce_capacity_inquiries_buyer_user').on(table.buyerUserId, table.status, table.updatedAt),
	index('idx_commerce_capacity_inquiries_vendor_status').on(table.vendorId, table.status, table.updatedAt),
	index('idx_commerce_capacity_inquiries_seller_status').on(table.sellerTeamId, table.status, table.updatedAt),
	index('idx_commerce_capacity_inquiries_project').on(table.relatedProjectId, table.status),
	index('idx_commerce_capacity_inquiries_workday').on(table.relatedWorkdayId, table.status)
]);

export const commerceWebhookEvents = pgTable('commerce_webhook_events', {
	id: text('id').primaryKey(),
	provider: text('provider').notNull().default('stripe'),
	environment: text('environment').notNull().default('test'),
	eventId: text('event_id').notNull(),
	eventType: text('event_type').notNull(),
	connectedAccountId: text('connected_account_id'),
	status: text('status').notNull().default('received'),
	objectType: text('object_type'),
	objectId: text('object_id'),
	relatedOrderId: text('related_order_id'),
	relatedSubscriptionId: text('related_subscription_id'),
	payloadHash: text('payload_hash').notNull(),
	processingError: text('processing_error'),
	receivedAt: text('received_at').notNull(),
	processedAt: text('processed_at'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_commerce_webhook_events_provider_event').on(table.provider, table.environment, table.eventId),
	index('idx_commerce_webhook_events_status_received').on(table.status, table.receivedAt),
	index('idx_commerce_webhook_events_connected_type').on(table.connectedAccountId, table.eventType, table.receivedAt),
	index('idx_commerce_webhook_events_order').on(table.relatedOrderId),
	index('idx_commerce_webhook_events_subscription').on(table.relatedSubscriptionId)
]);

export const projectSummarySnapshots = pgTable('project_summary_snapshots', {
	projectId: text('project_id').primaryKey(),
	teamId: text('team_id').notNull(),
	summaryJson: text('summary_json').notNull(),
	generatedAt: text('generated_at').notNull(),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_project_summary_snapshots_team_generated').on(table.teamId, table.generatedAt)
]);

export const teamInboxItems = pgTable('team_inbox_items', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	projectId: text('project_id'),
	kind: text('kind').notNull(),
	state: text('state').notNull(),
	title: text('title').notNull(),
	summary: text('summary'),
	href: text('href'),
	itemKey: text('item_key'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_team_inbox_items_team_created').on(table.teamId, table.createdAt)
]);

export const betterAuthUser = pgTable('better_auth_user', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	email: text('email').notNull().unique(),
	emailVerified: integer('emailVerified').notNull().default(0),
	image: text('image'),
	createdAt: bigint('createdAt', { mode: 'number' }).notNull(),
	updatedAt: bigint('updatedAt', { mode: 'number' }).notNull(),
	username: text('username'),
	firstName: text('firstName'),
	lastName: text('lastName'),
}, (table) => [
	uniqueIndex('idx_better_auth_user_username').on(table.username)
]);

export const betterAuthSession = pgTable('better_auth_session', {
	id: text('id').primaryKey(),
	expiresAt: bigint('expiresAt', { mode: 'number' }).notNull(),
	token: text('token').notNull().unique(),
	createdAt: bigint('createdAt', { mode: 'number' }).notNull(),
	updatedAt: bigint('updatedAt', { mode: 'number' }).notNull(),
	ipAddress: text('ipAddress'),
	userAgent: text('userAgent'),
	userId: text('userId').notNull(),
}, (table) => [
	index('idx_better_auth_session_token').on(table.token),
	index('idx_better_auth_session_userId').on(table.userId)
]);
