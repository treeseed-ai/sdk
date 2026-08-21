import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { canonicalStandardsJson, parseStandardsPackageManifest, standardsSha256 } from '../../src/standards/index.ts';
import type { StandardsCompatibilityAttestation, StandardsComposition, StandardsContractBundle } from '../../src/standards/index.ts';

const root = resolve(import.meta.dirname, '../..');
const read = <T>(path: string) => JSON.parse(readFileSync(resolve(root, path), 'utf8')) as T;
const packageJson = read<{ name: string; version: string }>('package.json');
const manifestDocument = parseYaml(readFileSync(resolve(root, 'treeseed.package.yaml'), 'utf8')) as { standards: unknown };
const acceptedBaseline = parseStandardsPackageManifest(manifestDocument.standards).acceptedBaseline;
if (!acceptedBaseline) throw new Error('Release evidence requires an accepted baseline.');
const baselineReceipt = read<Record<string, unknown>>('.treeseed/standards/baseline/receipt.json');
for (const key of ['packageName', 'packageVersion', 'sourceCommit', 'npmIntegrity', 'artifactDigest', 'openApiSourceDigest'] as const) {
	if (baselineReceipt[key] !== acceptedBaseline[key]) throw new Error(`Accepted baseline receipt does not match manifest field ${key}.`);
}
const bundle = read<StandardsContractBundle>('.treeseed/standards/contract-bundle.json');
const attestation = read<StandardsCompatibilityAttestation>('.treeseed/standards/compatibility-attestation.json');
const composition = read<StandardsComposition>('.treeseed/standards/composition.json');
const consumer = read<Record<string, unknown>>('.treeseed/standards/api-consumer-receipt.json');
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const trackedStatus = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8' }).trim();
if (trackedStatus) throw new Error('Release evidence requires a clean tracked source tree.');
const tarballPath = `.treeseed/standards/package/treeseed-sdk-${packageJson.version}.tgz`;
const packageDigest = `sha256:${createHash('sha256').update(readFileSync(resolve(root, tarballPath))).digest('hex')}`;
if (bundle.package.name !== packageJson.name || bundle.package.version !== packageJson.version || bundle.package.sourceCommit !== sourceCommit || bundle.package.artifactDigest !== packageDigest) {
	throw new Error('Candidate bundle is not bound to the exact source commit, version, and package artifact.');
}
const baselineBundle = read<StandardsContractBundle>('.treeseed/standards/baseline/contract-bundle.json');
if (attestation.baselineBundle !== await standardsSha256(baselineBundle)
	|| attestation.candidateBundle !== await standardsSha256(bundle)
	|| !attestation.result.sufficient) throw new Error('Compatibility attestation is not sufficient or bound to the exact bundles.');
const member = composition.members.find((entry) => entry.packageName === packageJson.name);
if (!member || member.packageVersion !== packageJson.version || member.sourceCommit !== sourceCommit
	|| member.packageDigest !== packageDigest || member.contractBundleDigest !== await standardsSha256(bundle)
	|| !member.compatibilityAttestationDigests.includes(await standardsSha256(attestation))) {
	throw new Error('Accepted composition is not bound to the exact candidate evidence.');
}
if (consumer.candidateArtifactDigest !== packageDigest || consumer.candidateVersion !== packageJson.version
	|| consumer.consumerCommits !== 0 || consumer.build !== 'passed') throw new Error('API consumer receipt is absent or does not bind the exact candidate.');
const receipt = {
	schemaVersion: 1,
	packageName: packageJson.name,
	packageVersion: packageJson.version,
	sourceCommit,
	packageArtifact: tarballPath,
	packageDigest,
	baselineReceiptDigest: await standardsSha256(baselineReceipt),
	contractBundleDigest: await standardsSha256(bundle),
	compatibilityAttestationDigest: await standardsSha256(attestation),
	compositionDigest: await standardsSha256(composition),
	consumerReceiptDigest: await standardsSha256(consumer),
};
const outputPath = resolve(root, '.treeseed/standards/release-evidence.json');
writeFileSync(outputPath, `${canonicalStandardsJson(receipt)}\n`);
console.log(JSON.stringify({ ok: true, ...receipt, outputPath }));
