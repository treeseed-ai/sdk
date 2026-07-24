


export const SECRET_CUSTODY_MODES = [
	'github_actions_secret_enclave',
	'client_encrypted_escrow',
	'metadata_only_reentry',
	'host_env_injection',
	'bootstrap_service_secret',
	'provider_owned_secret',
	'external_vault_reference',
] as const;

export const V1_REPOSITORY_CREDENTIAL_PROVIDERS = ['github-app'] as const;

export const SECRET_CLASSES = [
	'repository_access',
	'workflow_secret',
	'host_runtime_secret',
	'provider_runtime_secret',
	'bootstrap_service_secret',
	'customer_project_secret',
] as const;

export const PROVIDER_WORKSPACE_ACCESS_MODES = [
	'full_repository_workspace',
	'brokered_file_collection',
	'workflow_operation_only',
] as const;

export const WORKFLOW_OPERATION_DISPATCH_MODES = ['allowlisted'] as const;

export const SECRET_METADATA_RECORD_STATUSES = ['active', 'migrated', 'tombstoned', 'blocked'] as const;

export const GITHUB_REPOSITORY_GRANT_STATUSES = ['active', 'drifted', 'revoked', 'blocked'] as const;

export const GITHUB_APP_INSTALLATION_STATUSES = ['active', 'drifted', 'revoked', 'suspended', 'blocked'] as const;

export const GITHUB_APP_TOKEN_ISSUANCE_STATUSES = ['issued', 'expired', 'revoked', 'blocked'] as const;

export const WORKFLOW_OPERATION_RECORD_STATUSES = ['active', 'blocked', 'drifted', 'archived'] as const;

export const WORKFLOW_DISPATCH_RECORD_STATUSES = [
	'queued',
	'dispatched',
	'running',
	'succeeded',
	'failed',
	'cancelled',
	'blocked',
] as const;

export const TREEDX_CREDENTIAL_ISSUANCE_STATUSES = ['issued', 'expired', 'revoked', 'blocked'] as const;

export const TREEDX_CREDENTIAL_BRIDGE_OPERATIONS = [
	'clone',
	'fetch',
	'save',
	'commit',
	'push',
	'pull_request',
	'repository_update',
] as const;

export const SECRET_CAPABILITY_FAIL_CLOSED_CODES = [
	'github_grant_revoked',
	'github_grant_drifted',
	'github_installation_missing',
	'github_installation_revoked',
	'github_installation_suspended',
	'github_repository_removed',
	'github_account_mismatch',
	'github_permission_drift',
	'github_app_token_blocked',
	'github_environment_missing',
	'workflow_trust_drift',
	'workflow_dispatch_blocked',
	'treedx_credential_expired',
	'treedx_credential_revoked',
	'assignment_lease_revoked',
] as const;

export const CLIENT_ENCRYPTED_ESCROW_STATUSES = [
	'active',
	'migrated',
	'expired',
	'tombstoned',
	'reentry_required',
] as const;

export type SecretCustodyMode = (typeof SECRET_CUSTODY_MODES)[number];

export type V1RepositoryCredentialProvider = (typeof V1_REPOSITORY_CREDENTIAL_PROVIDERS)[number];

export type SecretClass = (typeof SECRET_CLASSES)[number];

export type ProviderWorkspaceAccessMode = (typeof PROVIDER_WORKSPACE_ACCESS_MODES)[number];

export type WorkflowOperationDispatchMode = (typeof WORKFLOW_OPERATION_DISPATCH_MODES)[number];

export type SecretMetadataRecordStatus = (typeof SECRET_METADATA_RECORD_STATUSES)[number];

export type GitHubRepositoryGrantStatus = (typeof GITHUB_REPOSITORY_GRANT_STATUSES)[number];

export type GitHubAppInstallationStatus = (typeof GITHUB_APP_INSTALLATION_STATUSES)[number];

export type GitHubAppTokenIssuanceStatus = (typeof GITHUB_APP_TOKEN_ISSUANCE_STATUSES)[number];

export type WorkflowOperationRecordStatus = (typeof WORKFLOW_OPERATION_RECORD_STATUSES)[number];

export type WorkflowDispatchRecordStatus = (typeof WORKFLOW_DISPATCH_RECORD_STATUSES)[number];

export type TreeDxCredentialIssuanceStatus = (typeof TREEDX_CREDENTIAL_ISSUANCE_STATUSES)[number];

