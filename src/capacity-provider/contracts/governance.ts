import type { ResearchSourcePolicy } from '../../agent-capacity/contracts/support/research-source-policy.ts';

export const CAPACITY_PROVIDER_IDENTITY_ALGORITHM = 'Ed25519' as const;
export const CAPACITY_PROVIDER_PROOF_TTL_SECONDS = 300;
export const CAPACITY_PROVIDER_ACCESS_TOKEN_TTL_SECONDS = 900;
export const CAPACITY_PROVIDER_ACCESS_TOKEN_REFRESH_SECONDS = 300;

export type CapacityProviderIdentityStatus = 'active' | 'rotating' | 'revoked';
export type TeamCapacityRegistrationKeyStatus = 'active' | 'disabled';
export type ProviderRegistrationRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired';
export type ProviderTeamMembershipStatus = 'approved' | 'suspended' | 'revoked';
export type ProviderTeamCredentialStatus = 'active' | 'rotating' | 'revoked';
export type ProviderAccessTokenStatus = 'active' | 'revoked' | 'expired';
export type ProviderAvailabilitySessionStatus = 'open' | 'draining' | 'closed' | 'expired';
export type CapacityExecutionProviderStatus = 'active' | 'degraded' | 'unavailable' | 'revoked';
export type CapacityProviderLaneStatus = 'active' | 'paused' | 'degraded' | 'revoked';

export interface CapacityProviderPublicJwk {
	kty: 'OKP';
	crv: 'Ed25519';
	x: string;
	kid?: string;
	use?: 'sig';
	alg?: 'EdDSA';
}

export interface CapacityProviderIdentity {
	schemaVersion: 1;
	providerId: string;
	fingerprint: string;
	publicJwk: CapacityProviderPublicJwk;
	displayName: string;
	identityVersion: number;
	status: CapacityProviderIdentityStatus;
	createdAt: string;
	updatedAt: string;
	rotatedAt?: string | null;
	revokedAt?: string | null;
}

export interface TeamCapacityRegistrationKeyMetadata {
	teamId: string;
	generation: number;
	keyPrefix: string;
	status: TeamCapacityRegistrationKeyStatus;
	createdAt: string;
	updatedAt: string;
	rotatedAt?: string | null;
	lastRevealedAt?: string | null;
}

export interface TeamCapacityRegistrationKeyReveal extends TeamCapacityRegistrationKeyMetadata {
	registrationKey: string;
}

export interface CapacityProviderProofPayload {
	schemaVersion: 1;
	algorithm: 'Ed25519';
	providerFingerprint: string;
	identityVersion: number;
	method: string;
	path: string;
	bodySha256: string;
	audience: string;
	issuedAt: string;
	expiresAt: string;
	jti: string;
}

export interface CapacityProviderSignedProof {
	protected: string;
	payload: string;
	signature: string;
}

export interface ProviderSupplyOffer {
	weight?: number;
	sharePercent?: number;
	maxConcurrentRunners?: number;
	capabilities: string[];
	availability?: {
		availableFrom?: string | null;
		availableUntil?: string | null;
		timeZone?: string | null;
	};
	metadata?: Record<string, unknown>;
}

export interface ProviderRegistrationSubmission {
	schemaVersion: 1;
	displayName: string;
	publicJwk: CapacityProviderPublicJwk;
	proof: CapacityProviderSignedProof;
	capabilitySummary: string[];
	supplyOffer: ProviderSupplyOffer;
	metadata?: Record<string, unknown>;
}

export interface ProviderRegistrationRequest {
	id: string;
	teamId: string;
	providerId: string;
	providerFingerprint: string;
	registrationKeyGeneration: number;
	status: ProviderRegistrationRequestStatus;
	capabilitySummary: string[];
	supplyOffer: ProviderSupplyOffer;
	expiresAt: string;
	createdAt: string;
	updatedAt: string;
	reviewedAt?: string | null;
	reviewedById?: string | null;
	rejectionReason?: string | null;
	membershipId?: string | null;
	metadata?: Record<string, unknown>;
}

export interface ProviderTeamMembership {
	id: string;
	teamId: string;
	providerId: string;
	status: ProviderTeamMembershipStatus;
	teamAlias?: string | null;
	approvedAt: string;
	approvedById: string;
	updatedAt: string;
	suspendedAt?: string | null;
	revokedAt?: string | null;
	revokedById?: string | null;
	metadata?: Record<string, unknown>;
}

export interface ProviderCredentialIssuanceAuthorization {
	id: string;
	membershipId: string;
	teamId: string;
	providerId: string;
	generation: number;
	status: 'pending' | 'issued' | 'cancelled';
	issuedCredentialId?: string | null;
	createdAt: string;
	updatedAt: string;
}

