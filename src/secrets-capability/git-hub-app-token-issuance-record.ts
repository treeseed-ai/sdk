
import { ClientEncryptedEscrowMetadata, GitHubAppTokenIssuanceStatus, GitHubSecretScope, ProviderWorkspaceAccessMode, RepositoryAuthorityDefault, SecretCapabilityFailClosedCode, SecretClass, TreeDxCredentialBridgeOperation, TreeDxCredentialIssuanceStatus, WorkflowDispatchRecordStatus, WorkflowOperationDispatchMode, WorkflowOperationRecordStatus } from './secret-custody-modes.ts';

export interface GitHubAppTokenIssuanceRecord {
	id: string;
	teamId: string;
	projectId?: string | null;
	assignmentId?: string | null;
	providerId?: string | null;
	workdayId?: string | null;
	operationId?: string | null;
	repository: string;
	installationId: string;
	status: GitHubAppTokenIssuanceStatus | string;
	tokenPrefix?: string | null;
	tokenHash?: string | null;
	permissions?: Record<string, unknown>;
	allowedOperations?: string[];
	expiresAt?: string | null;
	issuedAt?: string | null;
	revokedAt?: string | null;
	failClosedCode?: SecretCapabilityFailClosedCode | string | null;
	metadata?: Record<string, unknown>;
	createdAt?: string;
	updatedAt?: string;
}

export interface WorkflowOperationRecord extends WorkflowOperationContract {
	teamId: string;
	projectId?: string | null;
	status: WorkflowOperationRecordStatus | string;
	failClosedCode?: SecretCapabilityFailClosedCode | string | null;
	createdAt?: string;
	updatedAt?: string;
	blockedAt?: string | null;
}

export interface WorkflowDispatchRecord {
	id: string;
	teamId: string;
	projectId?: string | null;
	workflowOperationId: string;
	platformOperationId?: string | null;
	repository: string;
	workflowFile: string;
	ref?: string | null;
	status: WorkflowDispatchRecordStatus | string;
	inputs?: Record<string, unknown>;
	result?: Record<string, unknown> | null;
	failClosedCode?: SecretCapabilityFailClosedCode | string | null;
	createdAt?: string;
	updatedAt?: string;
	dispatchedAt?: string | null;
	completedAt?: string | null;
}

export interface TreeDxCredentialIssuanceRecord {
	id: string;
	teamId: string;
	projectId: string;
	assignmentId?: string | null;
	repository?: string | null;
	credentialProvider: 'github-app';
	status: TreeDxCredentialIssuanceStatus | string;
	tokenPrefix?: string | null;
	tokenHash?: string | null;
	scopes?: string[];
	allowedOperations?: string[];
	expiresAt?: string | null;
	issuedAt?: string | null;
	revokedAt?: string | null;
	failClosedCode?: SecretCapabilityFailClosedCode | string | null;
	metadata?: Record<string, unknown>;
	createdAt?: string;
	updatedAt?: string;
}

export interface TreeDxCredentialBridgeRequest {
	teamId: string;
	projectId: string;
	repository: string;
	installationId?: string;
	operation: TreeDxCredentialBridgeOperation | string;
	credentialId?: string | null;
	ref?: string | null;
	paths?: string[];
	assignmentId?: string | null;
	providerId?: string | null;
	workdayId?: string | null;
	actor?: Record<string, unknown> | null;
	policy?: {
		allowedRefs?: string[];
		allowedPathPrefixes?: string[];
		requireAssignment?: boolean;
		requireProvider?: boolean;
		requireWorkday?: boolean;
	} | null;
	metadata?: Record<string, unknown>;
}

export interface TreeDxCredentialBridgeCredential {
	id: string;
	type: 'token';
	username: 'x-access-token' | string;
	token: string;
	expiresAt?: string | null;
	provider: 'github-app' | string;
	repository: string;
	allowedOperations: string[];
	issuanceId?: string | null;
}

export interface GitHubAppRepositoryCredentialProviderConfig {
	type: 'github-app';
	appIdEnv?: string;
	privateKeySecretRef?: string;
	webhookSecretRef?: string;
	installationSelection?: 'owner' | 'repository' | 'explicit';
	requiredPermissions?: {
		contents?: 'read' | 'write';
		metadata?: 'read';
		actions?: 'read' | 'write';
		secrets?: 'read' | 'write';
		environments?: 'read' | 'write';
		[key: string]: string | undefined;
	};
	metadata?: Record<string, unknown>;
}

