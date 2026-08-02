import sodiumModule from 'libsodium-wrappers-sumo';
import { describe, expect, it } from 'vitest';
import { encryptGitHubActionsSecret } from '../../../src/secrets-capability/service-vault-crypto.ts';

describe('GitHub Actions secret encryption', () => {
	it('seals a secret directly to the provider public key', async () => {
		await sodiumModule.ready;
		const pair = sodiumModule.crypto_box_keypair();
		const publicKey = sodiumModule.to_base64(pair.publicKey, sodiumModule.base64_variants.ORIGINAL);
		const encrypted = await encryptGitHubActionsSecret('secret-canary', publicKey);
		const opened = sodiumModule.crypto_box_seal_open(
			sodiumModule.from_base64(encrypted, sodiumModule.base64_variants.ORIGINAL), pair.publicKey, pair.privateKey,
		);
		expect(sodiumModule.to_string(opened)).toBe('secret-canary');
		expect(encrypted).not.toContain('secret-canary');
	});

	it('rejects malformed provider keys before handling a secret', async () => {
		await expect(encryptGitHubActionsSecret('secret-canary', 'not-a-provider-key')).rejects.toThrow(/invalid/u);
	});
});
