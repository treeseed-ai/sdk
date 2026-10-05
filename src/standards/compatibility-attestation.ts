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

function semanticVersionParts(version: string) {
	const match = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/u.exec(version);
	if (!match) throw new Error(`Invalid semantic version "${version}".`);
	return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export function declaredSemanticBump(baselineVersion: string, candidateVersion: string): SemanticVersionRequirement {
	const baseline = semanticVersionParts(baselineVersion);
	const candidate = semanticVersionParts(candidateVersion);
	if (candidate.major < baseline.major
		|| (candidate.major === baseline.major && candidate.minor < baseline.minor)
		|| (candidate.major === baseline.major && candidate.minor === baseline.minor && candidate.patch < baseline.patch)) {
		throw new Error(`Candidate version ${candidateVersion} cannot precede baseline ${baselineVersion}.`);
	}
	if (candidate.major > baseline.major) return 'major';
	if (candidate.minor > baseline.minor) return 'minor';
	if (candidate.patch > baseline.patch) return 'patch';
	return 'none';
}

export function requiredSemanticBump(classification: CompatibilityClassification, baselineVersion?: string): SemanticVersionRequirement {
	if (classification === 'breaking') return baselineVersion && semanticVersionParts(baselineVersion).major === 0 ? 'minor' : 'major';
	if (classification === 'compatible_addition') return 'minor';
	return 'patch';
}

export function semanticBumpResult(
	classification: CompatibilityClassification,
	declared: SemanticVersionRequirement,
	baselineVersion?: string,
): SemanticBumpResult {
	const required = requiredSemanticBump(classification, baselineVersion);
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
