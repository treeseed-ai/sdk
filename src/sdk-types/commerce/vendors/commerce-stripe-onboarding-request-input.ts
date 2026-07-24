import type { FieldAliasBinding } from '../../../entrypoints/models/field-aliases.ts';
import type {
	CapacityBusinessModel,
	CapacityLaneUnit,
	CapacityReservation,
	NativeUsageObservation,
} from '../../../agent-capacity/contracts/support/financial-records.ts';
import type {
	CapacityExecutionProvider,
	CapacityExecutionProviderNativeLimit,
	CapacityExecutionProviderObservation,
	CapacityProviderMembershipView,
} from '../../../capacity-provider/contracts/index.ts';
import { CommerceCapacityAccessLevel, CommerceCapacityAiInvolvementLevel, CommerceCapacityDataAccessLevel, CommerceCapacityHumanInvolvementLevel, CommerceCapacityInquiryStatus, CommerceCapacityListingStatus, CommerceCapacityRuntimeIsolationLevel, CommerceCapacitySecretAccessLevel, StripeConnectedAccount } from '../payments/commerce-subscription-statuses.ts';
import { CommerceProductKind } from '../../support/template-launch-requirements.ts';
import { CommerceGovernanceState, CommerceOwnershipModel, CommerceOwnershipTransferStatus, CommerceStewardshipRole, CommerceSuccessionEventType } from '../governance/commerce-governance-states.ts';

export interface CommerceStripeOnboardingRequestInput {
	returnUrl?: string | null;
	refreshUrl?: string | null;
}

export interface CommerceStripeOnboardingResponse {
	account: StripeConnectedAccount;
	onboardingUrl: string;
}

export interface CommerceStripeLoginLinkResponse {
	account: StripeConnectedAccount;
	loginUrl: string;
}