export type TreeDxCredentialBridgeOperation = (typeof TREEDX_CREDENTIAL_BRIDGE_OPERATIONS)[number];

export type SecretCapabilityFailClosedCode = (typeof SECRET_CAPABILITY_FAIL_CLOSED_CODES)[number];

export type ClientEncryptedEscrowStatus = (typeof CLIENT_ENCRYPTED_ESCROW_STATUSES)[number];

export type SecretOwnerKind = 'customer' | 'treeseed' | 'provider';

export type RepositoryAuthorityDefault = 'github-app' | 'github-actions-secret-enclave';

export type GitHubSecretScope = 'repository' | 'environment';

export interface SecretOwner {
	kind: SecretOwnerKind | string;
	teamId?: string | null;
	projectId?: string | null;
	providerId?: string | null;
}

export interface SecretMetadata {
	id: string;
	name: string;
	secretClass: SecretClass | string;
	custodyMode: SecretCustodyMode | string;
	owner: SecretOwner;
	apiDecryptable?: boolean;
	plaintextAllowed?: boolean;
	metadata?: Record<string, unknown>;
}

export interface SecretMetadataRecord extends SecretMetadata {
	teamId: string;
	projectId?: string | null;
	status: SecretMetadataRecordStatus | string;
	githubSecretTarget?: {
		repository?: string | null;
		environment?: string | null;
		secretName?: string | null;
		scope?: GitHubSecretScope | string | null;
	} | null;
	escrowRecordId?: string | null;
	failClosedCode?: SecretCapabilityFailClosedCode | string | null;
	createdAt?: string;
	updatedAt?: string;
	tombstonedAt?: string | null;
}

export interface ClientEncryptedEscrowMetadata {
	id: string;
	secretId: string;
	ciphertext?: string | null;
	ciphertextRef: string;
	algorithm: string;
	nonce?: string | null;
	salt?: string | null;
	kdf?: string | null;
	kdfParams?: Record<string, unknown> | null;
	wrappingKeyId: string;
	encryptionVersion?: string | null;
	createdByClientId?: string | null;
	createdAt?: string | null;
	expiresAt?: string | null;
	deploymentIntent?: {
		targetMode?: 'github_actions_secret_enclave' | 'host_env_injection' | 'metadata_only_reentry' | string;
		repository?: string | null;
		environment?: string | null;
		secretName?: string | null;
		hostKind?: string | null;
		hostId?: string | null;
		metadata?: Record<string, unknown>;
	} | null;
	migratedTo?: 'github_actions_secret_enclave' | 'host_env_injection' | 'metadata_only_reentry' | null;
	tombstonedAt?: string | null;
	metadata?: Record<string, unknown>;
}

export interface ClientEncryptedEscrowEnvelopeInput extends ClientEncryptedEscrowMetadata {
	teamId?: string | null;
	projectId?: string | null;
	status?: ClientEncryptedEscrowStatus | string;
}

export interface ClientEncryptedEscrowStatusSummary {
	status: ClientEncryptedEscrowStatus | string;
	escrowed: boolean;
	migrated: boolean;
	expired: boolean;
	tombstoned: boolean;
	reentryRequired: boolean;
	migrationTarget?: string | null;
	expiresAt?: string | null;
}

export interface GitHubRepositoryGrantRecord {
	id: string;
	teamId: string;
	projectId?: string | null;
	repository: string;
	installationId?: string | null;
	accountLogin?: string | null;
	accountId?: string | null;
	status: GitHubRepositoryGrantStatus | string;
	permissions?: Record<string, unknown>;
	environments?: string[];
	driftCode?: SecretCapabilityFailClosedCode | string | null;
	observedAt?: string | null;
	revokedAt?: string | null;
	metadata?: Record<string, unknown>;
	createdAt?: string;
	updatedAt?: string;
}

export interface GitHubAppInstallationRecord {
	id: string;
	teamId: string;
	installationId: string;
	accountLogin?: string | null;
	accountId?: string | null;
	accountType?: string | null;
	status: GitHubAppInstallationStatus | string;
	permissions?: Record<string, unknown>;
	repositorySelection?: string | null;
	driftCode?: SecretCapabilityFailClosedCode | string | null;
	observedAt?: string | null;
	revokedAt?: string | null;
	suspendedAt?: string | null;
	metadata?: Record<string, unknown>;
	createdAt?: string;
	updatedAt?: string;
}
