import type { ResearchSourcePolicy } from '../../agent-capacity/contracts/support/research-source-policy.ts';
import type { CapabilityOffer } from '../capability-ontology.ts';

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
	schemaVersion: 2;
	id: string;
	providerId: string;
	displayName: string;
	purpose: import('../../agent-capacity/contracts/capacity/communication/communication-records.ts').ProviderLanePurpose;
	status: CapacityProviderLaneStatus;
	priority: number;
	reservedConcurrentWorkers: number;
	borrowWhenIdle: boolean;
	lendWhenIdle: boolean;
	reclaimPolicy: 'admission';
	queueLimit: number;
	timeoutSeconds: number;
	capabilities: string[];
	maxConcurrentWorkers: number;
	minimumAssignmentDuration?: MinimumAssignmentDuration;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface ProviderLaneSnapshot {
	id: string;
	purpose: import('../../agent-capacity/contracts/capacity/communication/communication-records.ts').ProviderLanePurpose;
	status: CapacityProviderLaneStatus;
	priority: number;
	reservedConcurrentWorkers: number;
	borrowedWorkers: number;
	lentWorkers: number;
	queuedAssignments: number;
	capabilities: string[];
	maxConcurrentWorkers: number;
	activeWorkers: number;
	minimumAssignmentDuration?: MinimumAssignmentDuration;
}

export type MinimumAssignmentDuration =
	| { amount: number; unit: 'seconds' }
	| {
		amount: number;
		unit: 'business-days';
		calendar: {
			timeZone: string;
			weekdays?: number[];
			holidayDates?: string[];
		};
	};

export interface ProviderExecutionAdapterSnapshot {
	id: string;
	adapter: string;
	isolation: 'microvm' | 'process' | 'worker';
	status: 'available' | 'degraded' | 'unavailable';
	capabilities: string[];
	laneIds: string[];
	maxConcurrentWorkers: number;
	activeWorkers: number;
	minimumAssignmentDuration?: MinimumAssignmentDuration;
	nativeLimits: Record<string, unknown>;
	observations?: Record<string, unknown>;
}

export interface ProviderAvailabilitySnapshot {
	sequence: number;
	availableFrom: string;
	availableUntil?: string | null;
	pressure: 'idle' | 'normal' | 'busy' | 'throttled' | 'exhausted';
	maxConcurrentWorkers: number;
	activeAssignmentIds: string[];
	reservedWorkers: number;
	borrowedWorkers: number;
	availableWorkers: number;
	adapters: ProviderExecutionAdapterSnapshot[];
	lanes: ProviderLaneSnapshot[];
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
	serverProfile?: string;
	controlPlaneUrl?: string;
	controlPlaneAudience?: string;
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
	serverProfile?: string;
	controlPlaneUrl?: string;
	controlPlaneAudience?: string;
	registrationKeyRef: string;
	offer: ProviderSupplyOffer;
}

export interface CapacityProviderManifestV3 {
	schemaVersion: 3;
	ownership: {
		type: 'team' | 'external';
		teamId?: string;
	};
	configuration: {
		generation: string;
		sourceManifestDigest?: string;
	};
	identity: {
		privateKeyRef: string;
		displayName: string;
	};
	capacity: {
		maxConcurrentWorkers: number;
		cpuCores?: number;
		memoryBytes?: number;
		accelerators?: Array<{ kind: string; count: number; memoryBytes?: number }>;
		maxActiveSeconds?: number;
		maxInputTokens?: number;
		maxOutputTokens?: number;
		maxCost?: number;
		currency?: string;
		maxAttempts?: number;
	};
	credentialProfiles?: Array<{
		id: string;
		source: 'service-vault' | 'process-environment';
		reference: string;
		required: boolean;
	}>;
	lanes: Array<{
		id: string;
		purpose: import('../../agent-capacity/contracts/capacity/communication/communication-records.ts').ProviderLanePurpose;
		priority: number;
		reservedConcurrentWorkers: number;
		maxConcurrentWorkers: number;
		borrowWhenIdle: boolean;
		lendWhenIdle: boolean;
		reclaimPolicy: 'admission';
		queueLimit: number;
		timeoutSeconds: number;
		minimumAssignmentDuration?: MinimumAssignmentDuration;
		capabilities?: string[];
	}>;
	adapters: Array<{
		id: string;
		adapter: string;
		isolation: 'process' | 'worker';
		profile?: string;
		module?: string;
		protocol?: 'responses' | 'chat-completions';
		model?: {
			endpointRef?: string;
			baseUrl?: string;
			model?: string;
		};
		credentialProfiles?: string[];
		laneIds: string[];
		maxConcurrentWorkers: number;
		healthProbe?: string;
		versionConstraint?: string;
		configurationDigest?: string;
		minimumAssignmentDuration?: MinimumAssignmentDuration;
		nativeLimits: Record<string, unknown>;
		researchSourcePolicy?: ResearchSourcePolicy;
		capabilities?: string[];
	}>;
	connections: ProviderConnectionConfig[];
	metadata?: Record<string, unknown>;
}

export interface CapacityProviderSandboxProfile {
	id: string;
	contract?: { id: string; version: string; digest: string; capabilities: string[] };
	guestImage: string;
	guestImageDigest: string;
	lineage?: { baseImageDigest: string; provenanceDigest: string; architectures: Array<'amd64' | 'arm64'>; signature: { keyId: string; algorithm: 'cosign' | 'Ed25519'; value: string } };
	defaultDenyNetwork: true;
	resources: { cpuCores: number; memoryBytes: number; diskBytes: number; processLimit: number; outputBytes: number };
}

export interface CapacityProviderManifestV4 extends Omit<CapacityProviderManifestV3, 'schemaVersion' | 'adapters'> {
	schemaVersion: 4;
	sandbox: {
		required: true;
		brokerSocket: string;
		runtime: 'kata-runtime-rs-qemu';
		profiles: CapacityProviderSandboxProfile[];
	};
	adapters: Array<Omit<CapacityProviderManifestV3['adapters'][number], 'isolation'> & {
		isolation: 'microvm' | 'process' | 'worker';
		sandboxProfileIds?: string[];
		defaultSandboxProfiles?: { conversation: string; execution: string };
	}>;
}

export interface CapacityProviderManifestV5 extends Omit<CapacityProviderManifestV4, 'schemaVersion' | 'adapters'> {
	schemaVersion: 5;
	ontology: { generation: number; digest: string };
	adapters: Array<Omit<CapacityProviderManifestV4['adapters'][number], 'capabilities' | 'sandboxProfileIds' | 'defaultSandboxProfiles'> & {
		isolation: 'microvm';
		offers: Array<{ offer: CapabilityOffer; sandboxProfileId: string }>;
	}>;
}

export type CapacityProviderManifest = CapacityProviderManifestV3 | CapacityProviderManifestV4 | CapacityProviderManifestV5;