export interface CommerceProduct {
	id: string;
	vendorId: string;
	sellerTeamId: string;
	kind: CommerceProductKind;
	slug: string;
	title: string;
	summary: string | null;
	description: string | null;
	status: CommerceGovernanceState;
	visibility: 'public' | 'authenticated' | 'team' | 'private';
	catalogItemId: string | null;
	currentVersionId: string | null;
	ownershipModel: CommerceOwnershipModel;
	ownershipRecordId: string | null;
	supportPolicy: string | null;
	license: string | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CommerceOwnershipRecord {
	id: string;
	productId: string;
	model: CommerceOwnershipModel;
	canonicalOwnerType: 'user' | 'team' | 'organization' | 'cooperative' | 'community' | 'foundation' | 'external';
	canonicalOwnerId: string | null;
	sellerTeamId: string;
	stewardTeamId: string | null;
	governancePolicyId: string | null;
	publicSummary: string | null;
	buyerVisible: boolean;
	effectiveAt: string;
	supersededAt: string | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CommerceStewardshipAssignment {
	id: string;
	ownershipRecordId: string;
	productId: string;
	role: CommerceStewardshipRole;
	assigneeType: 'user' | 'team' | 'organization' | 'community' | 'external';
	assigneeId: string | null;
	displayName: string | null;
	responsibilities: string[];
	visibleToBuyers: boolean;
	startsAt: string;
	endsAt: string | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CommerceContribution {
	id: string;
	productId: string;
	productVersionId: string | null;
	contributorType: 'user' | 'team' | 'organization' | 'external';
	contributorId: string | null;
	displayName: string | null;
	role: string;
	summary: string | null;
	attributionVisibility: 'public' | 'buyer' | 'vendor' | 'private';
	agreementRef: string | null;
	benefitWeight: number | null;
	effectiveAt: string;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CommerceGovernancePolicy {
	id: string;
	productId: string | null;
	teamId: string | null;
	policyKind: 'product' | 'vendor' | 'cooperative' | 'community';
	title: string;
	approvalRules: Record<string, unknown>;
	quorumRules: Record<string, unknown>;
	buyerVisibleSummary: string | null;
	status: 'draft' | 'active' | 'superseded' | 'archived';
	createdAt: string;
	updatedAt: string;
}

export interface CommerceOwnershipTransfer {
	id: string;
	productId: string;
	fromOwnershipRecordId: string;
	toOwnershipRecordId: string;
	status: CommerceOwnershipTransferStatus;
	reason: string;
	approvalEvidence: Record<string, unknown>;
	buyerVisibleImpact: string | null;
	effectiveAt: string;
	requestedByType: string;
	requestedById: string;
	approvedByType: string | null;
	approvedById: string | null;
	approvedAt: string | null;
	rejectedAt: string | null;
	supersededAt: string | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
}

export interface CommerceSuccessionEvent {
	id: string;
	productId: string;
	ownershipRecordId: string | null;
	stewardshipAssignmentId: string | null;
	successorType: string;
	successorId: string;
	eventType: CommerceSuccessionEventType;
	status: CommerceOwnershipTransferStatus;
	reason: string | null;
	evidence?: Record<string, unknown>;
	effectiveAt: string | null;
	createdByType: string;
	createdById: string;
	metadata?: Record<string, unknown>;
	createdAt: string;
}

export interface CommerceOwnershipWorkflowSummary {
	productId: string;
	currentOwnershipRecord: CommerceOwnershipRecord | null;
	buyerVisibleOwnershipRecords: CommerceOwnershipRecord[];
	stewardshipAssignments: CommerceStewardshipAssignment[];
	contributions: CommerceContribution[];
	governancePolicies: CommerceGovernancePolicy[];
	pendingTransfers: CommerceOwnershipTransfer[];
	successionEvents: CommerceSuccessionEvent[];
}

export interface CommerceOwnershipRecordUpdateInput {
	publicSummary?: string | null;
	buyerVisible?: boolean;
	metadata?: Record<string, unknown>;
}

export interface CommerceStewardshipAssignmentUpdateInput {
	displayName?: string | null;
	responsibilities?: Record<string, unknown>;
	visibleToBuyers?: boolean;
	endsAt?: string | null;
	metadata?: Record<string, unknown>;
}

export interface CommerceContributionUpdateInput {
	summary?: string | null;
	attributionVisibility?: string;
	benefitWeight?: number | null;
	metadata?: Record<string, unknown>;
}

export interface CommerceGovernancePolicyUpdateInput {
	title?: string;
	approvalRules?: Record<string, unknown>;
	quorumRules?: Record<string, unknown>;
	buyerVisibleSummary?: string | null;
	status?: CommerceGovernanceState;
}

export interface CommerceOwnershipTransferDecisionInput {
	reason?: string | null;
	evidence?: Record<string, unknown>;
}

export interface CommerceSuccessionEventInput {
	ownershipRecordId?: string | null;
	stewardshipAssignmentId?: string | null;
	successorType: string;
	successorId: string;
	eventType: CommerceSuccessionEventType;
	reason?: string | null;
	evidence?: Record<string, unknown>;
	effectiveAt?: string | null;
	metadata?: Record<string, unknown>;
}

export interface CommerceCapacityListing {
	id: string;
	productId: string;
	vendorId: string;
	sellerTeamId: string;
	capacityProviderId: string | null;
	executionProviderId: string | null;
	status: CommerceCapacityListingStatus;
	accessLevel: CommerceCapacityAccessLevel;
	runtimeIsolationLevel: CommerceCapacityRuntimeIsolationLevel;
	humanInvolvementLevel: CommerceCapacityHumanInvolvementLevel;
	aiInvolvementLevel: CommerceCapacityAiInvolvementLevel;
	dataAccessLevel: CommerceCapacityDataAccessLevel;
	secretAccessLevel: CommerceCapacitySecretAccessLevel;
	supportedServiceTypes: string[];
	supportedRegions: string[];
	runtimeRequirements: Record<string, unknown>;
	dataHandlingSummary: string | null;
	buyerVisibleRiskSummary: string | null;
	governanceRequirements: Record<string, unknown>;
	supportPolicy: string | null;
	availabilitySummary: string | null;
	ownershipSnapshot?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CommerceCapacityListingInquiry {
	id: string;
	listingId: string;
	productId: string;
	vendorId: string;
	sellerTeamId: string;
	buyerTeamId: string | null;
	buyerUserId: string | null;
	status: CommerceCapacityInquiryStatus;
	requestedServiceType: string | null;
	requestedScope: string;
	dataAccessRequested: Record<string, unknown>;
	secretAccessRequested: Record<string, unknown>;
	relatedProjectId: string | null;
	relatedWorkdayId: string | null;
	governanceEvidence?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}
