import { describe, expect, it } from 'vitest';
import {
	SERVICE_PROVIDER_CATALOG,
	canonicalServiceVaultAssociatedData,
	containsForbiddenPlaintextSecretMaterial,
	createServiceVaultKey,
	createServiceVaultUserKeyPair,
	createTeamVaultGrant,
	decryptServiceCredential,
	decryptServiceVaultPrivateKey,
	encryptServiceCredential,
	encryptServiceVaultPrivateKey,
	openTeamVaultGrant,
	rewrapServiceCredential,
	validateEncryptedCredentialEnvelope,
} from '../../../src/configuration/secrets-capability.ts';

describe('service vault cryptography', () => {
	it('encrypts credential values with context-bound envelope keys', async () => {
		const teamKey = await createServiceVaultKey();
		const associatedData = canonicalServiceVaultAssociatedData({
			teamId: 'team-a',
			connectionId: 'connection-a',
			credentialProfileId: 'github-app',
			field: 'privateKey',
			purpose: 'team-service-credential',
			version: 1,
		});
		const envelope = await encryptServiceCredential('secret-canary', teamKey, associatedData);

		expect(validateEncryptedCredentialEnvelope(envelope)).toBe(true);
		expect(JSON.stringify(envelope)).not.toContain('secret-canary');
		await expect(decryptServiceCredential(envelope, teamKey, associatedData)).resolves.toBe('secret-canary');
		await expect(decryptServiceCredential(envelope, teamKey, associatedData.replace('team-a', 'team-b'))).rejects.toThrow(
			'Credential context does not match',
		);
	});

	it('grants a team key to only the intended administrator keypair', async () => {
		const teamKey = await createServiceVaultKey();
		const recipient = await createServiceVaultUserKeyPair();
		const unrelated = await createServiceVaultUserKeyPair();
		const grant = await createTeamVaultGrant(teamKey, recipient.publicKey);

		await expect(openTeamVaultGrant(grant, recipient.privateKey)).resolves.toEqual(teamKey);
		await expect(openTeamVaultGrant(grant, unrelated.privateKey)).rejects.toThrow('cannot be opened');
	});

	it('rotates a personal passphrase without changing provider credential ciphertext', async () => {
		const pair = await createServiceVaultUserKeyPair();
		const first = await encryptServiceVaultPrivateKey(pair.privateKey, pair.publicKey, 'first-long-passphrase');
		const unlocked = await decryptServiceVaultPrivateKey(first, 'first-long-passphrase');
		const rotated = await encryptServiceVaultPrivateKey(unlocked, pair.publicKey, 'second-long-passphrase');

		await expect(decryptServiceVaultPrivateKey(first, 'wrong-passphrase')).rejects.toThrow('Unable to unlock');
		await expect(decryptServiceVaultPrivateKey(rotated, 'second-long-passphrase')).resolves.toEqual(pair.privateKey);
		expect(rotated.ciphertext).not.toBe(first.ciphertext);
	});

	it('rotates a team vault key without rewriting credential ciphertext', async () => {
		const currentKey = await createServiceVaultKey();
		const replacementKey = await createServiceVaultKey();
		const context = canonicalServiceVaultAssociatedData({
			teamId: 'team-rotation',
			connectionId: 'service-rotation',
			credentialProfileId: 'github-app',
			field: 'privateKey',
			purpose: 'team-service-credential',
			version: 1,
		});
		const original = await encryptServiceCredential('rotation-canary', currentKey, context);
		const rotated = await rewrapServiceCredential(original, currentKey, replacementKey);

		expect(rotated.ciphertext).toBe(original.ciphertext);
		expect(rotated.nonce).toBe(original.nonce);
		expect(rotated.wrappedKey).not.toBe(original.wrappedKey);
		await expect(decryptServiceCredential(rotated, currentKey, context)).rejects.toThrow();
		await expect(decryptServiceCredential(rotated, replacementKey, context)).resolves.toBe('rotation-canary');
	});

	it('keeps provider capability types independent and classifies sensitive fields', () => {
		const github = SERVICE_PROVIDER_CATALOG.find((provider) => provider.id === 'github');
		const cloudflare = SERVICE_PROVIDER_CATALOG.find((provider) => provider.id === 'cloudflare');
		expect(github?.capabilities.map((capability) => capability.type)).toEqual(
			expect.arrayContaining(['repository-hosting', 'workflow-execution', 'secret-enclave']),
		);
		expect(cloudflare?.credentialProfiles.length).toBeGreaterThan(1);
		expect(github?.connectionFields.every((field) => !field.sensitive)).toBe(true);
	});

	it('detects secret-shaped plaintext recursively without rejecting ciphertext metadata', () => {
		expect(containsForbiddenPlaintextSecretMaterial({ nested: { apiToken: 'plaintext' } })).toEqual(['nested.apiToken']);
		expect(containsForbiddenPlaintextSecretMaterial({
			envelope: { ciphertext: 'opaque', nonce: 'nonce', wrappedKey: 'wrapped' },
		})).toEqual([]);
	});
});
