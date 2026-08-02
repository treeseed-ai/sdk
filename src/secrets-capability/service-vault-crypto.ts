import sodiumModule from 'libsodium-wrappers-sumo';
import {
SERVICE_VAULT_AEAD_ALGORITHM,
SERVICE_VAULT_ENCRYPTION_VERSION,
SERVICE_VAULT_KDF,
SERVICE_VAULT_KEY_AGREEMENT,
type EncryptedCredentialEnvelope,
type EncryptedPrivateKeyEnvelope,
type TeamVaultGrantEnvelope,
} from './service-vault-contracts.ts';

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

type Sodium = {
	ready: Promise<void>;
	base64_variants: { ORIGINAL: number };
	crypto_aead_xchacha20poly1305_ietf_KEYBYTES: number;
	crypto_aead_xchacha20poly1305_ietf_NPUBBYTES: number;
	crypto_box_PUBLICKEYBYTES: number;
	crypto_box_SECRETKEYBYTES: number;
	crypto_pwhash_ALG_ARGON2ID13: number;
	crypto_pwhash_MEMLIMIT_INTERACTIVE: number;
	crypto_pwhash_OPSLIMIT_INTERACTIVE: number;
	crypto_pwhash_SALTBYTES: number;
	crypto_aead_xchacha20poly1305_ietf_decrypt: (
		secretNonce: null,
		ciphertext: Uint8Array,
		additionalData: Uint8Array,
		nonce: Uint8Array,
		key: Uint8Array,
	) => Uint8Array;
	crypto_aead_xchacha20poly1305_ietf_encrypt: (
		message: Uint8Array,
		additionalData: Uint8Array,
		secretNonce: null,
		nonce: Uint8Array,
		key: Uint8Array,
	) => Uint8Array;
	crypto_box_keypair: () => { publicKey: Uint8Array; privateKey: Uint8Array };
	crypto_box_seal: (message: Uint8Array, publicKey: Uint8Array) => Uint8Array;
	crypto_box_seal_open: (ciphertext: Uint8Array, publicKey: Uint8Array, privateKey: Uint8Array) => Uint8Array;
	crypto_generichash: (length: number, message: Uint8Array) => Uint8Array;
	crypto_pwhash: (
		length: number,
		passphrase: Uint8Array,
		salt: Uint8Array,
		opsLimit: number,
		memLimit: number,
		algorithm: number,
	) => Uint8Array;
	from_base64: (value: string, variant: number) => Uint8Array;
	memzero: (value: Uint8Array) => void;
	randombytes_buf: (length: number) => Uint8Array;
	to_base64: (value: Uint8Array, variant: number) => string;
};

let sodiumPromise: Promise<Sodium> | undefined;

async function sodium(): Promise<Sodium> {
	sodiumPromise ??= Promise.resolve().then(async () => {
		const loaded = sodiumModule as Sodium;
		await loaded.ready;
		return loaded;
	});
	return sodiumPromise;
}

function encodeBase64(crypto: Sodium, value: Uint8Array): string {
	return crypto.to_base64(value, crypto.base64_variants.ORIGINAL);
}

function decodeBase64(crypto: Sodium, value: string): Uint8Array {
	return crypto.from_base64(value, crypto.base64_variants.ORIGINAL);
}

async function fingerprint(value: Uint8Array): Promise<string> {
	const crypto = await sodium();
	return encodeBase64(crypto, crypto.crypto_generichash(20, value));
}

export async function createServiceVaultKey(): Promise<Uint8Array> {
	const crypto = await sodium();
	return crypto.randombytes_buf(crypto.crypto_aead_xchacha20poly1305_ietf_KEYBYTES);
}

export async function createServiceVaultUserKeyPair(): Promise<{ publicKey: string; privateKey: Uint8Array }> {
	const crypto = await sodium();
	const pair = crypto.crypto_box_keypair();
	return {
		publicKey: encodeBase64(crypto, pair.publicKey),
		privateKey: pair.privateKey,
	};
}

