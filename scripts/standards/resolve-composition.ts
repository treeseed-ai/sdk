import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { canonicalStandardsJson, createStandardsComposition, standardsSha256 } from '../../src/standards/index.ts';
import type { StandardsCompatibilityAttestation, StandardsContractBundle } from '../../src/standards/index.ts';

const bundlePath = resolve(process.argv[2] ?? '.treeseed/standards/contract-bundle.json');
const attestationPath = resolve(process.argv[3] ?? '.treeseed/standards/compatibility-attestation.json');
const outputPath = resolve(process.argv[4] ?? '.treeseed/standards/composition.json');
const bundle = JSON.parse(readFileSync(bundlePath, 'utf8')) as StandardsContractBundle;
const attestation = JSON.parse(readFileSync(attestationPath, 'utf8')) as StandardsCompatibilityAttestation;
if (!attestation.result.sufficient) throw new Error('Cannot compose a package with an insufficient semantic version bump.');
const composition = createStandardsComposition({
	id: `${bundle.package.name}@${bundle.package.version}`,
	members: [{
		packageName: bundle.package.name, packageVersion: bundle.package.version, sourceCommit: bundle.package.sourceCommit,
		packageDigest: bundle.package.artifactDigest, contractBundleDigest: await standardsSha256(bundle),
		compatibilityAttestationDigests: [await standardsSha256(attestation)],
	}],
});
writeFileSync(outputPath, `${canonicalStandardsJson(composition)}\n`);
console.log(JSON.stringify({ ok: true, outputPath, digest: await standardsSha256(composition) }));
