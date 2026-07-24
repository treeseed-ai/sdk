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
} from '../../../src/entrypoints/models/sdk-types.ts';

describe('commerce contracts', () => {
	it('defines the clean unreleased offer mode set', () => {
		expect(COMMERCE_OFFER_MODES).toEqual([
			'free', 			'private', 			'contact', 			'one_time', 			'one_time_current_version', 			'subscription', 			'subscription_updates', 			'professional_hosting', 			'scoped_contract', 			'external',
		]);
		expect(COMMERCE_OFFER_MODES).not.toContain('paid');
	});

	it('defines cooperative governance and ownership vocabulary', () => {
		expect(COMMERCE_OWNERSHIP_MODELS).toEqual(expect.arrayContaining([
			'cooperative_owned', 			'community_governed', 			'transferred_or_succeeded',
		]));
		expect(COMMERCE_STEWARDSHIP_ROLES).toEqual(expect.arrayContaining([
			'owner', 			'seller', 			'governance_steward', 			'successor',
		]));
		expect(COMMERCE_VENDOR_TRUST_LEVELS).toEqual(expect.arrayContaining([
			'public_publisher', 			'verified_seller', 			'trusted_capacity_vendor',
		]));
	});

	it('defines TreeSeed Commons governance vocabulary', () => {
		expect(COMMONS_PARTICIPANT_STATUSES).toEqual(['active', 'limited', 'suspended', 'archived']);
		expect(COMMONS_PROPOSAL_STATUSES).toEqual([
			'draft', 			'submitted', 			'backing', 			'qualified', 			'under_review', 			'voting', 			'accepted', 			'rejected', 			'deferred', 			'implemented', 			'archived',
		]);
		expect(COMMONS_QUESTION_STATUSES).toEqual(['open', 'answered', 'converted_to_proposal', 'archived']);
		expect(COMMONS_VOTE_VALUES).toEqual(['support', 'object', 'abstain']);
		expect(COMMONS_DECISION_STATUSES).toEqual(['proposed', 'accepted', 'rejected', 'scheduled', 'implemented', 'archived']);
		expect(COMMONS_GOVERNANCE_EVENT_TYPES).toEqual(expect.arrayContaining([
			'participant.joined', 			'proposal.backed', 			'proposal.voted', 			'proposal.steward_decision', 			'decision.created',
		]));
	});

	it('typechecks representative TreeSeed Commons governance records', () => {
		const participant = {
			id: 'commons_participant_1', 			userId: 'user_1', 			teamId: 'treeseed', 			status: 'active', 			displayName: 'Ada Steward', 			verifiedEmail: true, 			baseWeight: 1, 			trustWeight: 0.5, 			contributionWeight: 0.5, 			stakeholderWeight: 0, 			delegatedWeight: 0, 			totalWeight: 2,
			metadata: {},
			createdAt: '2026-06-15T00:00:00.000Z', 			updatedAt: '2026-06-15T00:00:00.000Z',
		} satisfies CommonsParticipant;
		const question = {
			id: 'commons_question_1', 			participantId: participant.id, 			userId: participant.userId, 			teamId: participant.teamId, 			status: 'open', 			title: 'What should TreeSeed prioritize?', 			body: 'How should the cooperative roadmap be shaped?', 			answer: null, 			convertedProposalId: null,
			metadata: {},
			createdAt: participant.createdAt, 			updatedAt: participant.updatedAt,
		} satisfies CommonsQuestion;
		const proposal = {
			id: 'commons_proposal_1', 			participantId: participant.id, 			userId: participant.userId, 			teamId: participant.teamId, 			status: 'voting', 			title: 'Create a Commons governance lane', 			summary: 'Use a bounded proposal and decision process.', 			body: 'Members can ask, propose, back, vote, and steward decisions.', 			scope: 'treeseed_commons', 			decisionType: 'advisory', 			contentProposalSlug: null, 			contentDecisionSlug: null, 			backingCount: 3, 			voteSupportWeight: 5, 			voteObjectWeight: 1, 			voteAbstainWeight: 0, 			qualifiedAt: participant.createdAt, 			votingStartsAt: participant.createdAt, 			votingEndsAt: null, 			stewardDecisionAt: null, 			stewardDecisionBy: null,
			metadata: {},
			createdAt: participant.createdAt, 			updatedAt: participant.updatedAt,
		} satisfies CommonsProposal;
		const vote = {
			id: 'commons_vote_1', 			proposalId: proposal.id, 			participantId: participant.id, 			userId: participant.userId, 			vote: 'support', 			weightSnapshotId: 'commons_weight_1', 			weight: 2, 			reason: 'This matches the cooperative governance and ownership model.', 			createdAt: participant.createdAt, 			updatedAt: participant.updatedAt,
		} satisfies CommonsProposalVote;
		const decision = {
			id: 'commons_decision_1', 			proposalId: proposal.id, 			status: 'accepted', 			decisionRecordId: null, 			decisionRecordSlug: null, 			title: proposal.title, 			summary: proposal.summary, 			stewardReason: 'Accepted within a bounded capacity allocation.', 			capacityBudget: 'commons', 			scheduledFor: null, 			implementedAt: null,
			metadata: {},
			createdAt: participant.createdAt, 			updatedAt: participant.updatedAt,
		} satisfies CommonsDecision;
		const event = {
			id: 'commons_event_1', 			eventType: 'proposal.steward_decision', 			actorType: 'user', 			actorId: participant.userId, 			participantId: participant.id, 			proposalId: proposal.id, 			questionId: question.id, 			decisionId: decision.id, 			priorState: 'voting', 			nextState: 'accepted', 			message: 'Accepted by steward review.',
			evidence: { proposalId: proposal.id },
			createdAt: participant.createdAt,
		} satisfies CommonsGovernanceEvent;
		expect([participant, question, proposal, vote, decision, event].map((entry) => entry.id)).toHaveLength(6);
	});

	it('defines Stripe Connect readiness vocabulary without payment behavior', () => {
		expect(COMMERCE_STRIPE_ACCOUNT_STATUSES).toEqual([
			'not_started', 			'pending', 			'restricted', 			'enabled', 			'disabled',
		]);
		expect(COMMERCE_STRIPE_ONBOARDING_STATUSES).toEqual([
			'not_started', 			'started', 			'returned', 			'completed', 			'expired',
		]);
		expect(COMMERCE_STRIPE_ENVIRONMENTS).toEqual(['test', 'live']);
		expect(COMMERCE_STRIPE_SYNC_STATUSES).toEqual([
			'not_synced', 			'pending', 			'synced', 			'blocked', 			'drifted', 			'failed',
		]);
	});

	it('defines Phase 5 checkout, order, subscription, and webhook vocabulary', () => {
		expect(COMMERCE_CART_STATUSES).toEqual(['active', 'checkout_pending', 'converted', 'abandoned']);
		expect(COMMERCE_CHECKOUT_STATUSES).toEqual([
			'draft', 			'requires_confirmation', 			'processing', 			'partially_confirmed', 			'confirmed', 			'completed', 			'canceled', 			'failed',
		]);
		expect(COMMERCE_ORDER_STATUSES).toEqual([
			'draft', 			'pending_payment', 			'requires_action', 			'processing', 			'paid', 			'partially_refunded', 			'refunded', 			'canceled', 			'failed',
		]);
		expect(COMMERCE_ORDER_ITEM_STATUSES).toEqual(['pending', 'paid', 'fulfilled', 'refunded', 'revoked', 'canceled']);
		expect(COMMERCE_SUBSCRIPTION_STATUSES).toEqual(['incomplete', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused']);
		expect(COMMERCE_PAYMENT_GROUP_STATUSES).toEqual(['pending', 'requires_confirmation', 'requires_action', 'processing', 'succeeded', 'failed', 'canceled']);
		expect(COMMERCE_WEBHOOK_EVENT_STATUSES).toEqual(['received', 'processing', 'processed', 'ignored', 'failed']);
	});

	it('defines Phase 6 refund and fulfillment vocabulary', () => {
		expect(COMMERCE_REFUND_STATUSES).toEqual(['processing', 'succeeded', 'failed', 'canceled']);
		expect(COMMERCE_FULFILLMENT_STATUSES).toEqual(['pending', 'ready', 'delivered', 'failed', 'revoked']);
		expect(COMMERCE_FULFILLMENT_EVENT_TYPES).toEqual(['artifact_released', 'artifact_delivered', 'manual_status', 'revoked']);
	});

	it('defines Phase 7 cooperative governance workflow vocabulary', () => {
		expect(COMMERCE_OWNERSHIP_TRANSFER_STATUSES).toEqual(['draft', 'submitted', 'approved', 'rejected', 'canceled', 'superseded']);
		expect(COMMERCE_SUCCESSION_EVENT_TYPES).toEqual([
			'successor_named', 			'successor_accepted', 			'succession_triggered', 			'succession_completed', 			'succession_canceled',
		]);
		expect(COMMERCE_GOVERNANCE_DECISION_TYPES).toEqual([
			'ownership_record', 			'stewardship_assignment', 			'contribution', 			'governance_policy', 			'ownership_transfer', 			'succession',
		]);
	});

	it('defines Phase 8 scoped service workflow vocabulary', () => {
		expect(COMMERCE_SERVICE_REQUEST_STATUSES).toEqual([
			'requested', 			'scoping', 			'quoted', 			'buyer_approved', 			'vendor_approved', 			'checkout_pending', 			'active', 			'fulfilled', 			'declined', 			'canceled', 			'expired',
		]);
		expect(COMMERCE_SERVICE_QUOTE_STATUSES).toEqual([
			'draft', 			'submitted', 			'buyer_approved', 			'vendor_approved', 			'accepted', 			'rejected', 			'expired', 			'superseded', 			'canceled',
		]);
		expect(COMMERCE_SERVICE_CONTRACT_STATUSES).toEqual(['pending_checkout', 'active', 'fulfilled', 'canceled', 'disputed']);
		expect(COMMERCE_SERVICE_EVENT_TYPES).toEqual([
			'requested', 			'scoping_started', 			'scope_updated', 			'quote_created', 			'quote_submitted', 			'quote_buyer_approved', 			'quote_vendor_approved', 			'quote_rejected', 			'quote_expired', 			'checkout_created', 			'contract_activated', 			'work_linked', 			'manual_update', 			'fulfilled', 			'declined', 			'canceled',
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

	it('typechecks representative commerce contract records', () => {
		const product = {
			id: 'product_1', 			vendorId: 'vendor_1', 			sellerTeamId: 'team_seller', 			kind: 'template', 			slug: 'cooperative-starter', 			title: 'Cooperative Starter', 			summary: 'A governed starter product.', 			description: 'A starter product shaped around cooperative governance.', 			status: 'draft', 			visibility: 'public', 			catalogItemId: null, 			currentVersionId: null, 			ownershipModel: 'cooperative_owned', 			ownershipRecordId: 'ownership_1', 			supportPolicy: 'community', 			license: 'AGPL-3.0-only',
			metadata: {},
			createdAt: '2026-06-14T00:00:00.000Z', 			updatedAt: '2026-06-14T00:00:00.000Z',
		} satisfies CommerceProduct;

		const ownership = {
			id: 'ownership_1', 			productId: product.id, 			model: 'cooperative_owned', 			canonicalOwnerType: 'cooperative', 			canonicalOwnerId: 'coop_1', 			sellerTeamId: product.sellerTeamId, 			stewardTeamId: product.sellerTeamId, 			governancePolicyId: 'policy_1', 			publicSummary: 'Maintained by a cooperative steward team.', 			buyerVisible: true, 			effectiveAt: '2026-06-14T00:00:00.000Z', 			supersededAt: null,
			metadata: {},
			createdAt: '2026-06-14T00:00:00.000Z', 			updatedAt: '2026-06-14T00:00:00.000Z',
		} satisfies CommerceOwnershipRecord;

		const successionEvent = {
			id: 'succession_1', 			productId: product.id, 			ownershipRecordId: ownership.id, 			stewardshipAssignmentId: null, 			successorType: 'team', 			successorId: 'team_successor', 			eventType: 'successor_named', 			status: 'submitted', 			reason: 'Named a successor steward.',
			evidence: {},
			effectiveAt: null, 			createdByType: 'user', 			createdById: 'user_1',
			metadata: {},
			createdAt: '2026-06-14T00:00:00.000Z',
		} satisfies CommerceSuccessionEvent;

		const workflow = {
			productId: product.id, 			currentOwnershipRecord: ownership,
			buyerVisibleOwnershipRecords: [ownership],
			stewardshipAssignments: [],
			contributions: [],
			governancePolicies: [],
			pendingTransfers: [],
			successionEvents: [successionEvent],
		} satisfies CommerceOwnershipWorkflowSummary;

		const offer = {
			id: 'offer_1', 			productId: product.id, 			productVersionId: null, 			vendorId: product.vendorId, 			sellerTeamId: product.sellerTeamId, 			mode: 'subscription', 			status: 'draft', 			title: 'Cooperative Starter Updates', 			termsSummary: 'Active subscribers receive updates while subscribed.',
			accessScope: {},
			supportScope: {},
			fulfillmentMode: 'automatic', 			activePriceId: null, 			stripeProductId: null, 			stripeProductStatus: 'not_synced', 			stripeProductSyncedAt: null, 			stripeProductSyncError: null,
			stripeProductMetadata: {},
			startsAt: null, 			endsAt: null,
			metadata: {},
			createdAt: '2026-06-14T00:00:00.000Z', 			updatedAt: '2026-06-14T00:00:00.000Z',
		} satisfies CommerceOffer;

		const price = {
			id: 'price_1', 			offerId: offer.id, 			amount: 2900, 			currency: 'usd', 			billingInterval: 'month', 			status: 'active', 			stripeProductId: 'prod_tree', 			stripePriceId: 'price_tree', 			stripeLookupKey: 'treeseed_test_price_1_v1', 			stripeSyncStatus: 'synced', 			stripeSyncedAt: '2026-06-14T00:00:00.000Z', 			stripeSyncError: null,
			stripeMetadata: {
				treeseed_ownership_model: product.ownershipModel,
			},
			priceVersion: 1, 			taxBehavior: 'unspecified',
			metadata: {},
			createdAt: '2026-06-14T00:00:00.000Z', 			updatedAt: '2026-06-14T00:00:00.000Z',
		} satisfies CommercePrice;

		const entitlement = {
			id: 'entitlement_1', 			buyerTeamId: 'team_buyer', 			buyerUserId: null, 			sellerTeamId: product.sellerTeamId, 			productId: product.id, 			productVersionId: null, 			offerId: offer.id, 			orderId: 'order_1', 			orderItemId: 'order_item_1', 			subscriptionId: 'subscription_1', 			status: 'active',
			accessScope: {},
			startsAt: '2026-06-14T00:00:00.000Z', 			endsAt: null, 			renewalState: 'active',
			fulfillmentArtifactRefs: [],
			projectId: null, 			catalogItemId: null,
			ownershipSnapshot: {
				ownershipModel: product.ownershipModel,
			},
			metadata: {},
			createdAt: '2026-06-14T00:00:00.000Z', 			updatedAt: '2026-06-14T00:00:00.000Z',
		} satisfies CommerceEntitlement;

		const checkout = {
			id: 'checkout_1', 			cartId: 'cart_1', 			buyerTeamId: 'team_buyer', 			buyerUserId: null, 			status: 'requires_confirmation', 			checkoutMode: 'stripe_elements_grouped_vendor', 			groupCount: 1, 			completedGroupCount: 0,
			metadata: {},
			createdAt: '2026-06-14T00:00:00.000Z', 			updatedAt: '2026-06-14T00:00:00.000Z',
		} satisfies CommerceCheckout;

		const paymentGroup = {
			id: 'payment_group_1', 			checkoutId: checkout.id, 			orderId: 'order_1', 			vendorId: product.vendorId, 			sellerTeamId: product.sellerTeamId, 			connectedAccountId: 'acct_test', 			groupKind: 'subscription', 			billingInterval: 'month', 			status: 'requires_confirmation', 			currency: 'usd', 			subtotalAmount: 2900, 			totalAmount: 2900, 			stripePaymentIntentId: null, 			stripeSubscriptionId: 'sub_test', 			stripeCustomerId: 'cus_test', 			clientSecret: null,
			metadata: {},
			createdAt: '2026-06-14T00:00:00.000Z', 			updatedAt: '2026-06-14T00:00:00.000Z',
		} satisfies CommercePaymentGroup;

		const subscription = {
			id: 'subscription_1', 			orderId: 'order_1', 			vendorId: product.vendorId, 			sellerTeamId: product.sellerTeamId, 			buyerTeamId: 'team_buyer', 			buyerUserId: null, 			offerId: offer.id, 			priceId: price.id, 			status: 'active', 			renewalState: 'active', 			stripeSubscriptionId: 'sub_test', 			stripeCustomerId: 'cus_test', 			stripeConnectedAccountId: 'acct_test', 			currentPeriodStart: '2026-06-14T00:00:00.000Z', 			currentPeriodEnd: null, 			cancelAtPeriodEnd: false, 			canceledAt: null,
			metadata: {},
			createdAt: '2026-06-14T00:00:00.000Z', 			updatedAt: '2026-06-14T00:00:00.000Z',
		} satisfies CommerceSubscription;

		const refund = {
			id: 'refund_1', 			orderId: 'order_1', 			orderItemId: 'order_item_1', 			paymentGroupId: paymentGroup.id, 			vendorId: product.vendorId, 			sellerTeamId: product.sellerTeamId, 			buyerTeamId: 'team_buyer', 			buyerUserId: null, 			amount: 2900, 			currency: 'usd', 			status: 'succeeded', 			reason: 'vendor requested', 			stripeRefundId: 're_test', 			stripePaymentIntentId: 'pi_test', 			stripeConnectedAccountId: 'acct_test', 			idempotencyKey: 'refund-key', 			requestedByType: 'user', 			requestedById: 'user_1', 			failureReason: null,
			metadata: {},
			createdAt: '2026-06-14T00:00:00.000Z', 			updatedAt: '2026-06-14T00:00:00.000Z',
		} satisfies CommerceRefund;

		const fulfillmentEvent = {
			id: 'fulfillment_1', 			orderId: 'order_1', 			orderItemId: 'order_item_1', 			entitlementId: entitlement.id, 			vendorId: product.vendorId, 			sellerTeamId: product.sellerTeamId, 			productId: product.id, 			productVersionId: null, 			catalogItemId: null, 			catalogArtifactVersionId: null, 			eventType: 'artifact_delivered', 			status: 'delivered',
			artifactRefs: [{ version: '1.0.0' }],
			deliveryRefs: [{ path: '/v1/catalog/item/artifacts/1.0.0/download' }],
			message: 'Delivered.', 			actorType: 'user', 			actorId: 'user_1',
			metadata: {},
			createdAt: '2026-06-14T00:00:00.000Z',
		} satisfies CommerceFulfillmentEvent;

		const serviceRequest = {
			id: 'service_request_1', 			buyerTeamId: 'team_buyer', 			buyerUserId: 'user_buyer', 			vendorId: product.vendorId, 			sellerTeamId: product.sellerTeamId, 			productId: product.id, 			offerId: 'offer_service', 			status: 'requested', 			requestedScope: 'Implement a governed scoped service.', 			approvedScope: null,
			accessNeeds: {},
			buyerVisibleSummary: null, 			vendorPrivateNotes: null, 			activeQuoteId: null, 			approvedQuoteId: null, 			contractId: null, 			relatedProjectId: null, 			relatedWorkdayId: null, 			orderId: null, 			entitlementId: null,
			ownershipSnapshot: {},
			metadata: {},
			createdAt: '2026-06-14T00:00:00.000Z', 			updatedAt: '2026-06-14T00:00:00.000Z',
		} satisfies CommerceServiceRequest;

		const serviceQuote = {
			id: 'service_quote_1', 			requestId: serviceRequest.id, 			vendorId: serviceRequest.vendorId, 			sellerTeamId: serviceRequest.sellerTeamId, 			buyerTeamId: serviceRequest.buyerTeamId, 			buyerUserId: serviceRequest.buyerUserId, 			quoteVersion: 1, 			status: 'submitted', 			title: 'Scoped quote', 			scopeSummary: 'Scoped quote summary.',
			deliverables: [],
			assumptions: [],
			accessRequirements: {},
			governanceRequirements: {},
			amount: 1000, 			currency: 'usd', 			expiresAt: null, 			buyerApprovedAt: null, 			vendorApprovedAt: null, 			acceptedAt: null, 			rejectedAt: null,
			metadata: {},
			createdAt: '2026-06-14T00:00:00.000Z', 			updatedAt: '2026-06-14T00:00:00.000Z',
		} satisfies CommerceServiceQuote;

		const serviceContract = {
			id: 'service_contract_1', 			requestId: serviceRequest.id, 			quoteId: serviceQuote.id, 			vendorId: serviceRequest.vendorId, 			sellerTeamId: serviceRequest.sellerTeamId, 			buyerTeamId: serviceRequest.buyerTeamId, 			buyerUserId: serviceRequest.buyerUserId, 			productId: product.id, 			offerId: serviceRequest.offerId, 			status: 'pending_checkout', 			amount: serviceQuote.amount, 			currency: serviceQuote.currency, 			orderId: null, 			orderItemId: null, 			paymentGroupId: null, 			entitlementId: null, 			relatedProjectId: null, 			relatedWorkdayId: null,
			ownershipSnapshot: {},
			accessApprovalSnapshot: {},
			fulfillmentSummary: null,
			metadata: {},
			createdAt: '2026-06-14T00:00:00.000Z', 			updatedAt: '2026-06-14T00:00:00.000Z',
		} satisfies CommerceServiceContract;

		const serviceEvent = {
			id: 'service_event_1', 			requestId: serviceRequest.id, 			quoteId: serviceQuote.id, 			contractId: serviceContract.id, 			eventType: 'quote_created', 			actorType: 'user', 			actorId: 'user_seller', 			priorState: null, 			nextState: 'submitted', 			message: null,
			evidence: {},
			createdAt: '2026-06-14T00:00:00.000Z',
		} satisfies CommerceServiceEvent;

		const capacityListing = {
			id: 'capacity_listing_1', 			productId: product.id, 			vendorId: product.vendorId, 			sellerTeamId: product.sellerTeamId, 			capacityProviderId: null, 			executionProviderId: null, 			status: 'approved', 			accessLevel: 'public_summary', 			runtimeIsolationLevel: 'external_only', 			humanInvolvementLevel: 'operator_assisted', 			aiInvolvementLevel: 'assistive', 			dataAccessLevel: 'buyer_provided', 			secretAccessLevel: 'buyer_managed',
			supportedServiceTypes: ['research_review'],
			supportedRegions: ['us'],
			runtimeRequirements: {},
			dataHandlingSummary: 'Buyer-provided data only.', 			buyerVisibleRiskSummary: 'Manual review before any access.',
			governanceRequirements: {},
			supportPolicy: 'Seller support policy.', 			availabilitySummary: 'Limited availability.',
			ownershipSnapshot: {},
			metadata: {},
			createdAt: '2026-06-14T00:00:00.000Z', 			updatedAt: '2026-06-14T00:00:00.000Z',
		} satisfies CommerceCapacityListing;

		const capacityInquiry = {
			id: 'capacity_inquiry_1', 			listingId: capacityListing.id, 			productId: product.id, 			vendorId: product.vendorId, 			sellerTeamId: product.sellerTeamId, 			buyerTeamId: 'team_buyer', 			buyerUserId: null, 			status: 'requested', 			requestedServiceType: 'research_review', 			requestedScope: 'Evaluate a capacity engagement.',
			dataAccessRequested: {},
			secretAccessRequested: {},
			relatedProjectId: null, 			relatedWorkdayId: null,
			governanceEvidence: {},
			metadata: {},
			createdAt: '2026-06-14T00:00:00.000Z', 			updatedAt: '2026-06-14T00:00:00.000Z',
		} satisfies CommerceCapacityListingInquiry;

		const salesSummary = {
			vendorId: product.vendorId, 			sellerTeamId: product.sellerTeamId, 			currency: 'usd', 			grossPaidAmount: 2900, 			refundedAmount: 2900, 			netPaidAmount: 0, 			paidOrderCount: 1, 			refundedOrderCount: 1, 			activeSubscriptionCount: 1, 			activeEntitlementCount: 1, 			pendingFulfillmentCount: 0,
		} satisfies CommerceVendorSalesSummary;

		const marketplace = {
			products: [{
				id: product.id, 				kind: product.kind, 				title: product.title, 				slug: product.slug, 				summary: product.summary, 				status: 'approved', 				vendorId: product.vendorId, 				sellerTeamId: product.sellerTeamId, 				vendorDisplayName: 'Cooperative Seller', 				ownershipModel: product.ownershipModel, 				buyerVisibleOwnershipSummary: ownership.publicSummary,
				stewardshipSummary: [{ role: 'governance_steward', displayName: 'Seller team' }],
				offers: [{
					id: offer.id, 					mode: offer.mode, 					title: offer.title, 					status: offer.status, 					priceId: price.id, 					unitAmount: price.amount, 					currency: price.currency, 					billingInterval: price.billingInterval, 					checkoutEligible: true, 					serviceEligible: false, 					capacityInquiryEligible: false, 					stripeSyncStatus: price.stripeSyncStatus,
				}],
				capacityListingId: capacityListing.id, 				serviceRequestEligible: false, 				checkoutEligible: true, 				updatedAt: product.updatedAt,
			}],
		} satisfies CommerceMarketplaceCatalogResponse;

		const refreshResponse = {
			paymentGroup, 			clientSecret: 'pi_test_secret_once',
		} satisfies CommercePaymentGroupRefreshResponse;

		const monitor = {
			vendorId: product.vendorId, 			sellerTeamId: product.sellerTeamId, 			stripeReady: true, 			blockedStripeSyncCount: 0, 			driftedStripeSyncCount: 0, 			pendingFulfillmentCount: 0, 			failedRefundCount: 0, 			failedWebhookCount: 0, 			pendingServiceRequestCount: 0, 			pendingCapacityInquiryCount: 0, 			pendingGovernanceTransferCount: 0,
			recentGovernanceEvents: [],
			updatedAt: '2026-06-14T00:00:00.000Z',
		} satisfies CommerceCommerceMonitor;

		const webhookEvent = {
			id: 'webhook_1', 			provider: 'stripe', 			environment: 'test', 			eventId: 'evt_test', 			eventType: 'customer.subscription.updated', 			connectedAccountId: 'acct_test', 			status: 'processed', 			objectType: 'subscription', 			objectId: 'sub_test', 			relatedOrderId: 'order_1', 			relatedSubscriptionId: subscription.id, 			payloadHash: 'hash', 			processingError: null, 			receivedAt: '2026-06-14T00:00:00.000Z', 			processedAt: '2026-06-14T00:00:00.000Z', 			createdAt: '2026-06-14T00:00:00.000Z', 			updatedAt: '2026-06-14T00:00:00.000Z',
		} satisfies CommerceWebhookEvent;

		const connectedAccount = {
			id: 'stripe_account_1', 			vendorId: product.vendorId, 			teamId: product.sellerTeamId, 			environment: 'test', 			stripeAccountId: 'acct_test', 			accountStatus: 'pending', 			onboardingStatus: 'started', 			chargesEnabled: false, 			payoutsEnabled: false, 			detailsSubmitted: false,
			requirementsCurrentlyDue: [],
			requirementsEventuallyDue: [],
			requirementsPastDue: [],
			requirementsDisabledReason: null,
			capabilities: {},
			onboardingStartedAt: '2026-06-14T00:00:00.000Z', 			onboardingCompletedAt: null, 			lastSyncedAt: null,
			metadata: {},
			createdAt: '2026-06-14T00:00:00.000Z', 			updatedAt: '2026-06-14T00:00:00.000Z',
		} satisfies StripeConnectedAccount;

		expect({ product, ownership, workflow, offer, price, entitlement, checkout, paymentGroup, subscription, refund, fulfillmentEvent, serviceRequest, serviceQuote, serviceContract, serviceEvent, capacityListing, capacityInquiry, salesSummary, marketplace, refreshResponse, monitor, webhookEvent, connectedAccount }).toBeTruthy();
	});

	it('documents Stripe registry setup for local and hosted ecommerce access', () => {
		const envYaml = readFileSync(new URL('../../../src/platform/env.yaml', import.meta.url), 'utf8');
		for (const key of [
			'TREESEED_STRIPE_SECRET_KEY', 			'TREESEED_STRIPE_PUBLISHABLE_KEY', 			'TREESEED_STRIPE_WEBHOOK_SECRET', 			'TREESEED_STRIPE_MODE', 			'TREESEED_STRIPE_CONNECT_ACCOUNT_TYPE',
		]) {
			expect(envYaml).toContain(`${key}:`);
		}
		expect(envYaml).toContain('local-runtime');
		expect(envYaml).toContain('npx trsd config set TREESEED_STRIPE_SECRET_KEY');
		expect(envYaml).toContain('npx trsd config set TREESEED_STRIPE_PUBLISHABLE_KEY');
		expect(envYaml).toContain('npx trsd config set TREESEED_STRIPE_WEBHOOK_SECRET');
		expect(envYaml).toContain('payment_intent.succeeded');
		expect(envYaml).toContain('customer.subscription.updated');
		expect(envYaml).toContain('invoice.payment_failed');
		expect(envYaml).toContain('vendors never provide raw Stripe secret keys');
	});
});
