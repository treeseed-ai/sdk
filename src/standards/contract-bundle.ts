import { StandardsError } from './errors.ts';
import type { StandardsContractDescriptor, StandardsEvidenceReference, StandardsPackageIdentity } from './contracts.ts';

export interface StandardsContractBundle {
	schemaVersion: 1;
	package: StandardsPackageIdentity;
	contracts: StandardsContractDescriptor[];
	evidence: StandardsEvidenceReference[];
}

function requireUnique(values: string[], path: string) {
	const duplicate = values.find((value, index) => values.indexOf(value) !== index);
	if (duplicate) throw new StandardsError('standards_duplicate_identity', `Duplicate standards identity: ${duplicate}.`, path);
}

function sortedUnique(values: string[], path: string) {
	requireUnique(values, path);
	return [...values].sort();
}

export function createStandardsContractBundle(input: Omit<StandardsContractBundle, 'schemaVersion'>): StandardsContractBundle {
	requireUnique(input.contracts.map((contract) => contract.id), 'contracts');
	const contracts = [...input.contracts].sort((left, right) => left.id.localeCompare(right.id)).map((contract) => ({
		...contract,
		entrypoints: sortedUnique(contract.entrypoints, `contracts.${contract.id}.entrypoints`),
		guarantees: sortedUnique(contract.guarantees, `contracts.${contract.id}.guarantees`),
		deprecations: sortedUnique(contract.deprecations, `contracts.${contract.id}.deprecations`),
	}));
	const evidence = [...input.evidence].sort((left, right) => `${left.kind}:${left.uri}`.localeCompare(`${right.kind}:${right.uri}`));
	return { schemaVersion: 1, package: { ...input.package }, contracts, evidence };
}