export interface RepositoryCredentialProviderRegistry {
	githubApp?: GitHubAppRepositoryCredentialProviderConfig;
}

export interface GitHubActionsSecretStoreConfig {
	type: 'github-actions';
	defaultScope: GitHubSecretScope;
	protectedEnvironments?: string[];
	requiredSecretNamePrefix?: string;
	allowRepositorySecrets?: boolean;
	allowEnvironmentSecrets?: boolean;
	metadata?: Record<string, unknown>;
}

export interface GitHubActionsSecretPublicKeyMetadata {
	repository: string;
	scope: GitHubSecretScope | string;
	environment?: string | null;
	keyId: string;
	key: string;
	observedAt?: string | null;
	metadata?: Record<string, unknown>;
}

export interface GitHubActionsEncryptedSecretDeployment {
	secretId?: string | null;
	repository: string;
	scope: GitHubSecretScope | string;
	environment?: string | null;
	secretName: string;
	encryptedValue: string;
	keyId: string;
	metadata?: Record<string, unknown>;
}

export interface WorkflowOperationInputContract {
	name: string;
	required?: boolean;
	secretBearing?: boolean;
	allowedValues?: string[];
}

export interface WorkflowOperationTrustPolicy {
	protectedRefs?: string[];
	protectedEnvironments?: string[];
	allowedWorkflowFiles?: string[];
	artifactPolicy?: 'none' | 'metadata_only' | 'allowlisted';
	cachePolicy?: 'disabled' | 'metadata_only' | 'allowlisted';
	allowUntrustedCheckout?: boolean;
	allowLocalActions?: boolean;
	timeoutSeconds?: number;
	concurrencyGroup?: string | null;
	outputObservation?: 'status_only' | 'metadata_and_artifacts';
	cloudAccess?: {
		oidcPreferred?: boolean;
		longLivedSecrets?: boolean;
		diagnosticOnly?: boolean;
	} | null;
}

export interface TrustedExecutionSet {
	id: string;
	repository: string;
	protectedRefs: string[];
	protectedEnvironments?: string[];
	allowedWorkflowFiles: string[];
	allowProviderSuppliedCommands?: boolean;
	allowLocalActions?: boolean;
	allowUntrustedCheckout?: boolean;
	metadata?: Record<string, unknown>;
}

export interface WorkflowOperationContract {
	id: string;
	name: string;
	repository: string;
	workflowFile: string;
	secretBearing: boolean;
	trustedExecutionSetId: string;
	dispatch: {
		mode: WorkflowOperationDispatchMode | string;
		arbitraryDispatch?: boolean;
	};
	inputs?: WorkflowOperationInputContract[];
	secretClasses?: Array<SecretClass | string>;
	providerSuppliedCommandsAllowed?: boolean;
	trustPolicy?: WorkflowOperationTrustPolicy;
	metadata?: Record<string, unknown>;
}

export interface WorkflowOperationsRegistry {
	trustedExecutionSets?: TrustedExecutionSet[];
	operations?: WorkflowOperationContract[];
}

export interface ClientEncryptedEscrowRegistry {
	enabled: boolean;
	defaultAlgorithm?: string;
	metadataRecords?: ClientEncryptedEscrowMetadata[];
	metadata?: Record<string, unknown>;
}

export interface TreeDxCredentialBridgeConfig {
	enabled: boolean;
	credentialProvider: 'github-app';
	allowedOperations: Array<'clone' | 'fetch' | 'save' | 'commit' | 'push'>;
	tokenTtlSeconds?: number;
	metadata?: Record<string, unknown>;
}

export interface SecretWrappingConfig {
	clientSideOnlyForCustomerProjectSecrets: boolean;
	teamRecoveryKeySupported?: boolean;
	metadata?: Record<string, unknown>;
}

export interface RepositoryAuthorityDefaults {
	repositoryCredentialProvider: RepositoryAuthorityDefault;
	secretStore: 'github-actions';
	workflowDispatch: 'allowlisted-github-actions';
	metadata?: Record<string, unknown>;
}

export interface CapacityProviderWorkspaceDefaults {
	accessMode: ProviderWorkspaceAccessMode;
	receivesSecrets: false;
	receivesCredentialHandles: boolean;
	workflowOperationHandlesOnly?: boolean;
	metadata?: Record<string, unknown>;
}
