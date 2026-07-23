


export const TREESEED_SECRET_CUSTODY_MODES = [
	'github_actions_secret_enclave',
	'client_encrypted_escrow',
	'metadata_only_reentry',
	'host_env_injection',
	'bootstrap_service_secret',
	'provider_owned_secret',
	'external_vault_reference',
] as const;

export const TREESEED_V1_REPOSITORY_CREDENTIAL_PROVIDERS = ['github-app'] as const;

export const TREESEED_SECRET_CLASSES = [
	'repository_access',
	'workflow_secret',
	'host_runtime_secret',
	'provider_runtime_secret',
	'bootstrap_service_secret',
	'customer_project_secret',
] as const;

export const TREESEED_PROVIDER_WORKSPACE_ACCESS_MODES = [
	'full_repository_workspace',
	'brokered_file_collection',
	'workflow_operation_only',
] as const;

export const TREESEED_WORKFLOW_OPERATION_DISPATCH_MODES = ['allowlisted'] as const;

export const TREESEED_SECRET_METADATA_RECORD_STATUSES = ['active', 'migrated', 'tombstoned', 'blocked'] as const;

export const TREESEED_GITHUB_REPOSITORY_GRANT_STATUSES = ['active', 'drifted', 'revoked', 'blocked'] as const;

export const TREESEED_GITHUB_APP_INSTALLATION_STATUSES = ['active', 'drifted', 'revoked', 'suspended', 'blocked'] as const;

export const TREESEED_GITHUB_APP_TOKEN_ISSUANCE_STATUSES = ['issued', 'expired', 'revoked', 'blocked'] as const;

export const TREESEED_WORKFLOW_OPERATION_RECORD_STATUSES = ['active', 'blocked', 'drifted', 'archived'] as const;

export const TREESEED_WORKFLOW_DISPATCH_RECORD_STATUSES = [
	'queued',
	'dispatched',
	'running',
	'succeeded',
	'failed',
	'cancelled',
	'blocked',
] as const;

export const TREESEED_TREEDX_CREDENTIAL_ISSUANCE_STATUSES = ['issued', 'expired', 'revoked', 'blocked'] as const;

export const TREESEED_TREEDX_CREDENTIAL_BRIDGE_OPERATIONS = [
	'clone',
	'fetch',
	'save',
	'commit',
	'push',
	'pull_request',
	'repository_update',
] as const;

