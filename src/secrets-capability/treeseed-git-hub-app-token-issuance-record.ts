
import { TreeseedClientEncryptedEscrowMetadata, TreeseedGitHubAppTokenIssuanceStatus, TreeseedGitHubSecretScope, TreeseedProviderWorkspaceAccessMode, TreeseedRepositoryAuthorityDefault, TreeseedSecretCapabilityFailClosedCode, TreeseedSecretClass, TreeseedTreeDxCredentialBridgeOperation, TreeseedTreeDxCredentialIssuanceStatus, TreeseedWorkflowDispatchRecordStatus, TreeseedWorkflowOperationDispatchMode, TreeseedWorkflowOperationRecordStatus } from './treeseed-secret-custody-modes.ts';

export interface TreeseedGitHubAppTokenIssuanceRecord {
	id: string;
	teamId: string;
	projectId?: string | null;
	assignmentId?: string | null;
	providerId?: string | null;
	workdayId?: string | null;
	operationId?: string | null;
	repository: string;
	installationId: string;
	status: TreeseedGitHubAppTokenIssuanceStatus | string;
	tokenPrefix?: string | null;
	tokenHash?: string | null;
	permissions?: Record<string, unknown>;
	allowedOperations?: string[];
	expiresAt?: string | null;
	issuedAt?: string | null;
	revokedAt?: string | null;
	failClosedCode?: TreeseedSecretCapabilityFailClosedCode | string | null;
	metadata?: Record<string, unknown>;
	createdAt?: string;
	updatedAt?: string;
}

export interface TreeseedWorkflowOperationRecord extends TreeseedWorkflowOperationContract {
	teamId: string;
	projectId?: string | null;
	status: TreeseedWorkflowOperationRecordStatus | string;
	failClosedCode?: TreeseedSecretCapabilityFailClosedCode | string | null;
	createdAt?: string;
	updatedAt?: string;
	blockedAt?: string | null;
}

export interface TreeseedWorkflowDispatchRecord {
	id: string;
	teamId: string;
	projectId?: string | null;
	workflowOperationId: string;
	platformOperationId?: string | null;
	repository: string;
	workflowFile: string;
	ref?: string | null;
	status: TreeseedWorkflowDispatchRecordStatus | string;
	inputs?: Record<string, unknown>;
	result?: Record<string, unknown> | null;
	failClosedCode?: TreeseedSecretCapabilityFailClosedCode | string | null;
	createdAt?: string;
	updatedAt?: string;
	dispatchedAt?: string | null;
	completedAt?: string | null;
}

export interface TreeseedTreeDxCredentialIssuanceRecord {
	id: string;
	teamId: string;
	projectId: string;
	assignmentId?: string | null;
	repository?: string | null;
	credentialProvider: 'github-app';
	status: TreeseedTreeDxCredentialIssuanceStatus | string;
	tokenPrefix?: string | null;
	tokenHash?: string | null;
	scopes?: string[];
	allowedOperations?: string[];
	expiresAt?: string | null;
	issuedAt?: string | null;
	revokedAt?: string | null;
	failClosedCode?: TreeseedSecretCapabilityFailClosedCode | string | null;
	metadata?: Record<string, unknown>;
	createdAt?: string;
	updatedAt?: string;
}

export interface TreeseedTreeDxCredentialBridgeRequest {
	teamId: string;
	projectId: string;
	repository: string;
	installationId?: string;
	operation: TreeseedTreeDxCredentialBridgeOperation | string;
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

export interface TreeseedTreeDxCredentialBridgeCredential {
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

export interface TreeseedGitHubAppRepositoryCredentialProviderConfig {
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

export interface TreeseedRepositoryCredentialProviderRegistry {
	githubApp?: TreeseedGitHubAppRepositoryCredentialProviderConfig;
}

export interface TreeseedGitHubActionsSecretStoreConfig {
	type: 'github-actions';
	defaultScope: TreeseedGitHubSecretScope;
	protectedEnvironments?: string[];
	requiredSecretNamePrefix?: string;
	allowRepositorySecrets?: boolean;
	allowEnvironmentSecrets?: boolean;
	metadata?: Record<string, unknown>;
}

export interface TreeseedGitHubActionsSecretPublicKeyMetadata {
	repository: string;
	scope: TreeseedGitHubSecretScope | string;
	environment?: string | null;
	keyId: string;
	key: string;
	observedAt?: string | null;
	metadata?: Record<string, unknown>;
}

export interface TreeseedGitHubActionsEncryptedSecretDeployment {
	secretId?: string | null;
	repository: string;
	scope: TreeseedGitHubSecretScope | string;
	environment?: string | null;
	secretName: string;
	encryptedValue: string;
	keyId: string;
	metadata?: Record<string, unknown>;
}

export interface TreeseedWorkflowOperationInputContract {
	name: string;
	required?: boolean;
	secretBearing?: boolean;
	allowedValues?: string[];
}

export interface TreeseedWorkflowOperationTrustPolicy {
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

export interface TreeseedTrustedExecutionSet {
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

export interface TreeseedWorkflowOperationContract {
	id: string;
	name: string;
	repository: string;
	workflowFile: string;
	secretBearing: boolean;
	trustedExecutionSetId: string;
	dispatch: {
		mode: TreeseedWorkflowOperationDispatchMode | string;
		arbitraryDispatch?: boolean;
	};
	inputs?: TreeseedWorkflowOperationInputContract[];
	secretClasses?: Array<TreeseedSecretClass | string>;
	providerSuppliedCommandsAllowed?: boolean;
	trustPolicy?: TreeseedWorkflowOperationTrustPolicy;
	metadata?: Record<string, unknown>;
}

export interface TreeseedWorkflowOperationsRegistry {
	trustedExecutionSets?: TreeseedTrustedExecutionSet[];
	operations?: TreeseedWorkflowOperationContract[];
}

export interface TreeseedClientEncryptedEscrowRegistry {
	enabled: boolean;
	defaultAlgorithm?: string;
	metadataRecords?: TreeseedClientEncryptedEscrowMetadata[];
	metadata?: Record<string, unknown>;
}

export interface TreeseedTreeDxCredentialBridgeConfig {
	enabled: boolean;
	credentialProvider: 'github-app';
	allowedOperations: Array<'clone' | 'fetch' | 'save' | 'commit' | 'push'>;
	tokenTtlSeconds?: number;
	metadata?: Record<string, unknown>;
}

export interface TreeseedSecretWrappingConfig {
	clientSideOnlyForCustomerProjectSecrets: boolean;
	teamRecoveryKeySupported?: boolean;
	metadata?: Record<string, unknown>;
}

export interface TreeseedRepositoryAuthorityDefaults {
	repositoryCredentialProvider: TreeseedRepositoryAuthorityDefault;
	secretStore: 'github-actions';
	workflowDispatch: 'allowlisted-github-actions';
	metadata?: Record<string, unknown>;
}

export interface TreeseedCapacityProviderWorkspaceDefaults {
	accessMode: TreeseedProviderWorkspaceAccessMode;
	receivesSecrets: false;
	receivesCredentialHandles: boolean;
	workflowOperationHandlesOnly?: boolean;
	metadata?: Record<string, unknown>;
}
