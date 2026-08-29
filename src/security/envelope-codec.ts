import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { encryptedEnvelopeSchema, type EncryptedEnvelope, type EncryptedEnvelopeAad } from './encrypted-envelope.ts';

export interface EnvelopeKeyProvider {
	readonly id: string;
	active(): { id: string; version: number; key: Uint8Array };
	resolve(id: string, version: number): Uint8Array | undefined;
}

function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
	return JSON.stringify(value);
}

const digest = (value: Uint8Array | string) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const encode = (value: Uint8Array) => Buffer.from(value).toString('base64url');
const decode = (value: string) => { const decoded = Buffer.from(value, 'base64url'); if (decoded.toString('base64url') !== value) throw new Error('Encrypted envelope contains a non-canonical base64url value.'); return decoded; };

function seal(key: Uint8Array, plaintext: Uint8Array, aad: string) {
	if (key.byteLength !== 32) throw new Error('Envelope keys must contain exactly 32 bytes.');
	const nonce = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, nonce);
	cipher.setAAD(Buffer.from(aad)); const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
	return { nonce: encode(nonce), authenticationTag: encode(cipher.getAuthTag()), ciphertext: encode(ciphertext) };
}

function open(key: Uint8Array, value: { nonce: string; authenticationTag: string; ciphertext: string }, aad: string) {
	const decipher = createDecipheriv('aes-256-gcm', key, decode(value.nonce));
	decipher.setAAD(Buffer.from(aad)); decipher.setAuthTag(decode(value.authenticationTag));
	return Buffer.concat([decipher.update(decode(value.ciphertext)), decipher.final()]);
}

export class EncryptedEnvelopeCodec {
	constructor(private readonly keys: EnvelopeKeyProvider) {}

	encrypt(plaintext: Uint8Array | string, aad: EncryptedEnvelopeAad): EncryptedEnvelope {
		const active = this.keys.active(); const aadValue = canonical(aad); const dek = randomBytes(32);
		const payload = seal(dek, typeof plaintext === 'string' ? Buffer.from(plaintext) : plaintext, aadValue);
		const wrappedDek = seal(active.key, dek, `${aadValue}:dek`);
		return encryptedEnvelopeSchema.parse({ schemaVersion: 'treeseed.encrypted-envelope/v1', algorithm: 'aes-256-gcm', keyProvider: this.keys.id,
			keyId: active.id, keyVersion: active.version, wrappedDek, payload, aad, aadDigest: digest(aadValue),
			ciphertextDigest: digest(decode(payload.ciphertext)), createdAt: new Date().toISOString() });
	}

	decrypt(input: EncryptedEnvelope): Buffer {
		const envelope = encryptedEnvelopeSchema.parse(input); const aad = canonical(envelope.aad);
		if (digest(aad) !== envelope.aadDigest || digest(decode(envelope.payload.ciphertext)) !== envelope.ciphertextDigest) throw new Error('Encrypted envelope digest verification failed.');
		const key = this.keys.resolve(envelope.keyId, envelope.keyVersion); if (!key) throw new Error(`Encrypted envelope key ${envelope.keyId}:${envelope.keyVersion} is unavailable.`);
		const dek = open(key, envelope.wrappedDek, `${aad}:dek`); return open(dek, envelope.payload, aad);
	}

	authenticate(input: EncryptedEnvelope) { this.decrypt(input); return true; }

	rewrap(input: EncryptedEnvelope): EncryptedEnvelope {
		const envelope = encryptedEnvelopeSchema.parse(input); const prior = this.keys.resolve(envelope.keyId, envelope.keyVersion);
		if (!prior) throw new Error(`Encrypted envelope key ${envelope.keyId}:${envelope.keyVersion} is unavailable.`);
		const aad = canonical(envelope.aad); const dek = open(prior, envelope.wrappedDek, `${aad}:dek`); const active = this.keys.active();
		return encryptedEnvelopeSchema.parse({ ...envelope, keyProvider: this.keys.id, keyId: active.id, keyVersion: active.version, wrappedDek: seal(active.key, dek, `${aad}:dek`) });
	}
}

export class StaticEnvelopeKeyProvider implements EnvelopeKeyProvider {
	readonly id: string;
	constructor(id: string, private readonly activeKey: { id: string; version: number; key: Uint8Array }, private readonly historical: Array<{ id: string; version: number; key: Uint8Array }> = []) { this.id = id; }
	active() { return this.activeKey; }
	resolve(id: string, version: number) { return [this.activeKey, ...this.historical].find((entry) => entry.id === id && entry.version === version)?.key; }
}