export async function encryptServiceVaultPrivateKey(
	privateKey: Uint8Array,
	publicKey: string,
	passphrase: string,
	options: { opsLimit?: number; memLimit?: number } = {},
): Promise<EncryptedPrivateKeyEnvelope> {
	if (!passphrase) throw new Error('A personal vault passphrase is required.');
	const crypto = await sodium();
	const salt = crypto.randombytes_buf(crypto.crypto_pwhash_SALTBYTES);
	const nonce = crypto.randombytes_buf(crypto.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
	const opsLimit = options.opsLimit ?? crypto.crypto_pwhash_OPSLIMIT_INTERACTIVE;
	const memLimit = options.memLimit ?? crypto.crypto_pwhash_MEMLIMIT_INTERACTIVE;
	const key = crypto.crypto_pwhash(
		crypto.crypto_aead_xchacha20poly1305_ietf_KEYBYTES,
		ENCODER.encode(passphrase.normalize('NFKC')),
		salt,
		opsLimit,
		memLimit,
		crypto.crypto_pwhash_ALG_ARGON2ID13,
	);
	try {
		const ciphertext = crypto.crypto_aead_xchacha20poly1305_ietf_encrypt(
			privateKey,
			ENCODER.encode(publicKey),
			null,
			nonce,
			key,
		);
		return {
			version: SERVICE_VAULT_ENCRYPTION_VERSION,
			algorithm: SERVICE_VAULT_AEAD_ALGORITHM,
			kdf: {
				algorithm: SERVICE_VAULT_KDF,
				opsLimit,
				memLimit,
				salt: encodeBase64(crypto, salt),
			},
			nonce: encodeBase64(crypto, nonce),
			ciphertext: encodeBase64(crypto, ciphertext),
			publicKey,
		};
	} finally {
		crypto.memzero(key);
	}
}

export async function decryptServiceVaultPrivateKey(
	envelope: EncryptedPrivateKeyEnvelope,
	passphrase: string,
): Promise<Uint8Array> {
	if (!passphrase) throw new Error('A personal vault passphrase is required.');
	const crypto = await sodium();
	const key = crypto.crypto_pwhash(
		crypto.crypto_aead_xchacha20poly1305_ietf_KEYBYTES,
		ENCODER.encode(passphrase.normalize('NFKC')),
		decodeBase64(crypto, envelope.kdf.salt),
		envelope.kdf.opsLimit,
		envelope.kdf.memLimit,
		crypto.crypto_pwhash_ALG_ARGON2ID13,
	);
	try {
		return crypto.crypto_aead_xchacha20poly1305_ietf_decrypt(
			null,
			decodeBase64(crypto, envelope.ciphertext),
			ENCODER.encode(envelope.publicKey),
			decodeBase64(crypto, envelope.nonce),
			key,
		);
	} catch {
		throw new Error('Unable to unlock the service vault. Check the passphrase.');
	} finally {
		crypto.memzero(key);
	}
}

export async function createTeamVaultGrant(teamVaultKey: Uint8Array, recipientPublicKey: string): Promise<TeamVaultGrantEnvelope> {
	const crypto = await sodium();
	return {
		version: SERVICE_VAULT_ENCRYPTION_VERSION,
		algorithm: SERVICE_VAULT_KEY_AGREEMENT,
		recipientPublicKey,
		wrappedTeamVaultKey: encodeBase64(
			crypto,
			crypto.crypto_box_seal(teamVaultKey, decodeBase64(crypto, recipientPublicKey)),
		),
	};
}

export async function openTeamVaultGrant(grant: TeamVaultGrantEnvelope, recipientPrivateKey: Uint8Array): Promise<Uint8Array> {
	const crypto = await sodium();
	try {
		return crypto.crypto_box_seal_open(
			decodeBase64(crypto, grant.wrappedTeamVaultKey),
			decodeBase64(crypto, grant.recipientPublicKey),
			recipientPrivateKey,
		);
	} catch {
		throw new Error('This vault grant cannot be opened by the current administrator key.');
	}
}

export async function encryptServiceCredential(
	plaintext: string,
	teamVaultKey: Uint8Array,
	associatedData: string,
): Promise<EncryptedCredentialEnvelope> {
	const crypto = await sodium();
	const dataKey = crypto.randombytes_buf(crypto.crypto_aead_xchacha20poly1305_ietf_KEYBYTES);
	const valueNonce = crypto.randombytes_buf(crypto.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
	const keyNonce = crypto.randombytes_buf(crypto.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
	try {
		const ciphertext = crypto.crypto_aead_xchacha20poly1305_ietf_encrypt(
			ENCODER.encode(plaintext),
			ENCODER.encode(associatedData),
			null,
			valueNonce,
			dataKey,
		);
		const wrappedKey = crypto.crypto_aead_xchacha20poly1305_ietf_encrypt(
			dataKey,
			ENCODER.encode(associatedData),
			null,
			keyNonce,
			teamVaultKey,
		);
		return {
			version: SERVICE_VAULT_ENCRYPTION_VERSION,
			algorithm: SERVICE_VAULT_AEAD_ALGORITHM,
			ciphertext: encodeBase64(crypto, ciphertext),
			nonce: encodeBase64(crypto, valueNonce),
			wrappedKey: encodeBase64(crypto, wrappedKey),
			wrappedKeyNonce: encodeBase64(crypto, keyNonce),
			associatedData,
			associatedDataDigest: await fingerprint(ENCODER.encode(associatedData)),
			fingerprint: await fingerprint(ciphertext),
		};
	} finally {
		crypto.memzero(dataKey);
	}
}

export async function decryptServiceCredential(
	envelope: EncryptedCredentialEnvelope,
	teamVaultKey: Uint8Array,
	expectedAssociatedData: string,
): Promise<string> {
	if (envelope.associatedData !== expectedAssociatedData) {
		throw new Error('Credential context does not match the requested team service field.');
	}
	const crypto = await sodium();
	let dataKey: Uint8Array | undefined;
	try {
		dataKey = crypto.crypto_aead_xchacha20poly1305_ietf_decrypt(
			null,
			decodeBase64(crypto, envelope.wrappedKey),
			ENCODER.encode(expectedAssociatedData),
			decodeBase64(crypto, envelope.wrappedKeyNonce),
			teamVaultKey,
		);
		const plaintext = crypto.crypto_aead_xchacha20poly1305_ietf_decrypt(
			null,
			decodeBase64(crypto, envelope.ciphertext),
			ENCODER.encode(expectedAssociatedData),
			decodeBase64(crypto, envelope.nonce),
			dataKey,
		);
		return DECODER.decode(plaintext);
	} catch {
		throw new Error('Unable to decrypt this credential for the requested service field.');
	} finally {
		if (dataKey) crypto.memzero(dataKey);
	}
}

export async function rewrapServiceCredential(
	envelope: EncryptedCredentialEnvelope,
	currentTeamVaultKey: Uint8Array,
	replacementTeamVaultKey: Uint8Array,
): Promise<EncryptedCredentialEnvelope> {
	const crypto = await sodium();
	let dataKey: Uint8Array | undefined;
	const replacementNonce = crypto.randombytes_buf(crypto.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
	try {
		dataKey = crypto.crypto_aead_xchacha20poly1305_ietf_decrypt(
			null,
			decodeBase64(crypto, envelope.wrappedKey),
			ENCODER.encode(envelope.associatedData),
			decodeBase64(crypto, envelope.wrappedKeyNonce),
			currentTeamVaultKey,
		);
		const wrappedKey = crypto.crypto_aead_xchacha20poly1305_ietf_encrypt(
			dataKey,
			ENCODER.encode(envelope.associatedData),
			null,
			replacementNonce,
			replacementTeamVaultKey,
		);
		return {
			...envelope,
			wrappedKey: encodeBase64(crypto, wrappedKey),
			wrappedKeyNonce: encodeBase64(crypto, replacementNonce),
		};
	} catch {
		throw new Error('Unable to rotate this credential key for the current team vault.');
	} finally {
		if (dataKey) crypto.memzero(dataKey);
	}
}

export async function sealSecretOperationPayload(
	values: Record<string, string>,
	operationPublicKey: string,
): Promise<string> {
	const crypto = await sodium();
	return encodeBase64(
		crypto,
		crypto.crypto_box_seal(ENCODER.encode(JSON.stringify(values)), decodeBase64(crypto, operationPublicKey)),
	);
}

export async function encryptGitHubActionsSecret(value: string, providerPublicKey: string): Promise<string> {
	if (!value) throw new Error('A secret value is required.');
	const crypto = await sodium();
	let publicKey: Uint8Array;
	try { publicKey = decodeBase64(crypto, providerPublicKey); }
	catch { throw new Error('GitHub returned an invalid Actions secret public key.'); }
	if (publicKey.length !== crypto.crypto_box_PUBLICKEYBYTES) {
		throw new Error('GitHub returned an invalid Actions secret public key.');
	}
	return encodeBase64(crypto, crypto.crypto_box_seal(ENCODER.encode(value), publicKey));
}

export async function openSecretOperationPayload(
	sealedPayload: string,
	operationPublicKey: string,
	operationPrivateKey: Uint8Array,
): Promise<Record<string, string>> {
	const crypto = await sodium();
	try {
		const plaintext = crypto.crypto_box_seal_open(
			decodeBase64(crypto, sealedPayload),
			decodeBase64(crypto, operationPublicKey),
			operationPrivateKey,
		);
		const parsed = JSON.parse(DECODER.decode(plaintext));
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
		if (Object.values(parsed).some((value) => typeof value !== 'string')) throw new Error();
		return parsed as Record<string, string>;
	} catch {
		throw new Error('The operation payload cannot be opened by this runner lease.');
	}
}

export function clearServiceVaultKey(value: Uint8Array | undefined): void {
	if (!value) return;
	void sodium().then((crypto) => crypto.memzero(value));
}
