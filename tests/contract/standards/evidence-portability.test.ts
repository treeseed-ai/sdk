import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalStandardsJson, createStandardsContractBundle } from '../../../src/standards/index.ts';

const digest = `sha256:${'a'.repeat(64)}` as const;

describe('standards evidence portability', () => {
	it('emits byte-identical attestations from identical inputs in different checkout paths', () => {
		const root = resolve(import.meta.dirname, '../../..');
		const directories = [mkdtempSync(resolve(tmpdir(), 'standards-path-a-')), mkdtempSync(resolve(tmpdir(), 'standards-path-b-'))];
		try {
			for (const directory of directories) {
				const baseline = { schemaVersion: 1, packageVersion: '0.12.62', typescript: { schemaVersion: 1, entrypoints: [] }, openapi: { schemaVersion: 1, openapi: '3.1.0', operations: {} } };
				const candidate = { ...baseline, packageVersion: '0.12.63' };
				const baselineBundle = createStandardsContractBundle({
					package: { name: '@treeseed/sdk', version: baseline.packageVersion, sourceCommit: 'b'.repeat(40), artifactDigest: digest }, contracts: [], evidence: [],
				});
				const candidateBundle = createStandardsContractBundle({
					package: { name: '@treeseed/sdk', version: candidate.packageVersion, sourceCommit: 'c'.repeat(40), artifactDigest: digest }, contracts: [], evidence: [],
				});
				for (const [name, value] of Object.entries({ baseline, candidate, baselineBundle, candidateBundle })) {
					writeFileSync(resolve(directory, `${name}.json`), `${canonicalStandardsJson(value)}\n`);
				}
				execFileSync(process.execPath, [
					'--import', 'tsx', resolve(root, 'scripts/standards/compare-compatibility.ts'),
					'--baseline', resolve(directory, 'baseline.json'), '--candidate', resolve(directory, 'candidate.json'),
					'--baseline-bundle', resolve(directory, 'baselineBundle.json'), '--candidate-bundle', resolve(directory, 'candidateBundle.json'),
					'--output', resolve(directory, 'attestation.json'),
				], { cwd: root, stdio: 'pipe' });
			}
			expect(readFileSync(resolve(directories[0]!, 'attestation.json')))
				.toEqual(readFileSync(resolve(directories[1]!, 'attestation.json')));
		} finally {
			for (const directory of directories) rmSync(directory, { recursive: true, force: true });
		}
	});
});
