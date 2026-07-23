
import { TreeseedCapacityProviderWorkspaceDefaults, TreeseedClientEncryptedEscrowRegistry, TreeseedGitHubActionsSecretStoreConfig, TreeseedRepositoryAuthorityDefaults, TreeseedRepositoryCredentialProviderRegistry, TreeseedSecretWrappingConfig, TreeseedTreeDxCredentialBridgeConfig, TreeseedWorkflowOperationsRegistry } from './treeseed-git-hub-app-token-issuance-record.ts';
import { TREESEED_SECRET_CUSTODY_MODES, TREESEED_V1_REPOSITORY_CREDENTIAL_PROVIDERS, TreeseedClientEncryptedEscrowEnvelopeInput, TreeseedClientEncryptedEscrowMetadata, TreeseedSecretCustodyMode, TreeseedSecretMetadata, TreeseedV1RepositoryCredentialProvider } from './treeseed-secret-custody-modes.ts';

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

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function stringArrayIncludes(values: readonly string[], value: unknown): value is string {
	return typeof value === 'string' && values.includes(value);
}

export function addProblem(
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
