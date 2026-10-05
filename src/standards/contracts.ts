export type StandardsDigest = `sha256:${string}`;
export type StandardsContractFamily = 'typescript' | 'openapi' | 'json-schema' | 'behavioral';
export type CompatibilityClassification = 'unchanged' | 'compatible_addition' | 'breaking';
export type SemanticVersionRequirement = 'none' | 'patch' | 'minor' | 'major';

export interface StandardsEvidenceReference {
	kind: 'source' | 'artifact' | 'test' | 'provider_receipt';
	uri: string;
	digest?: StandardsDigest;
}

export interface StandardsArtifactReference {
	path: string;
	mediaType: string;
	digest: StandardsDigest;
}

export interface StandardsPackageIdentity {
	name: string;
	version: string;
	sourceCommit: string;
	artifactDigest: StandardsDigest;
}

export interface StandardsContractDescriptor {
	id: string;
	family: StandardsContractFamily;
	version: string;
	artifact: StandardsArtifactReference;
	entrypoints: string[];
	guarantees: string[];
	deprecations: string[];
}

export interface StandardsFingerprint {
	algorithm: 'sha256';
	digest: StandardsDigest;
}

export interface SemanticBumpResult {
	classification: CompatibilityClassification;
	required: SemanticVersionRequirement;
	declared: SemanticVersionRequirement;
	sufficient: boolean;
}
