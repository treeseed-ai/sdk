import { describe, expect, it } from 'vitest';
import {
	canonicalStandardsJson,
	createCompatibilityAttestation,
	createStandardsComposition,
	createStandardsContractBundle,
	createStandardsPortfolioEntry,
	semanticBumpResult,
	standardsSha256,
} from '../../../src/standards/index.ts';

const digest = `sha256:${'a'.repeat(64)}` as const;
const candidateDigest = `sha256:${'b'.repeat(64)}` as const;

function bundle() {
	return createStandardsContractBundle({
		package: { name: '@treeseed/sdk', version: '0.13.0-rc.1', sourceCommit: 'c'.repeat(40), artifactDigest: digest },
		contracts: [{
			id: 'typescript-public-api', family: 'typescript', version: '1',
			artifact: { path: 'contracts/typescript.json', mediaType: 'application/json', digest },
			entrypoints: ['./standards', '.'], guarantees: ['export-map-closed'], deprecations: [],
		}],
		evidence: [{ kind: 'test', uri: 'tests/contract/standards/standards-foundation.test.ts' }],
	});
}

describe('portable standards foundation', () => {
	it('canonicalizes object keys while preserving semantic array order', async () => {
		const left = { z: 2, a: { y: true, x: ['first', 'second'] } };
		const reordered = { a: { x: ['first', 'second'], y: true }, z: 2 };
		expect(canonicalStandardsJson(left)).toBe(canonicalStandardsJson(reordered));
		expect(await standardsSha256(left)).toBe(await standardsSha256(reordered));
		expect(await standardsSha256({ values: ['first', 'second'] }))
			.not.toBe(await standardsSha256({ values: ['second', 'first'] }));
	});

	it('normalizes deterministic bundles, compositions, attestations, and portfolio entries', () => {
		expect(bundle().contracts[0]?.entrypoints).toEqual(['.', './standards']);
		const result = semanticBumpResult('compatible_addition', 'minor');
		expect(result).toEqual({ classification: 'compatible_addition', required: 'minor', declared: 'minor', sufficient: true });
		expect(createCompatibilityAttestation({
			contractId: 'typescript-public-api', baselineBundle: digest, candidateBundle: candidateDigest, result,
			findings: [], evidence: [],
		})).toMatchObject({ schemaVersion: 1, contractId: 'typescript-public-api' });
		expect(createStandardsComposition({
			id: 'sdk-rc-1', members: [{
				packageName: '@treeseed/sdk', packageVersion: '0.13.0-rc.1', sourceCommit: 'c'.repeat(40),
				packageDigest: digest, contractBundleDigest: candidateDigest, compatibilityAttestationDigests: [digest],
			}],
		})).toMatchObject({ schemaVersion: 1, id: 'sdk-rc-1' });
		expect(createStandardsPortfolioEntry({
			packageName: '@treeseed/sdk', acceptedVersion: '0.13.0-rc.1', acceptedSourceCommit: 'c'.repeat(40),
			packageDigest: digest, contractBundleDigest: candidateDigest, compositionIds: ['sdk-rc-1'], rollbackOperations: ['npm dist-tag rm'],
		})).toMatchObject({ schemaVersion: 1, packageName: '@treeseed/sdk' });
	});

	it('rejects duplicate contract and composition identities', () => {
		const value = bundle();
		expect(() => createStandardsContractBundle({ ...value, contracts: [value.contracts[0]!, value.contracts[0]!] }))
			.toThrow(/Duplicate standards identity/u);
		expect(() => createStandardsComposition({ id: 'invalid', members: [
			{ packageName: 'same', packageVersion: '1.0.0', sourceCommit: 'c'.repeat(40), packageDigest: digest, contractBundleDigest: digest, compatibilityAttestationDigests: [] },
			{ packageName: 'same', packageVersion: '1.0.1', sourceCommit: 'd'.repeat(40), packageDigest: digest, contractBundleDigest: digest, compatibilityAttestationDigests: [] },
		] })).toThrow(/Duplicate composition package/u);
	});

	it('classifies semantic bump sufficiency without treating breaking changes as patches', () => {
		expect(semanticBumpResult('unchanged', 'patch').sufficient).toBe(true);
		expect(semanticBumpResult('compatible_addition', 'patch').sufficient).toBe(false);
		expect(semanticBumpResult('breaking', 'minor').sufficient).toBe(false);
		expect(semanticBumpResult('breaking', 'major').sufficient).toBe(true);
	});
});
