import type { CredentialAuthorityScheme, ServiceCapabilityType } from './service-provider-contracts.ts';

export const PROVIDER_ADAPTER_KINDS = [
	'repository-hosting',
	'workflow-execution',
	'workflow-configuration',
	'object-storage',
	'webhook-ingress',
] as const;

export type ProviderAdapterKind = (typeof PROVIDER_ADAPTER_KINDS)[number];

export type ProviderCredentialAuthority = {
	id: string;
	teamId: string;
	connectionId: string;
	credentialProfileId: string;
	scheme: CredentialAuthorityScheme;
	reference: string;
	capabilities: ServiceCapabilityType[];
	status: 'ready' | 'interactive-only' | 'reauthorization-required' | 'revoked';
	version: number;
};

export type ProjectRemoteRepositoryBinding = {
	id: string;
	projectId: string;
	teamId: string;
	serviceConnectionId: string;
	capabilityBindingId: string;
	providerId: string;
	providerRepositoryId: string;
	owner: string;
	name: string;
	cloneUrl: string;
	defaultRef: string;
	publicationRef: string;
	authorityId: string;
	expectedHead?: string | null;
	observedHead?: string | null;
	grantStatus: 'ready' | 'missing' | 'suspended' | 'reauthorization-required';
	drift: 'none' | 'remote-ahead' | 'remote-behind' | 'diverged' | 'unavailable' | 'unknown';
	version: number;
};

export type RemoteGitOperationGrant = {
	id: string;
	operationId: string;
	actorId: string;
	teamId: string;
	projectId: string;
	repositoryBindingId: string;
	treeDxNodeId: string;
	sourceRef: string;
	destinationRef: string;
	reviewedCommit: string;
	expectedRemoteHead: string;
	credentialAuthorityId: string;
	status: 'pending' | 'delivered' | 'consumed' | 'expired' | 'cancelled' | 'failed';
	expiresAt: string;
	idempotencyKey: string;
};

export type RemoteCredentialDelivery = {
	id: string;
	grantId: string;
	operationId: string;
	nodeId: string;
	allowedHost: string;
	refspecDigest: string;
	deliveryMode: 'mint-jit' | 'sealed';
	ciphertext?: string | null;
	algorithm?: 'x25519-sealed-box' | null;
	status: 'ready' | 'consumed' | 'expired' | 'cancelled' | 'failed';
	expiresAt: string;
	consumedAt?: string | null;
};

export interface RepositoryHostingAdapter {
	readonly providerId: string;
	observe(binding: ProjectRemoteRepositoryBinding): Promise<{ head: string | null; repositoryId: string }>;
	validateGrant(binding: ProjectRemoteRepositoryBinding, authority: ProviderCredentialAuthority): Promise<void>;
}

export interface ObjectStorageAdapter {
	readonly providerId: string;
	putImmutable(key: string, body: Uint8Array, digest: string): Promise<void>;
	get(key: string): Promise<Uint8Array | null>;
	compareAndSwapPointer(key: string, expectedRevision: string | null, nextRevision: string): Promise<boolean>;
	deletePrefix(prefix: string): Promise<void>;
}

export interface WebhookIngressAdapter {
	readonly providerId: string;
	verify(input: { body: Uint8Array; headers: Record<string, string> }): Promise<{ deliveryId: string; event: string }>;
}
