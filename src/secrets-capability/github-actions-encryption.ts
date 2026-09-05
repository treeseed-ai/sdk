import sodium from 'libsodium-wrappers-sumo';

/** GitHub's upload protocol, not a TreeSeed custody implementation. */
export async function encryptGitHubActionsSecret(value: string, providerPublicKey: string): Promise<string> {
  await sodium.ready;
  if (!value) throw new Error('GitHub Actions secret value is required.');
  const key = sodium.from_base64(providerPublicKey, sodium.base64_variants.ORIGINAL);
  if (key.length !== sodium.crypto_box_PUBLICKEYBYTES) throw new Error('Invalid GitHub public key.');
  return sodium.to_base64(sodium.crypto_box_seal(value, key), sodium.base64_variants.ORIGINAL);
}