export const TREESEED_SECRET_CAPABILITY_FAIL_CLOSED_CODES = [
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

export const TREESEED_CLIENT_ENCRYPTED_ESCROW_STATUSES = [
	'active',
	'migrated',
	'expired',
	'tombstoned',
	'reentry_required',
] as const;

export type TreeseedSecretCustodyMode = (typeof TREESEED_SECRET_CUSTODY_MODES)[number];

export type TreeseedV1RepositoryCredentialProvider = (typeof TREESEED_V1_REPOSITORY_CREDENTIAL_PROVIDERS)[number];

export type TreeseedSecretClass = (typeof TREESEED_SECRET_CLASSES)[number];

export type TreeseedProviderWorkspaceAccessMode = (typeof TREESEED_PROVIDER_WORKSPACE_ACCESS_MODES)[number];

export type TreeseedWorkflowOperationDispatchMode = (typeof TREESEED_WORKFLOW_OPERATION_DISPATCH_MODES)[number];

export type TreeseedSecretMetadataRecordStatus = (typeof TREESEED_SECRET_METADATA_RECORD_STATUSES)[number];

export type TreeseedGitHubRepositoryGrantStatus = (typeof TREESEED_GITHUB_REPOSITORY_GRANT_STATUSES)[number];

export type TreeseedGitHubAppInstallationStatus = (typeof TREESEED_GITHUB_APP_INSTALLATION_STATUSES)[number];

export type TreeseedGitHubAppTokenIssuanceStatus = (typeof TREESEED_GITHUB_APP_TOKEN_ISSUANCE_STATUSES)[number];

export type TreeseedWorkflowOperationRecordStatus = (typeof TREESEED_WORKFLOW_OPERATION_RECORD_STATUSES)[number];

export type TreeseedWorkflowDispatchRecordStatus = (typeof TREESEED_WORKFLOW_DISPATCH_RECORD_STATUSES)[number];

export type TreeseedTreeDxCredentialIssuanceStatus = (typeof TREESEED_TREEDX_CREDENTIAL_ISSUANCE_STATUSES)[number];

export type TreeseedTreeDxCredentialBridgeOperation = (typeof TREESEED_TREEDX_CREDENTIAL_BRIDGE_OPERATIONS)[number];

export type TreeseedSecretCapabilityFailClosedCode = (typeof TREESEED_SECRET_CAPABILITY_FAIL_CLOSED_CODES)[number];

export type TreeseedClientEncryptedEscrowStatus = (typeof TREESEED_CLIENT_ENCRYPTED_ESCROW_STATUSES)[number];

export type TreeseedSecretOwnerKind = 'customer' | 'treeseed' | 'provider';

export type TreeseedRepositoryAuthorityDefault = 'github-app' | 'github-actions-secret-enclave';

export type TreeseedGitHubSecretScope = 'repository' | 'environment';

export interface TreeseedSecretOwner {
	kind: TreeseedSecretOwnerKind | string;
	teamId?: string | null;
	projectId?: string | null;
	providerId?: string | null;
}

export interface TreeseedSecretMetadata {
	id: string;
	name: string;
	secretClass: TreeseedSecretClass | string;
	custodyMode: TreeseedSecretCustodyMode | string;
	owner: TreeseedSecretOwner;
	apiDecryptable?: boolean;
	plaintextAllowed?: boolean;
	metadata?: Record<string, unknown>;
}

export interface TreeseedSecretMetadataRecord extends TreeseedSecretMetadata {
	teamId: string;
	projectId?: string | null;
	status: TreeseedSecretMetadataRecordStatus | string;
	githubSecretTarget?: {
		repository?: string | null;
		environment?: string | null;
		secretName?: string | null;
		scope?: TreeseedGitHubSecretScope | string | null;
	} | null;
	escrowRecordId?: string | null;
	failClosedCode?: TreeseedSecretCapabilityFailClosedCode | string | null;
	createdAt?: string;
	updatedAt?: string;
	tombstonedAt?: string | null;
}

export interface TreeseedClientEncryptedEscrowMetadata {
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

export interface TreeseedClientEncryptedEscrowEnvelopeInput extends TreeseedClientEncryptedEscrowMetadata {
	teamId?: string | null;
	projectId?: string | null;
	status?: TreeseedClientEncryptedEscrowStatus | string;
}

export interface TreeseedClientEncryptedEscrowStatusSummary {
	status: TreeseedClientEncryptedEscrowStatus | string;
	escrowed: boolean;
	migrated: boolean;
	expired: boolean;
	tombstoned: boolean;
	reentryRequired: boolean;
	migrationTarget?: string | null;
	expiresAt?: string | null;
}

export interface TreeseedGitHubRepositoryGrantRecord {
	id: string;
	teamId: string;
	projectId?: string | null;
	repository: string;
	installationId?: string | null;
	accountLogin?: string | null;
	accountId?: string | null;
	status: TreeseedGitHubRepositoryGrantStatus | string;
	permissions?: Record<string, unknown>;
	environments?: string[];
	driftCode?: TreeseedSecretCapabilityFailClosedCode | string | null;
	observedAt?: string | null;
	revokedAt?: string | null;
	metadata?: Record<string, unknown>;
	createdAt?: string;
	updatedAt?: string;
}

export interface TreeseedGitHubAppInstallationRecord {
	id: string;
	teamId: string;
	installationId: string;
	accountLogin?: string | null;
	accountId?: string | null;
	accountType?: string | null;
	status: TreeseedGitHubAppInstallationStatus | string;
	permissions?: Record<string, unknown>;
	repositorySelection?: string | null;
	driftCode?: TreeseedSecretCapabilityFailClosedCode | string | null;
	observedAt?: string | null;
	revokedAt?: string | null;
	suspendedAt?: string | null;
	metadata?: Record<string, unknown>;
	createdAt?: string;
	updatedAt?: string;
}
