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
	installationId: string;
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

export interface TreeseedSecretsCapabilityRegistry {
	repositoryCredentialProviders: TreeseedRepositoryCredentialProviderRegistry;
	githubActionsSecretStore?: TreeseedGitHubActionsSecretStoreConfig;
	workflowOperations?: TreeseedWorkflowOperationsRegistry;
	clientEncryptedEscrow?: TreeseedClientEncryptedEscrowRegistry;
	treeDxCredentialBridge?: TreeseedTreeDxCredentialBridgeConfig;
	secretWrapping?: TreeseedSecretWrappingConfig;
	repositoryAuthorityDefaults?: TreeseedRepositoryAuthorityDefaults;
	capacityProviderWorkspaceDefaults?: TreeseedCapacityProviderWorkspaceDefaults;
	secrets?: TreeseedSecretMetadata[];
}

export interface TreeseedSecretsCapabilityRegistryProblem {
	path: string;
	code:
		| 'unsupported_repository_credential_provider'
		| 'api_decryptable_customer_secret'
		| 'arbitrary_secret_workflow_dispatch'
		| 'provider_secret_delegation'
		| 'plaintext_escrow_material'
		| 'invalid_secret_custody_target'
		| 'invalid_registry';
	message: string;
}

export interface TreeseedSecretsCapabilityRegistryValidation {
	ok: boolean;
	problems: TreeseedSecretsCapabilityRegistryProblem[];
	registry: TreeseedSecretsCapabilityRegistry | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArrayIncludes(values: readonly string[], value: unknown): value is string {
	return typeof value === 'string' && values.includes(value);
}

function addProblem(
	problems: TreeseedSecretsCapabilityRegistryProblem[],
	path: string,
	code: TreeseedSecretsCapabilityRegistryProblem['code'],
	message: string,
) {
	problems.push({ path, code, message });
}

export function containsTreeseedPlaintextSecretMaterial(value: unknown): boolean {
	if (!isRecord(value)) return false;
	const forbiddenKeys = new Set([
		'plaintext',
		'plainText',
		'value',
		'raw',
		'rawSecret',
		'secretValue',
		'unencrypted',
		'token',
		'accessToken',
		'privateKey',
		'sshPrivateKey',
		'passphrase',
		'password',
		'derivedKey',
		'decrypted',
		'decryptedPayload',
		'decryptedSecret',
	]);
	for (const [key, nested] of Object.entries(value)) {
		if (forbiddenKeys.has(key)) return true;
		if (isRecord(nested) && containsTreeseedPlaintextSecretMaterial(nested)) return true;
	}
	return false;
}

export function isTreeseedSecretCustodyMode(value: unknown): value is TreeseedSecretCustodyMode {
	return stringArrayIncludes(TREESEED_SECRET_CUSTODY_MODES, value);
}

export function isTreeseedV1RepositoryCredentialProvider(
	value: unknown,
): value is TreeseedV1RepositoryCredentialProvider {
	return stringArrayIncludes(TREESEED_V1_REPOSITORY_CREDENTIAL_PROVIDERS, value);
}

export function requiresClientSideSecretMaterial(mode: TreeseedSecretCustodyMode | string): boolean {
	return mode === 'client_encrypted_escrow';
}

export function isApiServiceDecryptableCustomerSecret(metadata: Pick<TreeseedSecretMetadata, 'owner' | 'apiDecryptable'>): boolean {
	return metadata.owner?.kind === 'customer' && metadata.apiDecryptable === true;
}

export function validateTreeseedWritableSecretMetadata(
	input: unknown,
	path = '$',
): TreeseedSecretsCapabilityRegistryProblem[] {
	const problems: TreeseedSecretsCapabilityRegistryProblem[] = [];
	if (!isRecord(input)) {
		addProblem(problems, path, 'invalid_registry', 'Secret metadata must be an object.');
		return problems;
	}
	const metadata = input as unknown as TreeseedSecretMetadata;
	if (isApiServiceDecryptableCustomerSecret(metadata)) {
		addProblem(
			problems,
			`${path}.apiDecryptable`,
			'api_decryptable_customer_secret',
			'Customer project secrets must not be decryptable by the TreeSeed API service.',
		);
	}
	if (metadata.owner?.kind === 'customer' && metadata.plaintextAllowed === true) {
		addProblem(
			problems,
			`${path}.plaintextAllowed`,
			'api_decryptable_customer_secret',
			'Customer project secrets must not allow plaintext persistence.',
		);
	}
	if (containsTreeseedPlaintextSecretMaterial(input)) {
		addProblem(
			problems,
			path,
			'plaintext_escrow_material',
			'Secret metadata must not include plaintext secret material.',
		);
	}
	if (metadata.custodyMode === 'client_encrypted_escrow') {
		const hasEscrowReference = typeof (input as { escrowRecordId?: unknown }).escrowRecordId === 'string'
			|| typeof (input as { escrow_record_id?: unknown }).escrow_record_id === 'string';
		if (!hasEscrowReference) {
			addProblem(
				problems,
				path,
				'invalid_secret_custody_target',
				'Client-encrypted escrow secret metadata must reference an escrow record.',
			);
		}
	}
	if (metadata.custodyMode === 'github_actions_secret_enclave') {
		const target = (input as { githubSecretTarget?: unknown; github_secret_target?: unknown }).githubSecretTarget
			?? (input as { githubSecretTarget?: unknown; github_secret_target?: unknown }).github_secret_target;
		if (!isRecord(target)) {
			addProblem(
				problems,
				path,
				'invalid_secret_custody_target',
				'GitHub Actions secret enclave metadata must include a GitHub secret target.',
			);
		}
	}
	return problems;
}

export function assertTreeseedWritableSecretMetadata(input: unknown): TreeseedSecretMetadata {
	const problems = validateTreeseedWritableSecretMetadata(input);
	if (problems.length > 0) {
		const message = problems.map((problem) => `${problem.path}: ${problem.message}`).join('\n');
		throw new Error(`Invalid Treeseed secret metadata.\n${message}`);
	}
	return input as TreeseedSecretMetadata;
}

export function validateTreeseedClientEncryptedEscrowMetadata(
	input: unknown,
	path = '$',
): TreeseedSecretsCapabilityRegistryProblem[] {
	const problems: TreeseedSecretsCapabilityRegistryProblem[] = [];
	if (!isRecord(input)) {
		addProblem(problems, path, 'invalid_registry', 'Client-encrypted escrow metadata must be an object.');
		return problems;
	}
	if (containsTreeseedPlaintextSecretMaterial(input)) {
		addProblem(
			problems,
			path,
			'plaintext_escrow_material',
			'Client-encrypted escrow records must contain ciphertext metadata only.',
		);
	}
	if (typeof input.ciphertextRef !== 'string' || !input.ciphertextRef.trim()) {
		addProblem(
			problems,
			`${path}.ciphertextRef`,
			'invalid_secret_custody_target',
			'Client-encrypted escrow records must include a ciphertext reference.',
		);
	}
	const hasInlineCiphertext = typeof input.ciphertext === 'string' && input.ciphertext.trim();
	if (hasInlineCiphertext) {
		for (const key of ['algorithm', 'nonce', 'salt', 'kdf', 'wrappingKeyId', 'encryptionVersion']) {
			if (typeof input[key] !== 'string' || !String(input[key]).trim()) {
				addProblem(
					problems,
					`${path}.${key}`,
					'invalid_secret_custody_target',
					`Inline client-encrypted escrow envelopes must include ${key}.`,
				);
			}
		}
		if (!isRecord(input.kdfParams)) {
			addProblem(
				problems,
				`${path}.kdfParams`,
				'invalid_secret_custody_target',
				'Inline client-encrypted escrow envelopes must include KDF parameters.',
			);
		}
	}
	if (isRecord(input.deploymentIntent)) {
		const targetMode = input.deploymentIntent.targetMode;
		if (targetMode !== undefined && ![
			'github_actions_secret_enclave',
			'host_env_injection',
			'metadata_only_reentry',
		].includes(String(targetMode))) {
			addProblem(
				problems,
				`${path}.deploymentIntent.targetMode`,
				'invalid_secret_custody_target',
				'Client-encrypted escrow deployment intent must target GitHub Secrets, host injection, or metadata-only re-entry.',
			);
		}
	}
	return problems;
}

export function assertTreeseedClientEncryptedEscrowMetadata(input: unknown): TreeseedClientEncryptedEscrowMetadata {
	const problems = validateTreeseedClientEncryptedEscrowMetadata(input);
	if (problems.length > 0) {
		const message = problems.map((problem) => `${problem.path}: ${problem.message}`).join('\n');
		throw new Error(`Invalid Treeseed client-encrypted escrow metadata.\n${message}`);
	}
	return input as TreeseedClientEncryptedEscrowMetadata;
}

export function buildTreeseedClientEncryptedEscrowEnvelope(
	input: TreeseedClientEncryptedEscrowEnvelopeInput,
): TreeseedClientEncryptedEscrowEnvelopeInput {
	return assertTreeseedClientEncryptedEscrowMetadata({
		...input,
		metadata: input.metadata ?? {},
	}) as TreeseedClientEncryptedEscrowEnvelopeInput;
}

export function summarizeTreeseedClientEncryptedEscrowStatus(
	input: Pick<TreeseedClientEncryptedEscrowEnvelopeInput, 'status' | 'expiresAt' | 'migratedTo' | 'tombstonedAt'>,
	now: Date = new Date(),
): TreeseedClientEncryptedEscrowStatusSummary {
	const expired = Boolean(input.expiresAt && Date.parse(input.expiresAt) <= now.getTime());
	const tombstoned = Boolean(input.tombstonedAt) || input.status === 'tombstoned';
	const migrated = Boolean(input.migratedTo) || input.status === 'migrated';
	const reentryRequired = input.status === 'reentry_required' || (expired && !migrated && !tombstoned);
	const status = tombstoned
		? 'tombstoned'
		: migrated
			? 'migrated'
			: reentryRequired
				? 'reentry_required'
				: expired
					? 'expired'
					: input.status ?? 'active';
	return {
		status,
		escrowed: !migrated && !tombstoned,
		migrated,
		expired,
		tombstoned,
		reentryRequired,
		migrationTarget: input.migratedTo ?? null,
		expiresAt: input.expiresAt ?? null,
	};
}

export function summarizeTreeseedWorkflowCloudAccessDiagnostics(
	operation: Pick<TreeseedWorkflowOperationContract, 'secretBearing' | 'trustPolicy' | 'metadata'>,
): Array<{ code: 'oidc_preferred_for_cloud_access'; severity: 'warning'; message: string }> {
	const trustPolicy = isRecord(operation.trustPolicy)
		? operation.trustPolicy
		: isRecord(operation.metadata) && isRecord(operation.metadata.trustPolicy)
			? operation.metadata.trustPolicy
			: {};
	const cloudAccess = isRecord(trustPolicy.cloudAccess) ? trustPolicy.cloudAccess : {};
	if (operation.secretBearing === true && cloudAccess.longLivedSecrets === true && cloudAccess.oidcPreferred !== true) {
		return [{
			code: 'oidc_preferred_for_cloud_access',
			severity: 'warning',
			message: 'Secret-bearing cloud workflows should prefer GitHub OIDC over long-lived cloud API keys when the target cloud supports it.',
		}];
	}
	return [];
}

export function validateTreeseedGitHubActionsEncryptedSecretDeployment(
	input: unknown,
	path = '$',
): TreeseedSecretsCapabilityRegistryProblem[] {
	const problems: TreeseedSecretsCapabilityRegistryProblem[] = [];
	if (!isRecord(input)) {
		addProblem(problems, path, 'invalid_registry', 'GitHub Actions encrypted secret deployment must be an object.');
		return problems;
	}
	if (containsTreeseedPlaintextSecretMaterial(input)) {
		addProblem(
			problems,
			path,
			'plaintext_escrow_material',
			'GitHub Actions secret deployment payloads must contain GitHub-encrypted values only.',
		);
	}
	for (const key of ['repository', 'scope', 'secretName', 'encryptedValue', 'keyId']) {
		if (typeof input[key] !== 'string' || !String(input[key]).trim()) {
			addProblem(
				problems,
				`${path}.${key}`,
				'invalid_secret_custody_target',
				`GitHub Actions encrypted secret deployment must include ${key}.`,
			);
		}
	}
	if (input.scope === 'environment' && (typeof input.environment !== 'string' || !input.environment.trim())) {
		addProblem(
			problems,
			`${path}.environment`,
			'invalid_secret_custody_target',
			'GitHub environment secret deployment must include an environment.',
		);
	}
	return problems;
}

export function assertTreeseedGitHubActionsEncryptedSecretDeployment(input: unknown): TreeseedGitHubActionsEncryptedSecretDeployment {
	const problems = validateTreeseedGitHubActionsEncryptedSecretDeployment(input);
	if (problems.length > 0) {
		const message = problems.map((problem) => `${problem.path}: ${problem.message}`).join('\n');
		throw new Error(`Invalid Treeseed GitHub Actions encrypted secret deployment.\n${message}`);
	}
	return input as TreeseedGitHubActionsEncryptedSecretDeployment;
}

export function validateTreeseedSecretsCapabilityRegistry(
	input: unknown,
): TreeseedSecretsCapabilityRegistryValidation {
	const problems: TreeseedSecretsCapabilityRegistryProblem[] = [];
	if (!isRecord(input)) {
		addProblem(problems, '$', 'invalid_registry', 'Secrets capability registry must be an object.');
		return { ok: false, problems, registry: null };
	}

	const registry = input as unknown as TreeseedSecretsCapabilityRegistry;
	const repositoryCredentialProviders = isRecord(input.repositoryCredentialProviders)
		? input.repositoryCredentialProviders
		: {};

	for (const key of Object.keys(repositoryCredentialProviders)) {
		if (key !== 'githubApp') {
			addProblem(
				problems,
				`repositoryCredentialProviders.${key}`,
				'unsupported_repository_credential_provider',
				'Only GitHub App repository credential providers are supported in v1.',
			);
		}
	}

	const githubApp = repositoryCredentialProviders.githubApp;
	if (githubApp !== undefined && isRecord(githubApp) && githubApp.type !== 'github-app') {
		addProblem(
			problems,
			'repositoryCredentialProviders.githubApp.type',
			'unsupported_repository_credential_provider',
			'GitHub App provider config must use type "github-app".',
		);
	}

	const secrets = Array.isArray(input.secrets) ? input.secrets : [];
	secrets.forEach((secret, index) => {
		if (!isRecord(secret)) return;
		problems.push(...validateTreeseedWritableSecretMetadata(secret, `secrets.${index}`));
	});

	const operations = isRecord(input.workflowOperations) && Array.isArray(input.workflowOperations.operations)
		? input.workflowOperations.operations
		: [];
	operations.forEach((operation, index) => {
		if (!isRecord(operation)) return;
		const dispatch = isRecord(operation.dispatch) ? operation.dispatch : {};
		if (
			operation.secretBearing === true
			&& (dispatch.mode !== 'allowlisted' || dispatch.arbitraryDispatch === true)
		) {
			addProblem(
				problems,
				`workflowOperations.operations.${index}.dispatch`,
				'arbitrary_secret_workflow_dispatch',
				'Secret-bearing workflow operations must use allowlisted dispatch only.',
			);
		}
		if (operation.secretBearing === true && operation.providerSuppliedCommandsAllowed === true) {
			addProblem(
				problems,
				`workflowOperations.operations.${index}.providerSuppliedCommandsAllowed`,
				'arbitrary_secret_workflow_dispatch',
				'Secret-bearing workflow operations must not run provider-supplied commands.',
			);
		}
		const trustPolicy = isRecord(operation.trustPolicy)
			? operation.trustPolicy
			: isRecord(operation.metadata) && isRecord(operation.metadata.trustPolicy)
				? operation.metadata.trustPolicy
				: {};
		if (operation.secretBearing === true) {
			if (!Array.isArray(trustPolicy.protectedRefs) || trustPolicy.protectedRefs.length === 0) {
				addProblem(
					problems,
					`workflowOperations.operations.${index}.trustPolicy.protectedRefs`,
					'arbitrary_secret_workflow_dispatch',
					'Secret-bearing workflow operations must declare protected refs.',
				);
			}
			if (!Array.isArray(trustPolicy.allowedWorkflowFiles) || trustPolicy.allowedWorkflowFiles.length === 0) {
				addProblem(
					problems,
					`workflowOperations.operations.${index}.trustPolicy.allowedWorkflowFiles`,
					'arbitrary_secret_workflow_dispatch',
					'Secret-bearing workflow operations must declare allowlisted workflow files.',
				);
			}
			if (trustPolicy.allowUntrustedCheckout === true) {
				addProblem(
					problems,
					`workflowOperations.operations.${index}.trustPolicy.allowUntrustedCheckout`,
					'arbitrary_secret_workflow_dispatch',
					'Secret-bearing workflow operations must not run untrusted branch code.',
				);
			}
			if (trustPolicy.allowLocalActions === true) {
				addProblem(
					problems,
					`workflowOperations.operations.${index}.trustPolicy.allowLocalActions`,
					'arbitrary_secret_workflow_dispatch',
					'Secret-bearing workflow operations must not execute repository-local actions unless a future trusted action scanner is implemented.',
				);
			}
			if (trustPolicy.artifactPolicy !== undefined && !['none', 'metadata_only'].includes(String(trustPolicy.artifactPolicy))) {
				addProblem(
					problems,
					`workflowOperations.operations.${index}.trustPolicy.artifactPolicy`,
					'arbitrary_secret_workflow_dispatch',
					'Secret-bearing workflow operations may only expose no artifacts or metadata-only artifact observations in v1.',
				);
			}
			if (trustPolicy.cachePolicy !== undefined && !['disabled', 'metadata_only'].includes(String(trustPolicy.cachePolicy))) {
				addProblem(
					problems,
					`workflowOperations.operations.${index}.trustPolicy.cachePolicy`,
					'arbitrary_secret_workflow_dispatch',
					'Secret-bearing workflow operations may only disable cache use or expose metadata-only cache observations in v1.',
				);
			}
		}
	});

	const trustedExecutionSets = isRecord(input.workflowOperations) && Array.isArray(input.workflowOperations.trustedExecutionSets)
		? input.workflowOperations.trustedExecutionSets
		: [];
	trustedExecutionSets.forEach((executionSet, index) => {
		if (!isRecord(executionSet)) return;
		if (executionSet.allowProviderSuppliedCommands === true) {
			addProblem(
				problems,
				`workflowOperations.trustedExecutionSets.${index}.allowProviderSuppliedCommands`,
				'arbitrary_secret_workflow_dispatch',
				'Trusted execution sets must not allow provider-supplied commands in v1.',
			);
		}
		if (executionSet.allowLocalActions === true) {
			addProblem(
				problems,
				`workflowOperations.trustedExecutionSets.${index}.allowLocalActions`,
				'arbitrary_secret_workflow_dispatch',
				'Trusted execution sets for secret-bearing operations must not allow repository-local actions in v1.',
			);
		}
		if (executionSet.allowUntrustedCheckout === true) {
			addProblem(
				problems,
				`workflowOperations.trustedExecutionSets.${index}.allowUntrustedCheckout`,
				'arbitrary_secret_workflow_dispatch',
				'Trusted execution sets for secret-bearing operations must not allow untrusted branch checkout in v1.',
			);
		}
	});

	if (isRecord(input.capacityProviderWorkspaceDefaults)) {
		if (input.capacityProviderWorkspaceDefaults.receivesSecrets !== false) {
			addProblem(
				problems,
				'capacityProviderWorkspaceDefaults.receivesSecrets',
				'provider_secret_delegation',
				'Capacity providers must receive handles or workspace access, not customer secrets.',
			);
		}
		if (input.capacityProviderWorkspaceDefaults.directSecretDelegation === true) {
			addProblem(
				problems,
				'capacityProviderWorkspaceDefaults.directSecretDelegation',
				'provider_secret_delegation',
				'Direct provider/customer secret delegation is not supported.',
			);
		}
	}

	if (isRecord(input.clientEncryptedEscrow) && Array.isArray(input.clientEncryptedEscrow.metadataRecords)) {
		input.clientEncryptedEscrow.metadataRecords.forEach((record, index) => {
			problems.push(...validateTreeseedClientEncryptedEscrowMetadata(record, `clientEncryptedEscrow.metadataRecords.${index}`));
		});
	}

	return { ok: problems.length === 0, problems, registry: registry };
}

export function assertTreeseedSecretsCapabilityRegistry(input: unknown): TreeseedSecretsCapabilityRegistry {
	const validation = validateTreeseedSecretsCapabilityRegistry(input);
	if (!validation.ok || validation.registry === null) {
		const message = validation.problems.map((problem) => `${problem.path}: ${problem.message}`).join('\n');
		throw new Error(`Invalid Treeseed secrets capability registry.\n${message}`);
	}
	return validation.registry;
}
