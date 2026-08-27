import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { canonicalStandardsJson, parseStandardsPackageManifest, standardsSha256 } from '../../src/standards/index.ts';
import type { StandardsCompatibilityAttestation, StandardsComposition, StandardsContractBundle } from '../../src/standards/index.ts';
import { releaseEvidenceSchema } from '../../src/development/index.ts';

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
};
const outputPath = resolve(root, '.treeseed/standards/release-evidence.json');
writeFileSync(outputPath, `${canonicalStandardsJson(receipt)}\n`);
const contractBundleDigest = await standardsSha256(bundle);
const compatibilityAttestationDigest = await standardsSha256(attestation);
const sbomPath = '.treeseed/standards/sbom.cdx.json';
const sbomDigest = `sha256:${createHash('sha256').update(readFileSync(resolve(root, sbomPath))).digest('hex')}`;
const candidateReceiptDigest = await standardsSha256({ sourceCommit, packageDigest, contractBundleDigest, compatibilityAttestationDigest, compositionDigest: receipt.compositionDigest });
const releaseEvidence = releaseEvidenceSchema.parse({
	schemaVersion: 'treeseed.release-evidence/v1',
	candidate: {
		id: `candidate-${sourceCommit.slice(0, 12)}`,
		receiptDigest: candidateReceiptDigest,
		sourceCommit,
		stagingRef: process.env.GITHUB_REF ?? 'refs/heads/staging',
		workflowRunId: process.env.GITHUB_RUN_ID ?? '1',
		createdAt: new Date().toISOString(),
	},
	packages: [{ projectId: 'sdk', name: packageJson.name, version: packageJson.version, minimumBump: attestation.result.required }],
	artifacts: [
		{ id: 'sdk-package', kind: 'npm-package', identity: tarballPath, digest: packageDigest, mediaType: 'application/gzip', size: statSync(resolve(root, tarballPath)).size },
		{ id: 'sdk-sbom', kind: 'sbom', identity: sbomPath, digest: sbomDigest, mediaType: 'application/vnd.cyclonedx+json', size: statSync(resolve(root, sbomPath)).size },
		{ id: 'sdk-contracts', kind: 'contract-bundle', identity: '.treeseed/standards/contract-bundle.json', digest: contractBundleDigest, mediaType: 'application/json' },
		{ id: 'sdk-compatibility', kind: 'compatibility-attestation', identity: '.treeseed/standards/compatibility-attestation.json', digest: compatibilityAttestationDigest, mediaType: 'application/json' },
	],
	contractBundles: [{ id: 'sdk-contracts', digest: contractBundleDigest }],
	compatibilityAttestations: [{ contractId: attestation.contractId, digest: compatibilityAttestationDigest, compatible: true, minimumBump: attestation.result.required }],
	verification: { status: 'passed', operations: ['npm run verify:direct', 'npm run standards:compatibility', 'npm run standards:compose'], completedAt: new Date().toISOString() },
});
const custodyPath = resolve(root, '.treeseed/standards/release-evidence-v1.json');
writeFileSync(custodyPath, `${canonicalStandardsJson(releaseEvidence)}\n`);
console.log(JSON.stringify({ ok: true, ...receipt, outputPath, custodyPath, candidateReceiptDigest }));
