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
import { CommerceEntitlementStatus, CommerceGovernanceState, CommerceOrderStatus, CommerceOwnershipModel, CommerceStripeEnvironment, CommerceStripeSyncStatus } from './commerce-governance-states.ts';
import { CommerceRefundStatus, CommerceServiceQuoteStatus, CommerceServiceRequestStatus, CommerceWebhookEventStatus } from './commerce-subscription-statuses.ts';
import { CommerceCheckout, CommerceOrder, CommercePaymentGroup } from './commerce-capacity-listing-input.ts';
import { CommerceOfferMode, CommerceProductKind } from './template-launch-requirements.ts';
import { CommerceGovernanceEvent } from './commerce-service-contract.ts';

export interface CommerceEntitlement {
	id: string;
	buyerTeamId: string | null;
	buyerUserId: string | null;
	sellerTeamId: string;
	productId: string;
	productVersionId: string | null;
	offerId: string;
	orderId: string | null;
	orderItemId: string | null;
	subscriptionId: string | null;
	status: CommerceEntitlementStatus;
	accessScope: Record<string, unknown>;
	startsAt: string | null;
	endsAt: string | null;
	renewalState: 'none' | 'active' | 'past_due' | 'canceling' | 'canceled';
	fulfillmentArtifactRefs: string[];
	projectId: string | null;
	catalogItemId: string | null;
	ownershipSnapshot?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CommerceBuyerStripeCustomer {
	id: string;
	buyerTeamId: string | null;
	buyerUserId: string | null;
	vendorId: string;
	connectedAccountId: string;
	environment: CommerceStripeEnvironment;
	stripeCustomerId: string;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CommerceWebhookEvent {
	id: string;
	provider: 'stripe';
	environment: CommerceStripeEnvironment;
	eventId: string;
	eventType: string;
	connectedAccountId: string | null;
	status: CommerceWebhookEventStatus;
	objectType: string | null;
	objectId: string | null;
	relatedOrderId: string | null;
	relatedSubscriptionId: string | null;
	payloadHash: string;
	processingError: string | null;
	receivedAt: string;
	processedAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface CommerceCheckoutCreateInput {
	buyerTeamId?: string | null;
	items: Array<{
		offerId: string;
		priceId?: string | null;
		quantity?: number;
	}>;
}

export interface CommerceCheckoutResponse {
	checkout: CommerceCheckout;
	orders: CommerceOrder[];
	paymentGroups: CommercePaymentGroup[];
	entitlements: CommerceEntitlement[];
}

export interface CommercePaymentGroupRefreshResponse {
	paymentGroup: CommercePaymentGroup;
	clientSecret: string | null;
}

export interface CommerceMarketplaceOfferSummary {
	id: string;
	mode: CommerceOfferMode;
	title: string;
	status: CommerceGovernanceState;
	priceId: string | null;
	unitAmount: number | null;
	currency: string | null;
	billingInterval: string | null;
	checkoutEligible: boolean;
	serviceEligible: boolean;
	capacityInquiryEligible: boolean;
	stripeSyncStatus: CommerceStripeSyncStatus | null;
}

export interface CommerceMarketplaceProductSummary {
	id: string;
	kind: CommerceProductKind;
	title: string;
	slug: string | null;
	summary: string | null;
	status: CommerceGovernanceState;
	vendorId: string;
	sellerTeamId: string;
	vendorDisplayName: string | null;
	ownershipModel: CommerceOwnershipModel | null;
	buyerVisibleOwnershipSummary: string | null;
	stewardshipSummary: Record<string, unknown>[];
	offers: CommerceMarketplaceOfferSummary[];
	capacityListingId: string | null;
	serviceRequestEligible: boolean;
	checkoutEligible: boolean;
	updatedAt: string;
}

export interface CommerceMarketplaceCatalogResponse {
	products: CommerceMarketplaceProductSummary[];
}

export interface CommerceRefund {
	id: string;
	orderId: string;
	orderItemId: string | null;
	paymentGroupId: string | null;
	vendorId: string;
	sellerTeamId: string;
	buyerTeamId: string | null;
	buyerUserId: string | null;
	amount: number;
	currency: string;
	status: CommerceRefundStatus;
	reason: string | null;
	stripeRefundId: string | null;
	stripePaymentIntentId: string | null;
	stripeConnectedAccountId: string | null;
	idempotencyKey: string;
	requestedByType: string;
	requestedById: string;
	failureReason: string | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CommerceVendorSalesSummary {
	vendorId: string;
	sellerTeamId: string;
	currency: string | null;
	grossPaidAmount: number;
	refundedAmount: number;
	netPaidAmount: number;
	paidOrderCount: number;
	refundedOrderCount: number;
	activeSubscriptionCount: number;
	activeEntitlementCount: number;
	pendingFulfillmentCount: number;
}

export interface CommerceCommerceMonitor {
	vendorId: string | null;
	sellerTeamId: string;
	stripeReady: boolean;
	blockedStripeSyncCount: number;
	driftedStripeSyncCount: number;
	pendingFulfillmentCount: number;
	failedRefundCount: number;
	failedWebhookCount: number;
	pendingServiceRequestCount: number;
	pendingCapacityInquiryCount: number;
	pendingGovernanceTransferCount: number;
	recentGovernanceEvents: CommerceGovernanceEvent[];
	updatedAt: string;
}

export interface CommerceVendorOrderSummary {
	id: string;
	checkoutId: string | null;
	status: CommerceOrderStatus;
	currency: string;
	totalAmount: number;
	refundedAmount: number;
	buyerTeamId: string | null;
	buyerDisplayName: string | null;
	buyerUserIdRedacted: string | null;
	itemCount: number;
	createdAt: string;
	updatedAt: string;
}

export interface CommerceRefundCreateInput {
	orderItemId?: string | null;
	amount?: number | null;
	reason?: string | null;
	idempotencyKey?: string | null;
	metadata?: Record<string, unknown>;
}

export interface CommerceArtifactDeliveryInput {
	catalogArtifactVersionId?: string | null;
	artifactRefs?: Record<string, unknown>[];
	message?: string | null;
}

export interface CommerceServiceRequest {
	id: string;
	buyerTeamId: string | null;
	buyerUserId: string | null;
	vendorId: string;
	sellerTeamId: string;
	productId: string;
	offerId: string;
	status: CommerceServiceRequestStatus;
	requestedScope: string;
	approvedScope: string | null;
	accessNeeds: Record<string, unknown>;
	buyerVisibleSummary: string | null;
	vendorPrivateNotes: string | null;
	activeQuoteId: string | null;
	approvedQuoteId: string | null;
	contractId: string | null;
	relatedProjectId: string | null;
	relatedWorkdayId: string | null;
	orderId: string | null;
	entitlementId: string | null;
	ownershipSnapshot?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CommerceServiceQuote {
	id: string;
	requestId: string;
	vendorId: string;
	sellerTeamId: string;
	buyerTeamId: string | null;
	buyerUserId: string | null;
	quoteVersion: number;
	status: CommerceServiceQuoteStatus;
	title: string;
	scopeSummary: string;
	deliverables: Record<string, unknown>[];
	assumptions: Record<string, unknown>[];
	accessRequirements: Record<string, unknown>;
	governanceRequirements: Record<string, unknown>;
	amount: number;
	currency: string;
	expiresAt: string | null;
	buyerApprovedAt: string | null;
	vendorApprovedAt: string | null;
	acceptedAt: string | null;
	rejectedAt: string | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}
