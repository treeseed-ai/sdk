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
import { CommerceFulfillmentEventType, CommerceFulfillmentStatus, CommerceServiceContractStatus, CommerceServiceEventType } from './commerce-subscription-statuses.ts';
import { CommonsDecisionStatus, CommonsGovernanceEventType, CommonsParticipantStatus, CommonsProposalStatus, CommonsQuestionStatus, CommonsVoteValue } from './commerce-governance-states.ts';

export interface CommerceServiceContract {
	id: string;
	requestId: string;
	quoteId: string;
	vendorId: string;
	sellerTeamId: string;
	buyerTeamId: string | null;
	buyerUserId: string | null;
	productId: string;
	offerId: string;
	status: CommerceServiceContractStatus;
	amount: number;
	currency: string;
	orderId: string | null;
	orderItemId: string | null;
	paymentGroupId: string | null;
	entitlementId: string | null;
	relatedProjectId: string | null;
	relatedWorkdayId: string | null;
	ownershipSnapshot?: Record<string, unknown>;
	accessApprovalSnapshot?: Record<string, unknown>;
	fulfillmentSummary: string | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CommerceServiceEvent {
	id: string;
	requestId: string;
	quoteId: string | null;
	contractId: string | null;
	eventType: CommerceServiceEventType;
	actorType: string;
	actorId: string | null;
	priorState: string | null;
	nextState: string | null;
	message: string | null;
	evidence?: Record<string, unknown>;
	createdAt: string;
}

export interface CommerceServiceRequestInput {
	buyerTeamId?: string | null;
	offerId: string;
	requestedScope: string;
	accessNeeds?: Record<string, unknown>;
	relatedProjectId?: string | null;
	relatedWorkdayId?: string | null;
	metadata?: Record<string, unknown>;
}

export interface CommerceServiceQuoteInput {
	title: string;
	scopeSummary: string;
	deliverables?: Record<string, unknown>[];
	assumptions?: Record<string, unknown>[];
	accessRequirements?: Record<string, unknown>;
	governanceRequirements?: Record<string, unknown>;
	amount: number;
	currency: string;
	expiresAt?: string | null;
	metadata?: Record<string, unknown>;
}

export interface CommerceServiceDecisionInput {
	reason?: string | null;
	evidence?: Record<string, unknown>;
}

export interface CommerceServiceFulfillmentInput {
	summary?: string | null;
	artifactRefs?: Record<string, unknown>[];
	deliveryRefs?: Record<string, unknown>[];
	metadata?: Record<string, unknown>;
}

export interface CommerceFulfillmentEvent {
	id: string;
	orderId: string;
	orderItemId: string | null;
	entitlementId: string | null;
	vendorId: string;
	sellerTeamId: string;
	productId: string;
	productVersionId: string | null;
	catalogItemId: string | null;
	catalogArtifactVersionId: string | null;
	eventType: CommerceFulfillmentEventType;
	status: CommerceFulfillmentStatus;
	artifactRefs: Record<string, unknown>[];
	deliveryRefs: Record<string, unknown>[];
	message: string | null;
	actorType: string;
	actorId: string;
	metadata?: Record<string, unknown>;
	createdAt: string;
}

export interface CommerceGovernanceEvent {
	id: string;
	actorType: 'system' | 'user' | 'team' | 'operator';
	actorId: string | null;
	action: string;
	objectType: string;
	objectId: string;
	priorState: string | null;
	nextState: string | null;
	reason: string | null;
	evidence: Record<string, unknown>;
	relatedOrderId: string | null;
	relatedOfferId: string | null;
	relatedProductId: string | null;
	relatedTeamId: string | null;
	createdAt: string;
}

export interface CommonsParticipant {
	id: string;
	userId: string;
	teamId: string;
	status: CommonsParticipantStatus;
	displayName: string | null;
	verifiedEmail: boolean;
	baseWeight: number;
	trustWeight: number;
	contributionWeight: number;
	stakeholderWeight: number;
	delegatedWeight: number;
	totalWeight: number;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CommonsQuestion {
	id: string;
	participantId: string;
	userId: string;
	teamId: string;
	status: CommonsQuestionStatus;
	title: string;
	body: string;
	answer: string | null;
	convertedProposalId: string | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CommonsProposal {
	id: string;
	participantId: string;
	userId: string;
	teamId: string;
	status: CommonsProposalStatus;
	title: string;
	summary: string;
	body: string;
	scope: string;
	decisionType: string;
	contentProposalSlug: string | null;
	contentDecisionSlug: string | null;
	backingCount: number;
	voteSupportWeight: number;
	voteObjectWeight: number;
	voteAbstainWeight: number;
	qualifiedAt: string | null;
	votingStartsAt: string | null;
	votingEndsAt: string | null;
	stewardDecisionAt: string | null;
	stewardDecisionBy: string | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CommonsProposalBacking {
	id: string;
	proposalId: string;
	participantId: string;
	userId: string;
	weightSnapshotId: string;
	weight: number;
	reason: string | null;
	createdAt: string;
}

export interface CommonsProposalVote {
	id: string;
	proposalId: string;
	participantId: string;
	userId: string;
	vote: CommonsVoteValue;
	weightSnapshotId: string;
	weight: number;
	reason: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface CommonsDelegation {
	id: string;
	fromParticipantId: string;
	toParticipantId: string;
	scope: string;
	status: 'active' | 'revoked';
	weightLimit: number | null;
	reason: string | null;
	createdAt: string;
	revokedAt: string | null;
}

export interface CommonsWeightSnapshot {
	id: string;
	participantId: string;
	policyVersion: string;
	baseWeight: number;
	verifiedEmailWeight: number;
	accountAgeWeight: number;
	contributionWeight: number;
	stakeholderWeight: number;
	trustRoleWeight: number;
	delegatedWeight: number;
	totalWeight: number;
	evidence?: Record<string, unknown>;
	createdAt: string;
}

export interface CommonsDecision {
	id: string;
	proposalId: string;
	status: CommonsDecisionStatus;
	decisionRecordId: string | null;
	decisionRecordSlug: string | null;
	title: string;
	summary: string;
	stewardReason: string | null;
	capacityBudget: string | null;
	scheduledFor: string | null;
	implementedAt: string | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CommonsGovernanceEvent {
	id: string;
	eventType: CommonsGovernanceEventType;
	actorType: string;
	actorId: string | null;
	participantId: string | null;
	proposalId: string | null;
	questionId: string | null;
	decisionId: string | null;
	priorState: string | null;
	nextState: string | null;
	message: string | null;
	evidence?: Record<string, unknown>;
	createdAt: string;
}
