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
			'free',
			'private',
			'contact',
			'one_time',
			'one_time_current_version',
			'subscription',
			'subscription_updates',
			'professional_hosting',
			'scoped_contract',
			'external',
		]);
		expect(COMMERCE_OFFER_MODES).not.toContain('paid');
	});

it('defines cooperative governance and ownership vocabulary', () => {
		expect(COMMERCE_OWNERSHIP_MODELS).toEqual(expect.arrayContaining([
			'cooperative_owned',
			'community_governed',
			'transferred_or_succeeded',
		]));
		expect(COMMERCE_STEWARDSHIP_ROLES).toEqual(expect.arrayContaining([
			'owner',
			'seller',
			'governance_steward',
			'successor',
		]));
		expect(COMMERCE_VENDOR_TRUST_LEVELS).toEqual(expect.arrayContaining([
			'public_publisher',
			'verified_seller',
			'trusted_capacity_vendor',
		]));
	});

it('defines TreeSeed Commons governance vocabulary', () => {
		expect(COMMONS_PARTICIPANT_STATUSES).toEqual(['active', 'limited', 'suspended', 'archived']);
		expect(COMMONS_PROPOSAL_STATUSES).toEqual([
			'draft',
			'submitted',
			'backing',
			'qualified',
			'under_review',
			'voting',
			'accepted',
			'rejected',
			'deferred',
			'implemented',
			'archived',
		]);
		expect(COMMONS_QUESTION_STATUSES).toEqual(['open', 'answered', 'converted_to_proposal', 'archived']);
		expect(COMMONS_VOTE_VALUES).toEqual(['support', 'object', 'abstain']);
		expect(COMMONS_DECISION_STATUSES).toEqual(['proposed', 'accepted', 'rejected', 'scheduled', 'implemented', 'archived']);
		expect(COMMONS_GOVERNANCE_EVENT_TYPES).toEqual(expect.arrayContaining([
			'participant.joined',
			'proposal.backed',
			'proposal.voted',
			'proposal.steward_decision',
			'decision.created',
		]));
	});

it('typechecks representative TreeSeed Commons governance records', () => {
		const participant = {
			id: 'commons_participant_1',
			userId: 'user_1',
			teamId: 'treeseed',
			status: 'active',
			displayName: 'Ada Steward',
			verifiedEmail: true,
			baseWeight: 1,
			trustWeight: 0.5,
			contributionWeight: 0.5,
			stakeholderWeight: 0,
			delegatedWeight: 0,
			totalWeight: 2,
			metadata: {},
			createdAt: '2026-06-15T00:00:00.000Z',
			updatedAt: '2026-06-15T00:00:00.000Z',
		} satisfies CommonsParticipant;
		const question = {
			id: 'commons_question_1',
			participantId: participant.id,
			userId: participant.userId,
			teamId: participant.teamId,
			status: 'open',
			title: 'What should TreeSeed prioritize?',
			body: 'How should the cooperative roadmap be shaped?',
			answer: null,
			convertedProposalId: null,
			metadata: {},
			createdAt: participant.createdAt,
			updatedAt: participant.updatedAt,
		} satisfies CommonsQuestion;
		const proposal = {
			id: 'commons_proposal_1',
			participantId: participant.id,
			userId: participant.userId,
			teamId: participant.teamId,
			status: 'voting',
			title: 'Create a Commons governance lane',
			summary: 'Use a bounded proposal and decision process.',
			body: 'Members can ask, propose, back, vote, and steward decisions.',
			scope: 'treeseed_commons',
			decisionType: 'advisory',
			contentProposalSlug: null,
			contentDecisionSlug: null,
			backingCount: 3,
			voteSupportWeight: 5,
			voteObjectWeight: 1,
			voteAbstainWeight: 0,
			qualifiedAt: participant.createdAt,
			votingStartsAt: participant.createdAt,
			votingEndsAt: null,
			stewardDecisionAt: null,
			stewardDecisionBy: null,
			metadata: {},
			createdAt: participant.createdAt,
			updatedAt: participant.updatedAt,
		} satisfies CommonsProposal;
		const vote = {
			id: 'commons_vote_1',
			proposalId: proposal.id,
			participantId: participant.id,
			userId: participant.userId,
			vote: 'support',
			weightSnapshotId: 'commons_weight_1',
			weight: 2,
			reason: 'This matches the cooperative governance and ownership model.',
			createdAt: participant.createdAt,
			updatedAt: participant.updatedAt,
		} satisfies CommonsProposalVote;
		const decision = {
			id: 'commons_decision_1',
			proposalId: proposal.id,
			status: 'accepted',
			decisionRecordId: null,
			decisionRecordSlug: null,
			title: proposal.title,
			summary: proposal.summary,
			stewardReason: 'Accepted within a bounded capacity allocation.',
			capacityBudget: 'commons',
			scheduledFor: null,
			implementedAt: null,
			metadata: {},
			createdAt: participant.createdAt,
			updatedAt: participant.updatedAt,
		} satisfies CommonsDecision;
		const event = {
			id: 'commons_event_1',
			eventType: 'proposal.steward_decision',
			actorType: 'user',
			actorId: participant.userId,
			participantId: participant.id,
			proposalId: proposal.id,
			questionId: question.id,
			decisionId: decision.id,
			priorState: 'voting',
			nextState: 'accepted',
			message: 'Accepted by steward review.',
			evidence: { proposalId: proposal.id },
			createdAt: participant.createdAt,
		} satisfies CommonsGovernanceEvent;
		expect([participant, question, proposal, vote, decision, event].map((entry) => entry.id)).toHaveLength(6);
	});

it('defines Stripe Connect readiness vocabulary without payment behavior', () => {
		expect(COMMERCE_STRIPE_ACCOUNT_STATUSES).toEqual([
			'not_started',
			'pending',
			'restricted',
			'enabled',
			'disabled',
		]);
		expect(COMMERCE_STRIPE_ONBOARDING_STATUSES).toEqual([
			'not_started',
			'started',
			'returned',
			'completed',
			'expired',
		]);
		expect(COMMERCE_STRIPE_ENVIRONMENTS).toEqual(['test', 'live']);
		expect(COMMERCE_STRIPE_SYNC_STATUSES).toEqual([
			'not_synced',
			'pending',
			'synced',
			'blocked',
			'drifted',
			'failed',
		]);
	});

it('defines Phase 5 checkout, order, subscription, and webhook vocabulary', () => {
		expect(COMMERCE_CART_STATUSES).toEqual(['active', 'checkout_pending', 'converted', 'abandoned']);
		expect(COMMERCE_CHECKOUT_STATUSES).toEqual([
			'draft',
			'requires_confirmation',
			'processing',
			'partially_confirmed',
			'confirmed',
			'completed',
			'canceled',
			'failed',
		]);
		expect(COMMERCE_ORDER_STATUSES).toEqual([
			'draft',
			'pending_payment',
			'requires_action',
			'processing',
			'paid',
			'partially_refunded',
			'refunded',
			'canceled',
			'failed',
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
});
