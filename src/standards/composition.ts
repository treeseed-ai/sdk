import { StandardsError } from './errors.ts';
import type { StandardsDigest } from './contracts.ts';

export interface StandardsCompositionMember {
	packageName: string;
	packageVersion: string;
	sourceCommit: string;
	packageDigest: StandardsDigest;
	contractBundleDigest: StandardsDigest;
	compatibilityAttestationDigests: StandardsDigest[];
}

export interface StandardsComposition {
	schemaVersion: 1;
	id: string;
	members: StandardsCompositionMember[];
}

export function createStandardsComposition(input: Omit<StandardsComposition, 'schemaVersion'>): StandardsComposition {
	const names = input.members.map((member) => member.packageName);
	const duplicate = names.find((name, index) => names.indexOf(name) !== index);
	if (duplicate) throw new StandardsError('standards_duplicate_identity', `Duplicate composition package: ${duplicate}.`, 'members');
	const members = [...input.members].sort((left, right) => left.packageName.localeCompare(right.packageName)).map((member) => ({
		...member,
		compatibilityAttestationDigests: [...member.compatibilityAttestationDigests].sort(),
	}));
	return { schemaVersion: 1, id: input.id, members };
}
