import sodium from 'libsodium-wrappers-sumo';
import {
	SERVICE_VAULT_AEAD_ALGORITHM,
	SERVICE_VAULT_ENCRYPTION_VERSION,
	SERVICE_VAULT_KDF,
	SERVICE_VAULT_KEY_AGREEMENT,
	type EncryptedCredentialEnvelope,
	type EncryptedPrivateKeyEnvelope,
	type TeamVaultGrantEnvelope,
} from '@treeseed/sdk/secrets-capability';

const b64 = () => sodium.base64_variants.ORIGINAL;
const encode = (value: Uint8Array) => sodium.to_base64(value, b64());
const decode = (value: string) => sodium.from_base64(value, b64());
const hash = (value: Uint8Array | string, key: Uint8Array | null = null) => encode(sodium.crypto_generichash(32, value, key));

async function ready() { await sodium.ready; return sodium; }

function validKey(value: Uint8Array, length: number, label: string) {
	if (!(value instanceof Uint8Array) || value.length !== length) throw new Error(`${label} is invalid.`);
	return value;
}

export async function createServiceVaultKey(): Promise<Uint8Array> {
	const crypto = await ready();
	return crypto.randombytes_buf(crypto.crypto_aead_xchacha20poly1305_ietf_KEYBYTES);
}

export async function createServiceVaultUserKeyPair(): Promise<{ publicKey: string; privateKey: Uint8Array }> {
	const crypto = await ready(), pair = crypto.crypto_box_keypair();
	return { publicKey: encode(pair.publicKey), privateKey: pair.privateKey };
}

