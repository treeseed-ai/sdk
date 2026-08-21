import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
	canonicalStandardsJson,
	createStandardsContractBundle,
	parseStandardsPackageManifest,
	standardsSha256,
} from '../../src/standards/index.ts';
import { buildContractModels } from './contract-models.ts';

const root = resolve(import.meta.dirname, '../..');
const outputRoot = resolve(root, '.treeseed/standards/baseline');
const packageRoot = resolve(outputRoot, 'extracted/package');
const packageDirectory = resolve(outputRoot, 'package');
const manifestDocument = parseYaml(readFileSync(resolve(root, 'treeseed.package.yaml'), 'utf8')) as { standards: unknown };
const baseline = parseStandardsPackageManifest(manifestDocument.standards).acceptedBaseline;
if (!baseline) throw new Error('An immutable accepted baseline is required.');

const metadata = JSON.parse(execFileSync('npm', ['view', `${baseline.packageName}@${baseline.packageVersion}`, '--json'], {
	cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
})) as { name?: string; version?: string; gitHead?: string; dist?: { integrity?: string; shasum?: string; tarball?: string } };
const distTags = JSON.parse(execFileSync('npm', ['view', baseline.packageName, 'dist-tags', '--json'], {
	cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
})) as Record<string, string>;
if (metadata.name !== baseline.packageName || metadata.version !== baseline.packageVersion) throw new Error('npm baseline identity does not match the package manifest.');
if (metadata.gitHead !== baseline.sourceCommit) throw new Error(`npm baseline gitHead ${metadata.gitHead ?? 'missing'} does not match ${baseline.sourceCommit}.`);
if (metadata.dist?.integrity !== baseline.npmIntegrity) throw new Error('npm baseline integrity does not match the package manifest.');

rmSync(packageDirectory, { recursive: true, force: true });
rmSync(resolve(outputRoot, 'extracted'), { recursive: true, force: true });
mkdirSync(packageDirectory, { recursive: true });
mkdirSync(resolve(outputRoot, 'extracted'), { recursive: true });
const packed = JSON.parse(execFileSync('npm', [
	'pack', `${baseline.packageName}@${baseline.packageVersion}`, '--json', '--ignore-scripts', '--pack-destination', packageDirectory,
], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })) as Array<{ filename: string; integrity?: string; shasum?: string }>;
const packedResult = packed[0];
if (!packedResult) throw new Error('npm pack did not return an accepted baseline artifact.');
const tarball = resolve(packageDirectory, packedResult.filename);
if (!existsSync(tarball)) throw new Error('Accepted baseline tarball is missing after npm pack.');
const artifactDigest = `sha256:${createHash('sha256').update(readFileSync(tarball)).digest('hex')}`;
if (artifactDigest !== baseline.artifactDigest) throw new Error(`Accepted baseline tarball digest ${artifactDigest} does not match ${baseline.artifactDigest}.`);
if (packedResult.integrity !== baseline.npmIntegrity || packedResult.shasum !== metadata.dist?.shasum) throw new Error('npm pack baseline registry receipts do not match npm metadata.');
execFileSync('tar', ['-xzf', tarball, '-C', resolve(outputRoot, 'extracted')], { stdio: 'inherit' });

const openApiUri = `https://raw.githubusercontent.com/treeseed-ai/sdk/${baseline.sourceCommit}/docs/api/openapi.json`;
const response = await fetch(openApiUri);
if (!response.ok) throw new Error(`Unable to acquire accepted baseline OpenAPI at exact source commit: HTTP ${response.status}.`);
const openApiBytes = Buffer.from(await response.arrayBuffer());
const openApiSourceDigest = `sha256:${createHash('sha256').update(openApiBytes).digest('hex')}`;
if (openApiSourceDigest !== baseline.openApiSourceDigest) throw new Error(`Accepted baseline OpenAPI digest ${openApiSourceDigest} does not match ${baseline.openApiSourceDigest}.`);
const openApiDocument = JSON.parse(openApiBytes.toString('utf8'));
const { models } = buildContractModels({ packageRoot, openApiDocument, unresolvedLocalSymbols: 'record' });
const typeScriptPath = resolve(outputRoot, 'typescript-public-api.json');
const openApiPath = resolve(outputRoot, 'openapi.json');
const modelsPath = resolve(outputRoot, 'contract-models.json');
writeFileSync(typeScriptPath, `${canonicalStandardsJson(models.typescript)}\n`);
writeFileSync(openApiPath, `${canonicalStandardsJson(models.openapi)}\n`);
writeFileSync(modelsPath, `${canonicalStandardsJson(models)}\n`);

const bundle = createStandardsContractBundle({
	package: {
		name: baseline.packageName,
		version: baseline.packageVersion,
		sourceCommit: baseline.sourceCommit,
		artifactDigest: baseline.artifactDigest as `sha256:${string}`,
	},
	contracts: [
		{
			id: '@treeseed/sdk/openapi', family: 'openapi', version: '1.0.0',
			artifact: { path: '.treeseed/standards/baseline/openapi.json', mediaType: 'application/json', digest: await standardsSha256(models.openapi) },
			entrypoints: ['docs/api/openapi.json'], guarantees: ['deterministic-normalization', 'local-ref-resolution'], deprecations: [],
		},
		{
			id: '@treeseed/sdk/typescript-public-api', family: 'typescript', version: '1.0.0',
			artifact: { path: '.treeseed/standards/baseline/typescript-public-api.json', mediaType: 'application/json', digest: await standardsSha256(models.typescript) },
			entrypoints: models.typescript.entrypoints.map((entry) => entry.specifier), guarantees: ['declared-export-closure', 'packed-declaration-source'], deprecations: [],
		},
	],
	evidence: [
		{ kind: 'source', uri: `git:${baseline.sourceCommit}:docs/api/openapi.json`, digest: baseline.openApiSourceDigest as `sha256:${string}` },
		{ kind: 'artifact', uri: `npm:${baseline.packageName}@${baseline.packageVersion}`, digest: baseline.artifactDigest as `sha256:${string}` },
	],
});
const bundlePath = resolve(outputRoot, 'contract-bundle.json');
writeFileSync(bundlePath, `${canonicalStandardsJson(bundle)}\n`);
const receipt = {
	schemaVersion: 1,
	packageName: baseline.packageName,
	packageVersion: baseline.packageVersion,
	sourceCommit: baseline.sourceCommit,
	npmIntegrity: baseline.npmIntegrity,
	npmShasum: metadata.dist?.shasum,
	artifactDigest: baseline.artifactDigest,
	openApiSourceDigest: baseline.openApiSourceDigest,
	latestDistTag: distTags.latest,
	modelsDigest: await standardsSha256(models),
	bundleDigest: await standardsSha256(bundle),
};
const receiptPath = resolve(outputRoot, 'receipt.json');
writeFileSync(receiptPath, `${canonicalStandardsJson(receipt)}\n`);
console.log(JSON.stringify({ ok: true, ...receipt, receiptPath }));
