export const SERVICE_VAULT_ENCRYPTION_VERSION = 'service-vault-v1' as const;
export const SERVICE_VAULT_AEAD_ALGORITHM = 'xchacha20-poly1305-ietf' as const;
export const SERVICE_VAULT_KEY_AGREEMENT = 'x25519-sealed-box' as const;
export const SERVICE_VAULT_KDF = 'argon2id' as const;
export const SECRET_OPERATION_PURPOSES = [
	'provider-connection-validation',
	'remote-git-publication',
	'workflow-dispatch',
	'workflow-configuration',
	'hosted-topology-plan',
	'hosted-topology-apply',
	'hosted-topology-readback',
	'hosted-topology-rollback',
] as const;

export type SecretOperationPurpose = (typeof SECRET_OPERATION_PURPOSES)[number];
export type HostedSecretOperationPurpose = Extract<SecretOperationPurpose, `hosted-topology-${string}`>;

export type EncryptedCredentialEnvelope = {
	version: typeof SERVICE_VAULT_ENCRYPTION_VERSION;
	algorithm: typeof SERVICE_VAULT_AEAD_ALGORITHM;
	ciphertext: string;
	nonce: string;
	wrappedKey: string;
	wrappedKeyNonce: string;
	associatedData: string;
	associatedDataDigest: string;
	fingerprint: string;
};

export type EncryptedPrivateKeyEnvelope = {
	version: typeof SERVICE_VAULT_ENCRYPTION_VERSION;
	algorithm: typeof SERVICE_VAULT_AEAD_ALGORITHM;
	kdf: {
		algorithm: typeof SERVICE_VAULT_KDF;
		opsLimit: number;
		memLimit: number;
		salt: string;
	};
	nonce: string;
	ciphertext: string;
	publicKey: string;
};

export type TeamVaultGrantEnvelope = {
	version: typeof SERVICE_VAULT_ENCRYPTION_VERSION;
	algorithm: typeof SERVICE_VAULT_KEY_AGREEMENT;
	recipientPublicKey: string;
	wrappedTeamVaultKey: string;
};

export type SecretOperationLease = {
	id: string;
	teamId: string;
	connectionId: string;
	capabilityType: string;
	purpose: SecretOperationPurpose;
	resourceScope: Record<string, string>;
	credentialProfileId: string;
	actorUserId: string;
	requiredFields: string[];
	publicKey: string;
	status: 'awaiting-runner' | 'pending' | 'ready' | 'consumed' | 'expired' | 'cancelled' | 'failed';
	expiresAt: string;
	consumedAt?: string | null;
	operationCorrelationId: string;
	hostedBinding?: HostedSecretOperationBinding;
	authorityRequests?: SecretOperationAuthorityRequest[];
};

export type HostedSecretOperationBinding = {
	subjectType: 'declaration' | 'plan' | 'rollback';
	subjectDigest: string;
	deploymentId: string;
	stackId: string;
	environment: 'staging' | 'production';
};

export type SecretOperationAuthorityRequest = {
	requestId: string;
	connectionId: string;
	credentialProfileId: string;
	provider: 'cloudflare' | 'railway' | 'treeseed';
	purpose: 'provider' | 'state-backend' | 'state-encryption';
	capabilities: string[];
	requiredFields: string[];
	secretRef?: string;
};

export type SealedSecretOperationPayload = {
	schemaVersion: 'treeseed.sealed-secret-operation-payload/v1';
	leaseId: string;
	teamId: string;
	operationCorrelationId: string;
	hostedBinding: HostedSecretOperationBinding;
	algorithm: typeof SERVICE_VAULT_KEY_AGREEMENT;
	ciphertext: string;
};

export type SecretOperationCredentialBundle = {
	schemaVersion: 'treeseed.secret-operation-credential-bundle/v1';
	leaseId: string;
	teamId: string;
	operationCorrelationId: string;
	hostedBinding: HostedSecretOperationBinding;
	materials: Array<{
		requestId: string;
		connectionId: string;
		credentialProfileId: string;
		values: Record<string, string>;
	}>;
};

export type ServiceVaultAssociatedData = {
	teamId: string;
	connectionId: string;
	credentialProfileId: string;
	field: string;
	purpose: string;
	version: number;
};

const FORBIDDEN_SECRET_KEYS = /(?:passphrase|password|plaintext|derivedKey|privateKey|apiToken|accessToken|secretValue|credentialValue)$/iu;

export function containsForbiddenPlaintextSecretMaterial(value: unknown, path = ''): string[] {
	if (!value || typeof value !== 'object') return [];
	const failures: string[] = [];
	for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
		const nextPath = path ? `${path}.${key}` : key;
		if (FORBIDDEN_SECRET_KEYS.test(key) && typeof entry === 'string' && entry.trim()) failures.push(nextPath);
		if (entry && typeof entry === 'object') failures.push(...containsForbiddenPlaintextSecretMaterial(entry, nextPath));
	}
	return failures;
}

export function canonicalServiceVaultAssociatedData(input: ServiceVaultAssociatedData): string {
	return JSON.stringify({
		teamId: input.teamId,
		connectionId: input.connectionId,
		credentialProfileId: input.credentialProfileId,
		field: input.field,
		purpose: input.purpose,
		version: input.version,
	});
}

const digest = /^sha256:[a-f0-9]{64}$/u;
const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

export function canonicalHostedSecretOperationBinding(input: HostedSecretOperationBinding): string {
	return JSON.stringify({
		subjectType: input.subjectType,
		subjectDigest: input.subjectDigest,
		deploymentId: input.deploymentId,
		stackId: input.stackId,
		environment: input.environment,
	});
}

export function validateHostedSecretOperationBinding(value: unknown): value is HostedSecretOperationBinding {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const binding = value as Partial<HostedSecretOperationBinding>;
	return ['declaration', 'plan', 'rollback'].includes(String(binding.subjectType))
		&& digest.test(String(binding.subjectDigest))
		&& identifier.test(String(binding.deploymentId))
		&& identifier.test(String(binding.stackId))
		&& ['staging', 'production'].includes(String(binding.environment));
}

export function validateSealedSecretOperationPayload(value: unknown): value is SealedSecretOperationPayload {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const payload = value as Partial<SealedSecretOperationPayload>;
	return payload.schemaVersion === 'treeseed.sealed-secret-operation-payload/v1'
		&& payload.algorithm === SERVICE_VAULT_KEY_AGREEMENT
		&& [payload.leaseId, payload.teamId, payload.operationCorrelationId, payload.ciphertext]
			.every((field) => typeof field === 'string' && field.length > 0)
		&& validateHostedSecretOperationBinding(payload.hostedBinding);
}

export function validateEncryptedCredentialEnvelope(value: unknown): value is EncryptedCredentialEnvelope {
	if (!value || typeof value !== 'object') return false;
	const envelope = value as Partial<EncryptedCredentialEnvelope>;
	return envelope.version === SERVICE_VAULT_ENCRYPTION_VERSION
		&& envelope.algorithm === SERVICE_VAULT_AEAD_ALGORITHM
		&& [envelope.ciphertext, envelope.nonce, envelope.wrappedKey, envelope.wrappedKeyNonce, envelope.associatedData, envelope.associatedDataDigest, envelope.fingerprint]
			.every((field) => typeof field === 'string' && field.length > 0);
}
