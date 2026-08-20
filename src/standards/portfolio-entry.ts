import type { StandardsDigest } from './contracts.ts';

export interface StandardsPortfolioEntry {
	schemaVersion: 1;
	packageName: string;
	acceptedVersion: string;
	acceptedSourceCommit: string;
	packageDigest: StandardsDigest;
	contractBundleDigest: StandardsDigest;
	compositionIds: string[];
	rollbackOperations: string[];
}

export function createStandardsPortfolioEntry(input: Omit<StandardsPortfolioEntry, 'schemaVersion'>): StandardsPortfolioEntry {
	return {
		...input,
		schemaVersion: 1,
		compositionIds: [...new Set(input.compositionIds)].sort(),
		rollbackOperations: [...new Set(input.rollbackOperations)].sort(),
	};
}
