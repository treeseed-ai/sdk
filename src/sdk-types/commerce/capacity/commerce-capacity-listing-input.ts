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
import { CommerceCapacityAccessLevel, CommerceCapacityAiInvolvementLevel, CommerceCapacityDataAccessLevel, CommerceCapacityHumanInvolvementLevel, CommerceCapacityRuntimeIsolationLevel, CommerceCapacitySecretAccessLevel, CommercePaymentGroupStatus, CommerceSubscriptionStatus, CommerceVendor, StripeConnectedAccount } from '../payments/commerce-subscription-statuses.ts';
import { CommerceCartStatus, CommerceCheckoutStatus, CommerceGovernanceState, CommerceOrderItemStatus, CommerceOrderStatus, CommerceStripeSyncStatus } from '../governance/commerce-governance-states.ts';
import { CommerceOfferMode } from '../../support/template-launch-requirements.ts';
import { CommerceProduct } from '../vendors/commerce-stripe-onboarding-request-input.ts';
import { CommerceEntitlement } from '../payments/commerce-entitlement.ts';

export interface CommerceCapacityListingInput {
	capacityProviderId?: string | null;
	executionProviderId?: string | null;
	accessLevel?: CommerceCapacityAccessLevel;
	runtimeIsolationLevel?: CommerceCapacityRuntimeIsolationLevel;
	humanInvolvementLevel?: CommerceCapacityHumanInvolvementLevel;
	aiInvolvementLevel?: CommerceCapacityAiInvolvementLevel;
	dataAccessLevel?: CommerceCapacityDataAccessLevel;
	secretAccessLevel?: CommerceCapacitySecretAccessLevel;
	supportedServiceTypes?: string[];
	supportedRegions?: string[];
	runtimeRequirements?: Record<string, unknown>;
	dataHandlingSummary?: string | null;
	buyerVisibleRiskSummary?: string | null;
	governanceRequirements?: Record<string, unknown>;
	supportPolicy?: string | null;
	availabilitySummary?: string | null;
	metadata?: Record<string, unknown>;
}

export interface CommerceCapacityListingInquiryInput {
	requestedServiceType?: string | null;
	requestedScope: string;
	dataAccessRequested?: Record<string, unknown>;
	secretAccessRequested?: Record<string, unknown>;
	relatedProjectId?: string | null;
	relatedWorkdayId?: string | null;
	metadata?: Record<string, unknown>;
}

export interface CommerceCapacityInquiryDecisionInput {
	reason?: string | null;
	evidence?: Record<string, unknown>;
}