export async function encryptServiceVaultPrivateKey(
	privateKey: Uint8Array, publicKey: string, passphrase: string,
	options: { opsLimit?: number; memLimit?: number } = {},
): Promise<EncryptedPrivateKeyEnvelope> {
	const crypto = await ready();
	validKey(privateKey, crypto.crypto_box_SECRETKEYBYTES, 'Service-vault private key');
	validKey(decode(publicKey), crypto.crypto_box_PUBLICKEYBYTES, 'Service-vault public key');
	if (passphrase.length < 12) throw new Error('Service-vault passphrase must contain at least 12 characters.');
	const salt = crypto.randombytes_buf(crypto.crypto_pwhash_SALTBYTES);
	const opsLimit = options.opsLimit ?? crypto.crypto_pwhash_OPSLIMIT_MODERATE;
	const memLimit = options.memLimit ?? crypto.crypto_pwhash_MEMLIMIT_MODERATE;
	const key = crypto.crypto_pwhash(crypto.crypto_aead_xchacha20poly1305_ietf_KEYBYTES, passphrase, salt,
		opsLimit, memLimit, crypto.crypto_pwhash_ALG_ARGON2ID13);
	const nonce = crypto.randombytes_buf(crypto.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
	try {
		return { version: SERVICE_VAULT_ENCRYPTION_VERSION, algorithm: SERVICE_VAULT_AEAD_ALGORITHM,
			kdf: { algorithm: SERVICE_VAULT_KDF, opsLimit, memLimit, salt: encode(salt) }, nonce: encode(nonce),
			ciphertext: encode(crypto.crypto_aead_xchacha20poly1305_ietf_encrypt(privateKey, publicKey, null, nonce, key)), publicKey };
	} finally { crypto.memzero(key); }
}

export async function decryptServiceVaultPrivateKey(envelope: EncryptedPrivateKeyEnvelope, passphrase: string): Promise<Uint8Array> {
	const crypto = await ready();
	if (envelope.version !== SERVICE_VAULT_ENCRYPTION_VERSION || envelope.algorithm !== SERVICE_VAULT_AEAD_ALGORITHM
		|| envelope.kdf.algorithm !== SERVICE_VAULT_KDF) throw new Error('Service-vault private-key envelope is unsupported.');
	if (!Number.isSafeInteger(envelope.kdf.opsLimit) || !Number.isSafeInteger(envelope.kdf.memLimit)
		|| envelope.kdf.opsLimit < crypto.crypto_pwhash_OPSLIMIT_INTERACTIVE
		|| envelope.kdf.opsLimit > crypto.crypto_pwhash_OPSLIMIT_SENSITIVE
		|| envelope.kdf.memLimit < crypto.crypto_pwhash_MEMLIMIT_INTERACTIVE
		|| envelope.kdf.memLimit > crypto.crypto_pwhash_MEMLIMIT_SENSITIVE)
		throw new Error('Service-vault private-key KDF parameters are invalid.');
	const key = crypto.crypto_pwhash(crypto.crypto_aead_xchacha20poly1305_ietf_KEYBYTES, passphrase, decode(envelope.kdf.salt),
		envelope.kdf.opsLimit, envelope.kdf.memLimit, crypto.crypto_pwhash_ALG_ARGON2ID13);
	try {
		return validKey(crypto.crypto_aead_xchacha20poly1305_ietf_decrypt(null, decode(envelope.ciphertext), envelope.publicKey,
			decode(envelope.nonce), key), crypto.crypto_box_SECRETKEYBYTES, 'Decrypted service-vault private key');
	} catch { throw new Error('Service-vault passphrase or private-key envelope is invalid.'); }
	finally { crypto.memzero(key); }
}

export async function createTeamVaultGrant(teamVaultKey: Uint8Array, recipientPublicKey: string): Promise<TeamVaultGrantEnvelope> {
	const crypto = await ready();
	validKey(teamVaultKey, crypto.crypto_aead_xchacha20poly1305_ietf_KEYBYTES, 'Team vault key');
	const publicKey = validKey(decode(recipientPublicKey), crypto.crypto_box_PUBLICKEYBYTES, 'Recipient public key');
	return { version: SERVICE_VAULT_ENCRYPTION_VERSION, algorithm: SERVICE_VAULT_KEY_AGREEMENT,
		recipientPublicKey, wrappedTeamVaultKey: encode(crypto.crypto_box_seal(teamVaultKey, publicKey)) };
}

export async function openTeamVaultGrant(grant: TeamVaultGrantEnvelope, recipientPrivateKey: Uint8Array): Promise<Uint8Array> {
	const crypto = await ready();
	if (grant.version !== SERVICE_VAULT_ENCRYPTION_VERSION || grant.algorithm !== SERVICE_VAULT_KEY_AGREEMENT)
		throw new Error('Team vault grant is unsupported.');
	const publicKey = validKey(decode(grant.recipientPublicKey), crypto.crypto_box_PUBLICKEYBYTES, 'Recipient public key');
	validKey(recipientPrivateKey, crypto.crypto_box_SECRETKEYBYTES, 'Recipient private key');
	try { return validKey(crypto.crypto_box_seal_open(decode(grant.wrappedTeamVaultKey), publicKey, recipientPrivateKey),
		crypto.crypto_aead_xchacha20poly1305_ietf_KEYBYTES, 'Unwrapped team vault key'); }
	catch { throw new Error('Team vault grant cannot be opened by this user key.'); }
}

export async function encryptServiceCredential(
	plaintext: string, teamVaultKey: Uint8Array, associatedData: string,
): Promise<EncryptedCredentialEnvelope> {
	const crypto = await ready();
	validKey(teamVaultKey, crypto.crypto_aead_xchacha20poly1305_ietf_KEYBYTES, 'Team vault key');
	if (!plaintext || !associatedData) throw new Error('Credential value and associated data are required.');
	const dataKey = crypto.crypto_aead_xchacha20poly1305_ietf_keygen();
	const nonce = crypto.randombytes_buf(crypto.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
	const wrappedKeyNonce = crypto.randombytes_buf(crypto.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
	try {
		return { version: SERVICE_VAULT_ENCRYPTION_VERSION, algorithm: SERVICE_VAULT_AEAD_ALGORITHM,
			ciphertext: encode(crypto.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, associatedData, null, nonce, dataKey)),
			nonce: encode(nonce), wrappedKey: encode(crypto.crypto_aead_xchacha20poly1305_ietf_encrypt(dataKey, associatedData, null, wrappedKeyNonce, teamVaultKey)),
			wrappedKeyNonce: encode(wrappedKeyNonce), associatedData, associatedDataDigest: hash(associatedData),
			fingerprint: hash(plaintext, teamVaultKey) };
	} finally { crypto.memzero(dataKey); }
}

export async function decryptServiceCredential(
	envelope: EncryptedCredentialEnvelope, teamVaultKey: Uint8Array, expectedAssociatedData: string,
): Promise<string> {
	const crypto = await ready();
	validKey(teamVaultKey, crypto.crypto_aead_xchacha20poly1305_ietf_KEYBYTES, 'Team vault key');
	if (envelope.version !== SERVICE_VAULT_ENCRYPTION_VERSION || envelope.algorithm !== SERVICE_VAULT_AEAD_ALGORITHM
		|| envelope.associatedData !== expectedAssociatedData || envelope.associatedDataDigest !== hash(expectedAssociatedData))
		throw new Error('Credential envelope binding is invalid.');
	let dataKey: Uint8Array | undefined;
	try {
		dataKey = crypto.crypto_aead_xchacha20poly1305_ietf_decrypt(null, decode(envelope.wrappedKey), expectedAssociatedData,
			decode(envelope.wrappedKeyNonce), teamVaultKey);
		return crypto.crypto_aead_xchacha20poly1305_ietf_decrypt(null, decode(envelope.ciphertext), expectedAssociatedData,
			decode(envelope.nonce), dataKey, 'text');
	} catch { throw new Error('Credential envelope cannot be decrypted.'); }
	finally { if (dataKey) crypto.memzero(dataKey); }
}

export async function rewrapServiceCredential(
	envelope: EncryptedCredentialEnvelope, currentTeamVaultKey: Uint8Array, replacementTeamVaultKey: Uint8Array,
): Promise<EncryptedCredentialEnvelope> {
	const plaintext = await decryptServiceCredential(envelope, currentTeamVaultKey, envelope.associatedData);
	return encryptServiceCredential(plaintext, replacementTeamVaultKey, envelope.associatedData);
}

export async function sealSecretOperationPayload(values: Record<string, string>, operationPublicKey: string): Promise<string> {
	const crypto = await ready();
	if (!Object.keys(values).length || Object.values(values).some((value) => typeof value !== 'string' || !value))
		throw new Error('Secret operation payload must contain only non-empty string values.');
	const payload = JSON.stringify(Object.fromEntries(Object.entries(values).sort(([left], [right]) => left.localeCompare(right))));
	return encode(crypto.crypto_box_seal(payload, validKey(decode(operationPublicKey), crypto.crypto_box_PUBLICKEYBYTES, 'Operation public key')));
}

export async function encryptGitHubActionsSecret(value: string, providerPublicKey: string): Promise<string> {
	const crypto = await ready();
	if (!value) throw new Error('GitHub Actions secret value is required.');
	return encode(crypto.crypto_box_seal(value,
		validKey(decode(providerPublicKey), crypto.crypto_box_PUBLICKEYBYTES, 'GitHub public key')));
}

export async function openSecretOperationPayload(
	sealedPayload: string, operationPublicKey: string, operationPrivateKey: Uint8Array,
): Promise<Record<string, string>> {
	const crypto = await ready();
	try {
		const plaintext = crypto.crypto_box_seal_open(decode(sealedPayload), decode(operationPublicKey), operationPrivateKey, 'text');
		const parsed = JSON.parse(plaintext) as Record<string, unknown>;
		if (!parsed || Array.isArray(parsed) || Object.values(parsed).some((value) => typeof value !== 'string' || !value)) throw new Error();
		return parsed as Record<string, string>;
	} catch { throw new Error('Secret operation payload cannot be opened.'); }
}

export function clearServiceVaultKey(value: Uint8Array | undefined): void { value?.fill(0); }
