import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
	COMMONS_DECISION_STATUSES,
	COMMONS_GOVERNANCE_EVENT_TYPES,
	COMMONS_PARTICIPANT_STATUSES,
	COMMONS_PROPOSAL_STATUSES,
	COMMONS_QUESTION_STATUSES,
	COMMONS_VOTE_VALUES,
	COMMERCE_CART_STATUSES,
	COMMERCE_CAPACITY_ACCESS_LEVELS,
	COMMERCE_CAPACITY_AI_INVOLVEMENT_LEVELS,
	COMMERCE_CAPACITY_DATA_ACCESS_LEVELS,
	COMMERCE_CAPACITY_HUMAN_INVOLVEMENT_LEVELS,
	COMMERCE_CAPACITY_INQUIRY_STATUSES,
	COMMERCE_CAPACITY_LISTING_STATUSES,
	COMMERCE_CAPACITY_RUNTIME_ISOLATION_LEVELS,
	COMMERCE_CAPACITY_SECRET_ACCESS_LEVELS,
	COMMERCE_CHECKOUT_STATUSES,
	COMMERCE_OFFER_MODES,
	COMMERCE_ORDER_ITEM_STATUSES,
	COMMERCE_ORDER_STATUSES,
	COMMERCE_OWNERSHIP_MODELS,
	COMMERCE_PAYMENT_GROUP_STATUSES,
	COMMERCE_STEWARDSHIP_ROLES,
	COMMERCE_FULFILLMENT_EVENT_TYPES,
	COMMERCE_FULFILLMENT_STATUSES,
	COMMERCE_GOVERNANCE_DECISION_TYPES,
	COMMERCE_REFUND_STATUSES,
	COMMERCE_SERVICE_CONTRACT_STATUSES,
	COMMERCE_SERVICE_EVENT_TYPES,
	COMMERCE_SERVICE_QUOTE_STATUSES,
	COMMERCE_SERVICE_REQUEST_STATUSES,
	COMMERCE_OWNERSHIP_TRANSFER_STATUSES,
	COMMERCE_SUBSCRIPTION_STATUSES,
	COMMERCE_SUCCESSION_EVENT_TYPES,
	COMMERCE_STRIPE_ACCOUNT_STATUSES,
	COMMERCE_STRIPE_ENVIRONMENTS,
	COMMERCE_STRIPE_ONBOARDING_STATUSES,
	COMMERCE_STRIPE_SYNC_STATUSES,
	COMMERCE_VENDOR_TRUST_LEVELS,
	COMMERCE_WEBHOOK_EVENT_STATUSES,
	type CommerceCheckout,
	type CommerceCommerceMonitor,
	type CommerceCapacityListing,
	type CommerceCapacityListingInquiry,
	type CommerceEntitlement,
	type CommerceFulfillmentEvent,
	type CommerceMarketplaceCatalogResponse,
	type CommerceOffer,
	type CommerceOwnershipRecord,
	type CommerceOwnershipWorkflowSummary,
	type CommercePaymentGroup,
	type CommercePaymentGroupRefreshResponse,
	type CommercePrice,
	type CommerceProduct,
	type CommerceRefund,
	type CommerceServiceContract,
	type CommerceServiceEvent,
	type CommerceServiceQuote,
	type CommerceServiceRequest,
	type CommerceSubscription,
	type CommerceSuccessionEvent,
	type CommerceVendorSalesSummary,
	type CommerceWebhookEvent,
	type CommonsDecision,
	type CommonsGovernanceEvent,
	type CommonsParticipant,
	type CommonsProposal,
	type CommonsProposalVote,
	type CommonsQuestion,
	type StripeConnectedAccount,
} from '../../../src/sdk-types.ts';
describe('commerce contracts', () => {
it('defines Phase 7 cooperative governance workflow vocabulary', () => {
		expect(COMMERCE_OWNERSHIP_TRANSFER_STATUSES).toEqual(['draft', 'submitted', 'approved', 'rejected', 'canceled', 'superseded']);
		expect(COMMERCE_SUCCESSION_EVENT_TYPES).toEqual([
			'successor_named',
			'successor_accepted',
			'succession_triggered',
			'succession_completed',
			'succession_canceled',
		]);
		expect(COMMERCE_GOVERNANCE_DECISION_TYPES).toEqual([
			'ownership_record',
			'stewardship_assignment',
			'contribution',
			'governance_policy',
			'ownership_transfer',
			'succession',
		]);
	});

it('defines Phase 8 scoped service workflow vocabulary', () => {
		expect(COMMERCE_SERVICE_REQUEST_STATUSES).toEqual([
			'requested',
			'scoping',
			'quoted',
			'buyer_approved',
			'vendor_approved',
			'checkout_pending',
			'active',
			'fulfilled',
			'declined',
			'canceled',
			'expired',
		]);
		expect(COMMERCE_SERVICE_QUOTE_STATUSES).toEqual([
			'draft',
			'submitted',
			'buyer_approved',
			'vendor_approved',
			'accepted',
			'rejected',
			'expired',
			'superseded',
			'canceled',
		]);
		expect(COMMERCE_SERVICE_CONTRACT_STATUSES).toEqual(['pending_checkout', 'active', 'fulfilled', 'canceled', 'disputed']);
		expect(COMMERCE_SERVICE_EVENT_TYPES).toEqual([
			'requested',
			'scoping_started',
			'scope_updated',
			'quote_created',
			'quote_submitted',
			'quote_buyer_approved',
			'quote_vendor_approved',
			'quote_rejected',
			'quote_expired',
			'checkout_created',
			'contract_activated',
			'work_linked',
			'manual_update',
			'fulfilled',
			'declined',
			'canceled',
		]);
	});

it('defines Phase 9 capacity listing and inquiry vocabulary', () => {
		expect(COMMERCE_CAPACITY_LISTING_STATUSES).toEqual(['draft', 'submitted', 'approved', 'rejected', 'suspended', 'archived']);
		expect(COMMERCE_CAPACITY_INQUIRY_STATUSES).toEqual(['requested', 'reviewing', 'approved_for_scoping', 'declined', 'canceled']);
		expect(COMMERCE_CAPACITY_ACCESS_LEVELS).toEqual(['public_summary', 'buyer_gated', 'governance_required', 'private_invite']);
		expect(COMMERCE_CAPACITY_RUNTIME_ISOLATION_LEVELS).toEqual(['none', 'project_scoped', 'tenant_isolated', 'dedicated_runtime', 'external_only']);
		expect(COMMERCE_CAPACITY_HUMAN_INVOLVEMENT_LEVELS).toEqual(['none', 'review_only', 'operator_assisted', 'human_delivered']);
		expect(COMMERCE_CAPACITY_AI_INVOLVEMENT_LEVELS).toEqual(['none', 'assistive', 'agentic', 'model_hosted']);
		expect(COMMERCE_CAPACITY_DATA_ACCESS_LEVELS).toEqual(['none', 'public_only', 'buyer_provided', 'project_scoped', 'sensitive_review_required']);
		expect(COMMERCE_CAPACITY_SECRET_ACCESS_LEVELS).toEqual(['none', 'buyer_managed', 'delegated_scoped', 'market_admin_review_required']);
	});
});
