export const SERVICE_VAULT_ENCRYPTION_VERSION = 'service-vault-v1' as const;
export const SERVICE_VAULT_AEAD_ALGORITHM = 'xchacha20-poly1305-ietf' as const;
export const SERVICE_VAULT_KEY_AGREEMENT = 'x25519-sealed-box' as const;
export const SERVICE_VAULT_KDF = 'argon2id' as const;

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
	purpose: 'provider-connection-validation' | 'remote-git-publication' | 'workflow-dispatch' | 'workflow-configuration';
	resourceScope: Record<string, string>;
	credentialProfileId: string;
	actorUserId: string;
	requiredFields: string[];
	publicKey: string;
	status: 'awaiting-runner' | 'pending' | 'ready' | 'consumed' | 'expired' | 'cancelled' | 'failed';
	expiresAt: string;
	consumedAt?: string | null;
	operationCorrelationId: string;
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

export function validateEncryptedCredentialEnvelope(value: unknown): value is EncryptedCredentialEnvelope {
	if (!value || typeof value !== 'object') return false;
	const envelope = value as Partial<EncryptedCredentialEnvelope>;
	return envelope.version === SERVICE_VAULT_ENCRYPTION_VERSION
		&& envelope.algorithm === SERVICE_VAULT_AEAD_ALGORITHM
		&& [envelope.ciphertext, envelope.nonce, envelope.wrappedKey, envelope.wrappedKeyNonce, envelope.associatedData, envelope.associatedDataDigest, envelope.fingerprint]
			.every((field) => typeof field === 'string' && field.length > 0);
}
