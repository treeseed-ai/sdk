import type { TreeseedFieldAliasBinding } from '../field-aliases.ts';
import type {
	CapacityBusinessModel,
	CapacityLaneUnit,
	CapacityReservation,
	NativeUsageObservation,
} from '../agent-capacity/contracts/financial-records.ts';
import type {
	CapacityExecutionProvider,
	CapacityExecutionProviderNativeLimit,
	CapacityExecutionProviderObservation,
	CapacityProviderMembershipView,
} from '../capacity-provider/contracts/index.ts';


export const COMMERCE_GOVERNANCE_STATES = [
	'draft',
	'submitted',
	'approved',
	'rejected',
	'suspended',
	'archived',
] as const;

export type CommerceGovernanceState = typeof COMMERCE_GOVERNANCE_STATES[number];

export const COMMERCE_ENTITLEMENT_STATUSES = [
	'pending',
	'active',
	'past_due',
	'expired',
	'revoked',
	'refunded',
	'canceled',
] as const;

export type CommerceEntitlementStatus = typeof COMMERCE_ENTITLEMENT_STATUSES[number];

export const COMMERCE_OWNERSHIP_MODELS = [
	'team_owned',
	'individual_contributor_owned',
	'multi_contributor_attributed',
	'steward_maintained',
	'cooperative_owned',
	'community_governed',
	'foundation_or_trust_held',
	'transferred_or_succeeded',
] as const;

export type CommerceOwnershipModel = typeof COMMERCE_OWNERSHIP_MODELS[number];

export const COMMERCE_STEWARDSHIP_ROLES = [
	'owner',
	'seller',
	'maintainer',
	'governance_steward',
	'support_steward',
	'security_steward',
	'community_steward',
	'successor',
] as const;

export type CommerceStewardshipRole = typeof COMMERCE_STEWARDSHIP_ROLES[number];

export const COMMERCE_OWNERSHIP_TRANSFER_STATUSES = [
	'draft',
	'submitted',
	'approved',
	'rejected',
	'canceled',
	'superseded',
] as const;

export type CommerceOwnershipTransferStatus = typeof COMMERCE_OWNERSHIP_TRANSFER_STATUSES[number];

export const COMMERCE_SUCCESSION_EVENT_TYPES = [
	'successor_named',
	'successor_accepted',
	'succession_triggered',
	'succession_completed',
	'succession_canceled',
] as const;

export type CommerceSuccessionEventType = typeof COMMERCE_SUCCESSION_EVENT_TYPES[number];

export const COMMERCE_GOVERNANCE_DECISION_TYPES = [
	'ownership_record',
	'stewardship_assignment',
	'contribution',
	'governance_policy',
	'ownership_transfer',
	'succession',
] as const;

export type CommerceGovernanceDecisionType = typeof COMMERCE_GOVERNANCE_DECISION_TYPES[number];

export const COMMONS_PARTICIPANT_STATUSES = [
	'active',
	'limited',
	'suspended',
	'archived',
] as const;

export type CommonsParticipantStatus = typeof COMMONS_PARTICIPANT_STATUSES[number];

export const COMMONS_PROPOSAL_STATUSES = [
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
] as const;

export type CommonsProposalStatus = typeof COMMONS_PROPOSAL_STATUSES[number];

export const COMMONS_QUESTION_STATUSES = [
	'open',
	'answered',
	'converted_to_proposal',
	'archived',
] as const;

export type CommonsQuestionStatus = typeof COMMONS_QUESTION_STATUSES[number];

export const COMMONS_VOTE_VALUES = [
	'support',
	'object',
	'abstain',
] as const;

export type CommonsVoteValue = typeof COMMONS_VOTE_VALUES[number];

export const COMMONS_DECISION_STATUSES = [
	'proposed',
	'accepted',
	'rejected',
	'scheduled',
	'implemented',
	'archived',
] as const;

export type CommonsDecisionStatus = typeof COMMONS_DECISION_STATUSES[number];

export const COMMONS_GOVERNANCE_EVENT_TYPES = [
	'participant.joined',
	'question.created',
	'question.answered',
	'question.converted_to_proposal',
	'proposal.created',
	'proposal.submitted',
	'proposal.backed',
	'proposal.qualified',
	'proposal.review_started',
	'proposal.voting_started',
	'proposal.voted',
	'proposal.steward_decision',
	'proposal.archived',
	'delegation.created',
	'delegation.revoked',
	'decision.created',
	'decision.updated',
] as const;

export type CommonsGovernanceEventType = typeof COMMONS_GOVERNANCE_EVENT_TYPES[number];

export const COMMERCE_STRIPE_ACCOUNT_STATUSES = [
	'not_started',
	'pending',
	'restricted',
	'enabled',
	'disabled',
] as const;

export type CommerceStripeAccountStatus = typeof COMMERCE_STRIPE_ACCOUNT_STATUSES[number];

export const COMMERCE_STRIPE_ONBOARDING_STATUSES = [
	'not_started',
	'started',
	'returned',
	'completed',
	'expired',
] as const;

export type CommerceStripeOnboardingStatus = typeof COMMERCE_STRIPE_ONBOARDING_STATUSES[number];

export const COMMERCE_STRIPE_ENVIRONMENTS = ['test', 'live'] as const;

export type CommerceStripeEnvironment = typeof COMMERCE_STRIPE_ENVIRONMENTS[number];

export const COMMERCE_STRIPE_SYNC_STATUSES = [
	'not_synced',
	'pending',
	'synced',
	'blocked',
	'drifted',
	'failed',
] as const;

export type CommerceStripeSyncStatus = typeof COMMERCE_STRIPE_SYNC_STATUSES[number];

export const COMMERCE_CART_STATUSES = [
	'active',
	'checkout_pending',
	'converted',
	'abandoned',
] as const;

export type CommerceCartStatus = typeof COMMERCE_CART_STATUSES[number];

export const COMMERCE_CHECKOUT_STATUSES = [
	'draft',
	'requires_confirmation',
	'processing',
	'partially_confirmed',
	'confirmed',
	'completed',
	'canceled',
	'failed',
] as const;

export type CommerceCheckoutStatus = typeof COMMERCE_CHECKOUT_STATUSES[number];

export const COMMERCE_ORDER_STATUSES = [
	'draft',
	'pending_payment',
	'requires_action',
	'processing',
	'paid',
	'partially_refunded',
	'refunded',
	'canceled',
	'failed',
] as const;

export type CommerceOrderStatus = typeof COMMERCE_ORDER_STATUSES[number];

export const COMMERCE_ORDER_ITEM_STATUSES = [
	'pending',
	'paid',
	'fulfilled',
	'refunded',
	'revoked',
	'canceled',
] as const;

export type CommerceOrderItemStatus = typeof COMMERCE_ORDER_ITEM_STATUSES[number];
