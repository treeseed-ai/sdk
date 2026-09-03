import { describe, expect, it } from 'vitest';
import sodium from 'libsodium-wrappers-sumo';
import {
	clearServiceVaultKey,
	createServiceVaultKey,
	createServiceVaultUserKeyPair,
	createTeamVaultGrant,
	decryptServiceCredential,
	decryptServiceVaultPrivateKey,
	encryptGitHubActionsSecret,
	encryptServiceCredential,
	encryptServiceVaultPrivateKey,
	openSecretOperationPayload,
	openTeamVaultGrant,
	rewrapServiceCredential,
	sealSecretOperationPayload,
} from '../../../src/secrets-capability/service-vault-crypto.ts';

const fastKdf = { opsLimit: 2, memLimit: 67_108_864 };

describe('service vault browser cryptography', () => {
	it('encrypts a user private key and rejects the wrong passphrase', async () => {
		const pair = await createServiceVaultUserKeyPair();
		const envelope = await encryptServiceVaultPrivateKey(pair.privateKey, pair.publicKey, 'correct horse battery staple', fastKdf);
		expect(await decryptServiceVaultPrivateKey(envelope, 'correct horse battery staple')).toEqual(pair.privateKey);
		await expect(decryptServiceVaultPrivateKey(envelope, 'incorrect passphrase')).rejects.toThrow(/invalid/u);
	});

	it('grants team access and binds credentials to canonical associated data', async () => {
		const pair = await createServiceVaultUserKeyPair(), teamKey = await createServiceVaultKey();
		const grant = await createTeamVaultGrant(teamKey, pair.publicKey);
		const opened = await openTeamVaultGrant(grant, pair.privateKey);
		const associatedData = JSON.stringify({ teamId: 'team-1', connectionId: 'connection-1', field: 'apiToken' });
		const envelope = await encryptServiceCredential('provider-secret', opened, associatedData);
		expect(await decryptServiceCredential(envelope, teamKey, associatedData)).toBe('provider-secret');
		await expect(decryptServiceCredential(envelope, teamKey, `${associatedData}-changed`)).rejects.toThrow(/binding/u);
		envelope.ciphertext = `${envelope.ciphertext.slice(0, -2)}AA`;
		await expect(decryptServiceCredential(envelope, teamKey, associatedData)).rejects.toThrow(/cannot be decrypted/u);
	});

	it('rewraps credentials and seals exact operation payloads', async () => {
		const current = await createServiceVaultKey(), replacement = await createServiceVaultKey();
		const envelope = await encryptServiceCredential('railway-secret', current, 'team-1/railway/apiToken');
		const rewrapped = await rewrapServiceCredential(envelope, current, replacement);
		await expect(decryptServiceCredential(rewrapped, current, rewrapped.associatedData)).rejects.toThrow();
		expect(await decryptServiceCredential(rewrapped, replacement, rewrapped.associatedData)).toBe('railway-secret');
		const operation = await createServiceVaultUserKeyPair();
		const sealed = await sealSecretOperationPayload({ apiToken: 'railway-secret' }, operation.publicKey);
		expect(await openSecretOperationPayload(sealed, operation.publicKey, operation.privateKey)).toEqual({ apiToken: 'railway-secret' });
		clearServiceVaultKey(current);
		expect([...current].every((value) => value === 0)).toBe(true);
	});

	it('encrypts the raw value expected by the GitHub Actions public-key API', async () => {
		await sodium.ready;
		const pair = sodium.crypto_box_keypair();
		const publicKey = sodium.to_base64(pair.publicKey, sodium.base64_variants.ORIGINAL);
		const encrypted = await encryptGitHubActionsSecret('workflow-secret', publicKey);
		expect(sodium.crypto_box_seal_open(
			sodium.from_base64(encrypted, sodium.base64_variants.ORIGINAL), pair.publicKey, pair.privateKey, 'text',
		)).toBe('workflow-secret');
	});
});