/** Team-scoped read projection. It does not make provider identity team-owned. */
export interface CapacityProviderMembershipView {
	providerId: string;
	fingerprint: string;
	publicJwk: CapacityProviderPublicJwk;
	displayName: string;
	identityVersion: number;
	identityStatus: CapacityProviderIdentityStatus;
	membershipId: string;
	teamId: string;
	membershipStatus: ProviderTeamMembershipStatus;
	identityMetadata?: Record<string, unknown>;
	membershipMetadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export const PROVIDER_MEMBERSHIP_SCOPES = [
	'provider:availability:write',
	'provider:assignments:read',
	'provider:assignments:write',
	'provider:usage:write',
	'provider:credentials:rotate',
] as const;

export type ProviderMembershipScope = (typeof PROVIDER_MEMBERSHIP_SCOPES)[number];

export interface ProviderTeamCredentialMetadata {
	id: string;
	membershipId: string;
	teamId: string;
	providerId: string;
	keyPrefix: string;
	issuanceGeneration: number;
	status: ProviderTeamCredentialStatus;
	scopes: ProviderMembershipScope[];
	createdAt: string;
	updatedAt: string;
	expiresAt?: string | null;
	lastUsedAt?: string | null;
	rotatedFromCredentialId?: string | null;
	revokedAt?: string | null;
}

export interface ProviderTeamCredentialIssue extends ProviderTeamCredentialMetadata {
	credential: string;
}

export interface ProviderAccessToken {
	id: string;
	membershipId: string;
	credentialId: string;
	status: ProviderAccessTokenStatus;
	scopes: ProviderMembershipScope[];
	issuedAt: string;
	expiresAt: string;
	revokedAt?: string | null;
}

export interface ProviderAccessTokenIssue extends ProviderAccessToken {
	teamId: string;
	providerId: string;
	accessToken: string;
	identityVersion: number;
}

export interface CapacityProviderIdentityRotationRequest {
	expectedIdentityVersion: number;
	newPublicJwk: CapacityProviderPublicJwk;
	oldProof: CapacityProviderSignedProof;
	newProof: CapacityProviderSignedProof;
}

export interface CapacityExecutionProviderNativeLimit {
	id: string;
	executionProviderId: string;
	scope: string;
	nativeUnit: string;
	limitAmount: number;
	reserveBufferPercent: number;
	resetCadence?: string | null;
	resetAt?: string | null;
	confidence: 'low' | 'medium' | 'high' | string;
	source: string;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CapacityExecutionProviderObservation {
	id: string;
	executionProviderId: string;
	observedAt: string;
	health: string;
	activeRunners?: number | null;
	queuedAssignments?: number | null;
	throttleState?: string | null;
	nativeRemaining: Record<string, unknown>;
	resetAt?: string | null;
	confidence: 'low' | 'medium' | 'high' | string;
	metadata?: Record<string, unknown>;
	createdAt: string;
}

/** Provider-global execution capability and native-budget facts. */
export interface CapacityExecutionProvider {
	schemaVersion: 1;
	id: string;
	providerId: string;
	displayName: string;
	adapter: string;
	status: CapacityExecutionProviderStatus;
	capabilities: string[];
	nativeUnit: string;
	quotaVisibility: string;
	maxConcurrentRunners: number;
	nativeLimits: CapacityExecutionProviderNativeLimit[];
	latestObservation?: CapacityExecutionProviderObservation | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

/** Optional provider-global lane that narrows an execution provider's limits. */
export interface CapacityProviderLane {
	schemaVersion: 1;
	id: string;
	providerId: string;
	executionProviderId: string;
	displayName: string;
	status: CapacityProviderLaneStatus;
	capabilities: string[];
	maxConcurrentRunners: number;
	nativeLimits: CapacityExecutionProviderNativeLimit[];
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface ProviderLaneSnapshot {
	id: string;
	executionProviderId: string;
	status: CapacityProviderLaneStatus;
	capabilities: string[];
	maxConcurrentRunners: number;
	activeRunners: number;
	nativeLimits: Record<string, unknown>;
}

export interface ProviderExecutionProviderSnapshot {
	id: string;
	adapter: string;
	status: 'available' | 'degraded' | 'unavailable';
	capabilities: string[];
	maxConcurrentRunners: number;
	activeRunners: number;
	nativeLimits: Record<string, unknown>;
	observations?: Record<string, unknown>;
	lanes: ProviderLaneSnapshot[];
}

export interface ProviderAvailabilitySnapshot {
	sequence: number;
	availableFrom: string;
	availableUntil?: string | null;
	pressure: 'idle' | 'normal' | 'busy' | 'throttled' | 'exhausted';
	maxConcurrentAssignments: number;
	activeAssignmentIds: string[];
	executionProviders: ProviderExecutionProviderSnapshot[];
	capabilities: string[];
	constraints?: Record<string, unknown>;
}

export interface ProviderAvailabilitySession {
	id: string;
	membershipId: string;
	teamId: string;
	providerId: string;
	status: ProviderAvailabilitySessionStatus;
	sequence: number;
	snapshot: ProviderAvailabilitySnapshot;
	openedAt: string;
	refreshedAt: string;
	expiresAt: string;
	closedAt?: string | null;
}

export interface ProviderConnectionConfig {
	id: string;
	marketProfile?: string;
	marketUrl?: string;
	marketAudience?: string;
	teamId: string;
	providerId: string;
	membershipId: string;
	membershipCredentialRef: string;
	membershipCredentialId: string;
	offer: ProviderSupplyOffer;
	enabled?: boolean;
}

/** One-time onboarding input. It is never valid durable provider runtime configuration. */
export interface CapacityProviderJoinInput {
	id: string;
	marketProfile?: string;
	marketUrl?: string;
	marketAudience?: string;
	registrationKeyRef: string;
	offer: ProviderSupplyOffer;
}

export interface CapacityProviderManifestV2 {
	schemaVersion: 2;
	identity: {
		privateKeyRef: string;
		displayName: string;
	};
	executionProviders: Array<{
		id: string;
		adapter: string;
		nativeLimits: Record<string, unknown>;
		researchSourcePolicy?: ResearchSourcePolicy;
		capabilities?: string[];
		lanes?: Array<{
			id: string;
			maxConcurrentRunners: number;
			capabilities?: string[];
			nativeLimits?: Record<string, unknown>;
		}>;
	}>;
	connections: ProviderConnectionConfig[];
	metadata?: Record<string, unknown>;
}
