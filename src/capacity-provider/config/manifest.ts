import type { CapacityProviderManifestV2 } from '../contracts/index.ts';
import { canonicalCapacityProviderJson, capacityProviderSha256 } from '../security/identity.ts';
import { validateCapacityProviderManifestV2 } from '../validation.ts';

export interface ValidatedCapacityProviderManifest {
	manifest: CapacityProviderManifestV2;
	digest: string;
}

export function validateAndDigestCapacityProviderManifest(value: unknown): ValidatedCapacityProviderManifest {
	const manifest = value as CapacityProviderManifestV2;
	const validation = validateCapacityProviderManifestV2(manifest);
	if (!validation.ok) {
		throw new Error(validation.diagnostics.map((entry) => `${entry.path}: ${entry.message}`).join('; '));
	}
	return {
		manifest,
		digest: `sha256:${capacityProviderSha256(canonicalCapacityProviderJson(manifest))}`,
	};
}
