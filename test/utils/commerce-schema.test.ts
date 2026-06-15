import { describe, expect, it } from 'vitest';
import {
	commerceBuyerStripeCustomers,
	commerceCapacityListingInquiries,
	commerceCapacityListings,
	commerceCartItems,
	commerceCarts,
	commerceCheckouts,
	commerceContributions,
	commerceEntitlements,
	commerceFulfillmentEvents,
	commerceGovernanceEvents,
	commerceGovernancePolicies,
	commerceOrderItems,
	commerceOrders,
	commerceOffers,
	commerceOwnershipRecords,
	commerceOwnershipTransfers,
	commercePaymentGroups,
	commercePrices,
	commerceProducts,
	commerceProductVersions,
	commerceRefunds,
	commerceServiceContracts,
	commerceServiceEvents,
	commerceServiceQuotes,
	commerceServiceRequests,
	commerceStewardshipAssignments,
	commerceSubscriptions,
	commerceSuccessionEvents,
	commerceVendorStripeAccounts,
	commerceVendors,
	commerceWebhookEvents,
} from '../../src/db/market-schema.ts';

function tableName(table: unknown) {
	return (table as { [key: symbol]: string })[Symbol.for('drizzle:Name')];
}

describe('commerce market schema', () => {
	it('exports the phase 2 commerce registry tables with stable database names', () => {
		expect(tableName(commerceVendors)).toBe('commerce_vendors');
		expect(tableName(commerceProducts)).toBe('commerce_products');
		expect(tableName(commerceOwnershipRecords)).toBe('commerce_ownership_records');
		expect(tableName(commerceStewardshipAssignments)).toBe('commerce_stewardship_assignments');
		expect(tableName(commerceContributions)).toBe('commerce_contributions');
		expect(tableName(commerceGovernancePolicies)).toBe('commerce_governance_policies');
		expect(tableName(commerceOwnershipTransfers)).toBe('commerce_ownership_transfers');
		expect(tableName(commerceProductVersions)).toBe('commerce_product_versions');
		expect(tableName(commerceOffers)).toBe('commerce_offers');
		expect(tableName(commercePrices)).toBe('commerce_prices');
		expect(tableName(commerceGovernanceEvents)).toBe('commerce_governance_events');
	});

	it('exports the phase 3 Stripe connected account table', () => {
		expect(tableName(commerceVendorStripeAccounts)).toBe('commerce_vendor_stripe_accounts');
		expect([
			tableName(commerceVendors),
			tableName(commerceVendorStripeAccounts),
			tableName(commerceProducts),
			tableName(commerceOffers),
			tableName(commercePrices),
		]).not.toEqual(expect.arrayContaining(['commerce_payouts']));
	});

	it('adds phase 4 Stripe mirror state to offers and prices', () => {
		expect(commerceOffers).toHaveProperty('stripeProductId');
		expect(commerceOffers).toHaveProperty('stripeProductStatus');
		expect(commerceOffers).toHaveProperty('stripeProductSyncedAt');
		expect(commerceOffers).toHaveProperty('stripeProductSyncError');
		expect(commerceOffers).toHaveProperty('stripeProductMetadataJson');
		expect(commercePrices).toHaveProperty('stripeSyncStatus');
		expect(commercePrices).toHaveProperty('stripeSyncedAt');
		expect(commercePrices).toHaveProperty('stripeSyncError');
		expect(commercePrices).toHaveProperty('stripeMetadataJson');
		expect([
			tableName(commerceVendors),
			tableName(commerceVendorStripeAccounts),
			tableName(commerceProducts),
			tableName(commerceOffers),
			tableName(commercePrices),
		]).not.toEqual(expect.arrayContaining([
			'commerce_payouts',
			'commerce_application_fees',
		]));
	});

	it('exports the phase 5 checkout, order, webhook, and entitlement tables without payout or commission tables', () => {
		expect(tableName(commerceCarts)).toBe('commerce_carts');
		expect(tableName(commerceCartItems)).toBe('commerce_cart_items');
		expect(tableName(commerceCheckouts)).toBe('commerce_checkouts');
		expect(tableName(commerceOrders)).toBe('commerce_orders');
		expect(tableName(commerceOrderItems)).toBe('commerce_order_items');
		expect(tableName(commercePaymentGroups)).toBe('commerce_payment_groups');
		expect(tableName(commerceSubscriptions)).toBe('commerce_subscriptions');
		expect(tableName(commerceEntitlements)).toBe('commerce_entitlements');
		expect(tableName(commerceBuyerStripeCustomers)).toBe('commerce_buyer_stripe_customers');
		expect(tableName(commerceWebhookEvents)).toBe('commerce_webhook_events');
		expect([
			tableName(commerceCarts),
			tableName(commerceOrders),
			tableName(commerceEntitlements),
			tableName(commerceWebhookEvents),
		]).not.toEqual(expect.arrayContaining([
			'commerce_commissions',
			'commerce_payouts',
			'commerce_application_fees',
			'commerce_capacity_credits',
		]));
	});

	it('exports the phase 6 refund and fulfillment tables without payout, commission, or capacity credit tables', () => {
		expect(tableName(commerceRefunds)).toBe('commerce_refunds');
		expect(tableName(commerceFulfillmentEvents)).toBe('commerce_fulfillment_events');
		expect(commerceOrders).toHaveProperty('refundedAmount');
		expect(commerceOrders).toHaveProperty('refundStatus');
		expect(commerceOrderItems).toHaveProperty('refundedAmount');
		expect(commerceOrderItems).toHaveProperty('refundStatus');
		expect([
			tableName(commerceRefunds),
			tableName(commerceFulfillmentEvents),
		]).not.toEqual(expect.arrayContaining([
			'commerce_commissions',
			'commerce_payouts',
			'commerce_application_fees',
			'commerce_transfers',
			'commerce_capacity_credits',
		]));
	});

	it('exports the phase 7 cooperative ownership workflow tables without financial allocation tables', () => {
		expect(tableName(commerceSuccessionEvents)).toBe('commerce_succession_events');
		expect(commerceOwnershipTransfers).toHaveProperty('status');
		expect(commerceOwnershipTransfers).toHaveProperty('requestedByType');
		expect(commerceOwnershipTransfers).toHaveProperty('approvedAt');
		expect(commerceOwnershipTransfers).toHaveProperty('metadataJson');
		expect([
			tableName(commerceSuccessionEvents),
			tableName(commerceOwnershipTransfers),
		]).not.toEqual(expect.arrayContaining([
			'commerce_revenue_splits',
			'commerce_commissions',
			'commerce_payouts',
			'commerce_application_fees',
			'commerce_transfer_ledger',
			'commerce_capacity_credits',
		]));
	});

	it('exports the phase 8 scoped service tables without financial allocation or capacity marketplace tables', () => {
		expect(tableName(commerceServiceRequests)).toBe('commerce_service_requests');
		expect(tableName(commerceServiceQuotes)).toBe('commerce_service_quotes');
		expect(tableName(commerceServiceContracts)).toBe('commerce_service_contracts');
		expect(tableName(commerceServiceEvents)).toBe('commerce_service_events');
		expect([
			tableName(commerceServiceRequests),
			tableName(commerceServiceQuotes),
			tableName(commerceServiceContracts),
			tableName(commerceServiceEvents),
		]).not.toEqual(expect.arrayContaining([
			'commerce_revenue_splits',
			'commerce_commissions',
			'commerce_payouts',
			'commerce_application_fees',
			'commerce_capacity_credits',
			'commerce_capacity_marketplace_listings',
		]));
	});

	it('exports the phase 9 capacity marketplace foundation tables without billing or execution tables', () => {
		expect(tableName(commerceCapacityListings)).toBe('commerce_capacity_listings');
		expect(tableName(commerceCapacityListingInquiries)).toBe('commerce_capacity_listing_inquiries');
		expect(commerceCapacityListings).toHaveProperty('capacityProviderId');
		expect(commerceCapacityListings).toHaveProperty('ownershipSnapshotJson');
		expect(commerceCapacityListingInquiries).toHaveProperty('governanceEvidenceJson');
		expect([
			tableName(commerceCapacityListings),
			tableName(commerceCapacityListingInquiries),
		]).not.toEqual(expect.arrayContaining([
			'commerce_revenue_splits',
			'commerce_commissions',
			'commerce_payouts',
			'commerce_application_fees',
			'commerce_capacity_credits',
			'commerce_capacity_billing',
			'commerce_capacity_marketplace_reservations',
			'commerce_capacity_marketplace_grants',
			'commerce_capacity_execution_jobs',
		]));
	});
});