export interface CommerceProductVersion {
	id: string;
	productId: string;
	version: string;
	status: CommerceGovernanceState;
	catalogArtifactVersionId: string | null;
	manifestKey: string | null;
	artifactKey: string | null;
	integrity: string | null;
	releaseNotes: string | null;
	compatibility: Record<string, unknown>;
	metadata?: Record<string, unknown>;
	publishedAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface CommerceOffer {
	id: string;
	productId: string;
	productVersionId: string | null;
	vendorId: string;
	sellerTeamId: string;
	mode: CommerceOfferMode;
	status: CommerceGovernanceState;
	title: string;
	termsSummary: string | null;
	accessScope: Record<string, unknown>;
	supportScope: Record<string, unknown>;
	fulfillmentMode: 'automatic' | 'manual' | 'scoped' | 'external';
	activePriceId: string | null;
	stripeProductId: string | null;
	stripeProductStatus: CommerceStripeSyncStatus;
	stripeProductSyncedAt: string | null;
	stripeProductSyncError: string | null;
	stripeProductMetadata?: Record<string, unknown>;
	startsAt: string | null;
	endsAt: string | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CommercePrice {
	id: string;
	offerId: string;
	amount: number;
	currency: string;
	billingInterval: 'one_time' | 'month' | 'year' | 'custom';
	status: 'draft' | 'active' | 'archived';
	stripeProductId: string | null;
	stripePriceId: string | null;
	stripeLookupKey: string | null;
	stripeSyncStatus: CommerceStripeSyncStatus;
	stripeSyncedAt: string | null;
	stripeSyncError: string | null;
	stripeMetadata?: Record<string, unknown>;
	priceVersion: number;
	taxBehavior: 'exclusive' | 'inclusive' | 'unspecified';
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CommerceStripeProductSyncResult {
	offer: CommerceOffer;
	product: CommerceProduct;
	vendor: CommerceVendor;
	connectedAccount: StripeConnectedAccount;
	stripeProductId: string;
	status: CommerceStripeSyncStatus;
	reconciled: boolean;
}

export interface CommerceStripePriceSyncResult {
	offer: CommerceOffer;
	price: CommercePrice;
	connectedAccount: StripeConnectedAccount;
	stripeProductId: string;
	stripePriceId: string;
	stripeLookupKey: string;
	status: CommerceStripeSyncStatus;
	reconciled: boolean;
}

export interface CommerceCart {
	id: string;
	buyerTeamId: string | null;
	buyerUserId: string | null;
	status: CommerceCartStatus;
	currency: string | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CommerceCartItem {
	id: string;
	cartId: string;
	vendorId: string;
	sellerTeamId: string;
	productId: string;
	productVersionId: string | null;
	offerId: string;
	priceId: string | null;
	quantity: number;
	unitAmount: number;
	currency: string;
	mode: CommerceOfferMode;
	status: 'active' | 'removed' | 'converted';
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CommerceCheckout {
	id: string;
	cartId: string;
	buyerTeamId: string | null;
	buyerUserId: string | null;
	status: CommerceCheckoutStatus;
	checkoutMode: 'stripe_elements_grouped_vendor';
	groupCount: number;
	completedGroupCount: number;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CommerceOrder {
	id: string;
	checkoutId: string | null;
	cartId: string | null;
	buyerTeamId: string | null;
	buyerUserId: string | null;
	vendorId: string | null;
	sellerTeamId: string | null;
	status: CommerceOrderStatus;
	currency: string;
	subtotalAmount: number;
	totalAmount: number;
	refundedAmount: number;
	refundStatus: 'none' | 'partial' | 'full';
	stripeCheckoutSessionId: string | null;
	stripePaymentIntentId: string | null;
	stripeSubscriptionId: string | null;
	stripeCustomerId: string | null;
	stripeConnectedAccountId: string | null;
	ownershipSnapshot?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CommerceOrderItem {
	id: string;
	orderId: string;
	vendorId: string;
	sellerTeamId: string;
	productId: string;
	productVersionId: string | null;
	offerId: string;
	priceId: string;
	mode: CommerceOfferMode;
	quantity: number;
	unitAmount: number;
	totalAmount: number;
	refundedAmount: number;
	refundStatus: 'none' | 'partial' | 'full';
	currency: string;
	status: CommerceOrderItemStatus;
	entitlementId: string | null;
	ownershipSnapshot?: Record<string, unknown>;
	accessScope: Record<string, unknown>;
	supportScope: Record<string, unknown>;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CommercePaymentGroup {
	id: string;
	checkoutId: string;
	orderId: string;
	vendorId: string;
	sellerTeamId: string;
	connectedAccountId: string | null;
	groupKind: 'free' | 'one_time' | 'subscription';
	billingInterval: 'one_time' | 'month' | 'year' | null;
	status: CommercePaymentGroupStatus;
	currency: string;
	subtotalAmount: number;
	totalAmount: number;
	stripePaymentIntentId: string | null;
	stripeSubscriptionId: string | null;
	stripeCustomerId: string | null;
	clientSecret: string | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CommerceSubscription {
	id: string;
	orderId: string;
	vendorId: string;
	sellerTeamId: string;
	buyerTeamId: string | null;
	buyerUserId: string | null;
	offerId: string;
	priceId: string;
	status: CommerceSubscriptionStatus;
	renewalState: CommerceEntitlement['renewalState'];
	stripeSubscriptionId: string;
	stripeCustomerId: string | null;
	stripeConnectedAccountId: string;
	currentPeriodStart: string | null;
	currentPeriodEnd: string | null;
	cancelAtPeriodEnd: boolean;
	canceledAt: string | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}
