import { sql } from 'drizzle-orm';
import { bigint, check, foreignKey, index, integer, pgTable, primaryKey, real, serial, text, uniqueIndex } from 'drizzle-orm/pg-core';


export const commerceProductVersions = pgTable('commerce_product_versions', {
	id: text('id').primaryKey(),
	productId: text('product_id').notNull(),
	version: text('version').notNull(),
	status: text('status').notNull().default('draft'),
	catalogArtifactVersionId: text('catalog_artifact_version_id'),
	manifestKey: text('manifest_key'),
	artifactKey: text('artifact_key'),
	integrity: text('integrity'),
	releaseNotes: text('release_notes'),
	compatibilityJson: text('compatibility_json').notNull().default('{}'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	publishedAt: text('published_at'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_commerce_product_versions_product_version').on(table.productId, table.version),
	index('idx_commerce_product_versions_product_status').on(table.productId, table.status, table.createdAt),
	index('idx_commerce_product_versions_catalog_artifact').on(table.catalogArtifactVersionId)
]);

export const commerceOffers = pgTable('commerce_offers', {
	id: text('id').primaryKey(),
	productId: text('product_id').notNull(),
	productVersionId: text('product_version_id'),
	vendorId: text('vendor_id').notNull(),
	sellerTeamId: text('seller_team_id').notNull(),
	mode: text('mode').notNull(),
	status: text('status').notNull().default('draft'),
	title: text('title').notNull(),
	termsSummary: text('terms_summary'),
	accessScopeJson: text('access_scope_json').notNull().default('{}'),
	supportScopeJson: text('support_scope_json').notNull().default('{}'),
	fulfillmentMode: text('fulfillment_mode').notNull().default('automatic'),
	activePriceId: text('active_price_id'),
	stripeProductId: text('stripe_product_id'),
	stripeProductStatus: text('stripe_product_status').notNull().default('not_synced'),
	stripeProductSyncedAt: text('stripe_product_synced_at'),
	stripeProductSyncError: text('stripe_product_sync_error'),
	stripeProductMetadataJson: text('stripe_product_metadata_json').notNull().default('{}'),
	startsAt: text('starts_at'),
	endsAt: text('ends_at'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_commerce_offers_product_status').on(table.productId, table.status, table.updatedAt),
	index('idx_commerce_offers_vendor_status').on(table.vendorId, table.status, table.updatedAt),
	index('idx_commerce_offers_seller_status').on(table.sellerTeamId, table.status, table.updatedAt),
	index('idx_commerce_offers_active_price').on(table.activePriceId),
	index('idx_commerce_offers_stripe_product').on(table.stripeProductId),
	index('idx_commerce_offers_stripe_status').on(table.stripeProductStatus, table.updatedAt)
]);

export const commercePrices = pgTable('commerce_prices', {
	id: text('id').primaryKey(),
	offerId: text('offer_id').notNull(),
	amount: integer('amount').notNull(),
	currency: text('currency').notNull(),
	billingInterval: text('billing_interval').notNull(),
	status: text('status').notNull().default('draft'),
	stripeProductId: text('stripe_product_id'),
	stripePriceId: text('stripe_price_id'),
	stripeLookupKey: text('stripe_lookup_key'),
	stripeSyncStatus: text('stripe_sync_status').notNull().default('not_synced'),
	stripeSyncedAt: text('stripe_synced_at'),
	stripeSyncError: text('stripe_sync_error'),
	stripeMetadataJson: text('stripe_metadata_json').notNull().default('{}'),
	priceVersion: integer('price_version').notNull().default(1),
	taxBehavior: text('tax_behavior').notNull().default('unspecified'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_commerce_prices_offer_version').on(table.offerId, table.priceVersion),
	index('idx_commerce_prices_offer_status').on(table.offerId, table.status),
	index('idx_commerce_prices_stripe_price').on(table.stripePriceId),
	index('idx_commerce_prices_stripe_sync_status').on(table.stripeSyncStatus, table.updatedAt)
]);

export const commerceGovernanceEvents = pgTable('commerce_governance_events', {
	id: text('id').primaryKey(),
	actorType: text('actor_type').notNull(),
	actorId: text('actor_id'),
	action: text('action').notNull(),
	objectType: text('object_type').notNull(),
	objectId: text('object_id').notNull(),
	priorState: text('prior_state'),
	nextState: text('next_state'),
	reason: text('reason'),
	evidenceJson: text('evidence_json').notNull().default('{}'),
	relatedOrderId: text('related_order_id'),
	relatedOfferId: text('related_offer_id'),
	relatedProductId: text('related_product_id'),
	relatedTeamId: text('related_team_id'),
	createdAt: text('created_at').notNull(),
}, (table) => [
	index('idx_commerce_governance_events_object').on(table.objectType, table.objectId, table.createdAt),
	index('idx_commerce_governance_events_product').on(table.relatedProductId, table.createdAt),
	index('idx_commerce_governance_events_offer').on(table.relatedOfferId, table.createdAt),
	index('idx_commerce_governance_events_team').on(table.relatedTeamId, table.createdAt)
]);

export const commerceCarts = pgTable('commerce_carts', {
	id: text('id').primaryKey(),
	buyerTeamId: text('buyer_team_id'),
	buyerUserId: text('buyer_user_id'),
	status: text('status').notNull().default('active'),
	currency: text('currency'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_commerce_carts_buyer_team_status').on(table.buyerTeamId, table.status, table.updatedAt),
	index('idx_commerce_carts_buyer_user_status').on(table.buyerUserId, table.status, table.updatedAt)
]);

export const commerceCartItems = pgTable('commerce_cart_items', {
	id: text('id').primaryKey(),
	cartId: text('cart_id').notNull(),
	vendorId: text('vendor_id').notNull(),
	sellerTeamId: text('seller_team_id').notNull(),
	productId: text('product_id').notNull(),
	productVersionId: text('product_version_id'),
	offerId: text('offer_id').notNull(),
	priceId: text('price_id'),
	quantity: integer('quantity').notNull().default(1),
	unitAmount: integer('unit_amount').notNull().default(0),
	currency: text('currency').notNull(),
	mode: text('mode').notNull(),
	status: text('status').notNull().default('active'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_commerce_cart_items_cart_status').on(table.cartId, table.status),
	index('idx_commerce_cart_items_vendor_status').on(table.vendorId, table.status, table.updatedAt),
	index('idx_commerce_cart_items_offer').on(table.offerId),
	index('idx_commerce_cart_items_price').on(table.priceId)
]);

export const commerceCheckouts = pgTable('commerce_checkouts', {
	id: text('id').primaryKey(),
	cartId: text('cart_id').notNull(),
	buyerTeamId: text('buyer_team_id'),
	buyerUserId: text('buyer_user_id'),
	status: text('status').notNull().default('draft'),
	checkoutMode: text('checkout_mode').notNull().default('stripe_elements_grouped_vendor'),
	groupCount: integer('group_count').notNull().default(0),
	completedGroupCount: integer('completed_group_count').notNull().default(0),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_commerce_checkouts_cart').on(table.cartId),
	index('idx_commerce_checkouts_buyer_team_status').on(table.buyerTeamId, table.status, table.updatedAt),
	index('idx_commerce_checkouts_buyer_user_status').on(table.buyerUserId, table.status, table.updatedAt)
]);

export const commerceOrders = pgTable('commerce_orders', {
	id: text('id').primaryKey(),
	checkoutId: text('checkout_id'),
	cartId: text('cart_id'),
	buyerTeamId: text('buyer_team_id'),
	buyerUserId: text('buyer_user_id'),
	vendorId: text('vendor_id'),
	sellerTeamId: text('seller_team_id'),
	status: text('status').notNull().default('draft'),
	currency: text('currency').notNull(),
	subtotalAmount: integer('subtotal_amount').notNull().default(0),
	totalAmount: integer('total_amount').notNull().default(0),
	refundedAmount: integer('refunded_amount').notNull().default(0),
	refundStatus: text('refund_status').notNull().default('none'),
	stripeCheckoutSessionId: text('stripe_checkout_session_id'),
	stripePaymentIntentId: text('stripe_payment_intent_id'),
	stripeSubscriptionId: text('stripe_subscription_id'),
	stripeCustomerId: text('stripe_customer_id'),
	stripeConnectedAccountId: text('stripe_connected_account_id'),
	ownershipSnapshotJson: text('ownership_snapshot_json').notNull().default('{}'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_commerce_orders_checkout').on(table.checkoutId),
	index('idx_commerce_orders_buyer_team_status').on(table.buyerTeamId, table.status, table.updatedAt),
	index('idx_commerce_orders_buyer_user_status').on(table.buyerUserId, table.status, table.updatedAt),
	index('idx_commerce_orders_vendor_status').on(table.vendorId, table.status, table.updatedAt),
	index('idx_commerce_orders_stripe_payment_intent').on(table.stripePaymentIntentId),
	index('idx_commerce_orders_stripe_subscription').on(table.stripeSubscriptionId)
]);

export const commerceOrderItems = pgTable('commerce_order_items', {
	id: text('id').primaryKey(),
	orderId: text('order_id').notNull(),
	vendorId: text('vendor_id').notNull(),
	sellerTeamId: text('seller_team_id').notNull(),
	productId: text('product_id').notNull(),
	productVersionId: text('product_version_id'),
	offerId: text('offer_id').notNull(),
	priceId: text('price_id'),
	mode: text('mode').notNull(),
	quantity: integer('quantity').notNull().default(1),
	unitAmount: integer('unit_amount').notNull().default(0),
	totalAmount: integer('total_amount').notNull().default(0),
	refundedAmount: integer('refunded_amount').notNull().default(0),
	refundStatus: text('refund_status').notNull().default('none'),
	currency: text('currency').notNull(),
	status: text('status').notNull().default('pending'),
	entitlementId: text('entitlement_id'),
	ownershipSnapshotJson: text('ownership_snapshot_json').notNull().default('{}'),
	accessScopeJson: text('access_scope_json').notNull().default('{}'),
	supportScopeJson: text('support_scope_json').notNull().default('{}'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_commerce_order_items_order').on(table.orderId),
	index('idx_commerce_order_items_product_status').on(table.productId, table.status),
	index('idx_commerce_order_items_offer_status').on(table.offerId, table.status),
	index('idx_commerce_order_items_entitlement').on(table.entitlementId)
]);

export const commercePaymentGroups = pgTable('commerce_payment_groups', {
	id: text('id').primaryKey(),
	checkoutId: text('checkout_id').notNull(),
	orderId: text('order_id').notNull(),
	vendorId: text('vendor_id').notNull(),
	sellerTeamId: text('seller_team_id').notNull(),
	connectedAccountId: text('connected_account_id'),
	groupKind: text('group_kind').notNull(),
	billingInterval: text('billing_interval'),
	status: text('status').notNull().default('pending'),
	currency: text('currency').notNull(),
	subtotalAmount: integer('subtotal_amount').notNull().default(0),
	totalAmount: integer('total_amount').notNull().default(0),
	stripePaymentIntentId: text('stripe_payment_intent_id'),
	stripeSubscriptionId: text('stripe_subscription_id'),
	stripeCustomerId: text('stripe_customer_id'),
	clientSecretLast4: text('client_secret_last4'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_commerce_payment_groups_checkout').on(table.checkoutId),
	index('idx_commerce_payment_groups_order').on(table.orderId),
	index('idx_commerce_payment_groups_vendor_status').on(table.vendorId, table.status, table.updatedAt),
	index('idx_commerce_payment_groups_payment_intent').on(table.stripePaymentIntentId),
	index('idx_commerce_payment_groups_subscription').on(table.stripeSubscriptionId)
]);
