import type {
	CompatibilityClassification,
	SemanticBumpResult,
	SemanticVersionRequirement,
	StandardsDigest,
	StandardsEvidenceReference,
} from './contracts.ts';

export interface CompatibilityFinding {
	code: string;
	path: string;
	message: string;
	classification: CompatibilityClassification;
}

export interface StandardsCompatibilityAttestation {
	schemaVersion: 1;
	contractId: string;
	baselineBundle: StandardsDigest;
	candidateBundle: StandardsDigest;
	result: SemanticBumpResult;
	findings: CompatibilityFinding[];
	evidence: StandardsEvidenceReference[];
}

const bumpRank: Record<SemanticVersionRequirement, number> = { none: 0, patch: 1, minor: 2, major: 3 };

export function requiredSemanticBump(classification: CompatibilityClassification): SemanticVersionRequirement {
	if (classification === 'breaking') return 'major';
	if (classification === 'compatible_addition') return 'minor';
	return 'patch';
}

export function semanticBumpResult(
	classification: CompatibilityClassification,
	declared: SemanticVersionRequirement,
): SemanticBumpResult {
	const required = requiredSemanticBump(classification);
	return { classification, required, declared, sufficient: bumpRank[declared] >= bumpRank[required] };
}

export function createCompatibilityAttestation(
	input: Omit<StandardsCompatibilityAttestation, 'schemaVersion' | 'findings' | 'evidence'> & {
		findings: CompatibilityFinding[];
		evidence: StandardsEvidenceReference[];
	},
): StandardsCompatibilityAttestation {
	return {
		...input,
		schemaVersion: 1,
		findings: [...input.findings].sort((left, right) => `${left.path}:${left.code}`.localeCompare(`${right.path}:${right.code}`)),
		evidence: [...input.evidence].sort((left, right) => `${left.kind}:${left.uri}`.localeCompare(`${right.kind}:${right.uri}`)),
	};
}
