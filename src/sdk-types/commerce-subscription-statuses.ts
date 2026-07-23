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
import { CommerceGovernanceState, CommerceStripeAccountStatus, CommerceStripeEnvironment, CommerceStripeOnboardingStatus } from './commerce-governance-states.ts';
import { CommerceVendorTrustLevel } from './template-launch-requirements.ts';

export const COMMERCE_SUBSCRIPTION_STATUSES = [
	'incomplete',
	'trialing',
	'active',
	'past_due',
	'canceled',
	'unpaid',
	'paused',
] as const;

export type CommerceSubscriptionStatus = typeof COMMERCE_SUBSCRIPTION_STATUSES[number];

export const COMMERCE_PAYMENT_GROUP_STATUSES = [
	'pending',
	'requires_confirmation',
	'requires_action',
	'processing',
	'succeeded',
	'failed',
	'canceled',
] as const;

export type CommercePaymentGroupStatus = typeof COMMERCE_PAYMENT_GROUP_STATUSES[number];

export const COMMERCE_WEBHOOK_EVENT_STATUSES = [
	'received',
	'processing',
	'processed',
	'ignored',
	'failed',
] as const;

export type CommerceWebhookEventStatus = typeof COMMERCE_WEBHOOK_EVENT_STATUSES[number];

export const COMMERCE_REFUND_STATUSES = [
	'processing',
	'succeeded',
	'failed',
	'canceled',
] as const;

export type CommerceRefundStatus = typeof COMMERCE_REFUND_STATUSES[number];

export const COMMERCE_FULFILLMENT_STATUSES = [
	'pending',
	'ready',
	'delivered',
	'failed',
	'revoked',
] as const;

export type CommerceFulfillmentStatus = typeof COMMERCE_FULFILLMENT_STATUSES[number];

export const COMMERCE_FULFILLMENT_EVENT_TYPES = [
	'artifact_released',
	'artifact_delivered',
	'manual_status',
	'revoked',
] as const;

export type CommerceFulfillmentEventType = typeof COMMERCE_FULFILLMENT_EVENT_TYPES[number];

export const COMMERCE_SERVICE_REQUEST_STATUSES = [
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
] as const;

export type CommerceServiceRequestStatus = typeof COMMERCE_SERVICE_REQUEST_STATUSES[number];

export const COMMERCE_SERVICE_QUOTE_STATUSES = [
	'draft',
	'submitted',
	'buyer_approved',
	'vendor_approved',
	'accepted',
	'rejected',
	'expired',
	'superseded',
	'canceled',
] as const;

export type CommerceServiceQuoteStatus = typeof COMMERCE_SERVICE_QUOTE_STATUSES[number];

export const COMMERCE_SERVICE_CONTRACT_STATUSES = [
	'pending_checkout',
	'active',
	'fulfilled',
	'canceled',
	'disputed',
] as const;

export type CommerceServiceContractStatus = typeof COMMERCE_SERVICE_CONTRACT_STATUSES[number];

export const COMMERCE_SERVICE_EVENT_TYPES = [
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
] as const;

export type CommerceServiceEventType = typeof COMMERCE_SERVICE_EVENT_TYPES[number];

export const COMMERCE_CAPACITY_LISTING_STATUSES = [
	'draft',
	'submitted',
	'approved',
	'rejected',
	'suspended',
	'archived',
] as const;

export type CommerceCapacityListingStatus = typeof COMMERCE_CAPACITY_LISTING_STATUSES[number];

export const COMMERCE_CAPACITY_INQUIRY_STATUSES = [
	'requested',
	'reviewing',
	'approved_for_scoping',
	'declined',
	'canceled',
] as const;

export type CommerceCapacityInquiryStatus = typeof COMMERCE_CAPACITY_INQUIRY_STATUSES[number];

export const COMMERCE_CAPACITY_ACCESS_LEVELS = [
	'public_summary',
	'buyer_gated',
	'governance_required',
	'private_invite',
] as const;

export type CommerceCapacityAccessLevel = typeof COMMERCE_CAPACITY_ACCESS_LEVELS[number];

export const COMMERCE_CAPACITY_RUNTIME_ISOLATION_LEVELS = [
	'none',
	'project_scoped',
	'tenant_isolated',
	'dedicated_runtime',
	'external_only',
] as const;

export type CommerceCapacityRuntimeIsolationLevel = typeof COMMERCE_CAPACITY_RUNTIME_ISOLATION_LEVELS[number];

export const COMMERCE_CAPACITY_HUMAN_INVOLVEMENT_LEVELS = [
	'none',
	'review_only',
	'operator_assisted',
	'human_delivered',
] as const;

export type CommerceCapacityHumanInvolvementLevel = typeof COMMERCE_CAPACITY_HUMAN_INVOLVEMENT_LEVELS[number];

export const COMMERCE_CAPACITY_AI_INVOLVEMENT_LEVELS = [
	'none',
	'assistive',
	'agentic',
	'model_hosted',
] as const;

export type CommerceCapacityAiInvolvementLevel = typeof COMMERCE_CAPACITY_AI_INVOLVEMENT_LEVELS[number];

export const COMMERCE_CAPACITY_DATA_ACCESS_LEVELS = [
	'none',
	'public_only',
	'buyer_provided',
	'project_scoped',
	'sensitive_review_required',
] as const;

export type CommerceCapacityDataAccessLevel = typeof COMMERCE_CAPACITY_DATA_ACCESS_LEVELS[number];

export const COMMERCE_CAPACITY_SECRET_ACCESS_LEVELS = [
	'none',
	'buyer_managed',
	'delegated_scoped',
	'market_admin_review_required',
] as const;

export type CommerceCapacitySecretAccessLevel = typeof COMMERCE_CAPACITY_SECRET_ACCESS_LEVELS[number];

export interface CommerceVendor {
	id: string;
	teamId: string;
	displayName: string;
	slug: string;
	status: CommerceGovernanceState;
	trustLevel: CommerceVendorTrustLevel;
	professionalEntitlementId: string | null;
	stripeAccountId: string | null;
	salesEnabled: boolean;
	serviceSalesEnabled: boolean;
	capacityListingsEnabled: boolean;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface StripeConnectedAccount {
	id: string;
	vendorId: string;
	teamId: string;
	environment: CommerceStripeEnvironment;
	stripeAccountId: string;
	accountStatus: CommerceStripeAccountStatus;
	onboardingStatus: CommerceStripeOnboardingStatus;
	chargesEnabled: boolean;
	payoutsEnabled: boolean;
	detailsSubmitted: boolean;
	requirementsCurrentlyDue: string[];
	requirementsEventuallyDue: string[];
	requirementsPastDue: string[];
	requirementsDisabledReason: string | null;
	capabilities: Record<string, string>;
	onboardingStartedAt: string | null;
	onboardingCompletedAt: string | null;
	lastSyncedAt: string | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}
