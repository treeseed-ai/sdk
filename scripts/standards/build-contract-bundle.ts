import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	canonicalStandardsJson,
	createStandardsContractBundle,
	standardsSha256,
} from '../../src/standards/index.ts';
import { buildMcpCatalog, CONTROL_PLANE_CATALOG } from '../../src/operator-contracts/index.ts';
import { buildContractModels } from './contract-models.ts';

const root = resolve(import.meta.dirname, '../..');
const outputRoot = resolve(root, '.treeseed/standards');
mkdirSync(outputRoot, { recursive: true });
const { packageJson, models } = buildContractModels({
	packageRoot: root,
	openApiDocument: JSON.parse(readFileSync(resolve(root, 'docs/api/openapi.json'), 'utf8')),
});
const { typescript, openapi } = models;
const modelsPath = resolve(outputRoot, 'contract-models.json');
writeFileSync(modelsPath, `${canonicalStandardsJson(models)}\n`);
const typeScriptArtifactPath = resolve(outputRoot, 'typescript-public-api.json');
const openApiArtifactPath = resolve(outputRoot, 'openapi.json');
const controlPlaneCatalogPath = resolve(outputRoot, 'control-plane-catalog.json');
const mcpCatalogInput = buildMcpCatalog(CONTROL_PLANE_CATALOG.operations);
const mcpCatalogInputPath = resolve(outputRoot, 'mcp-catalog-input.json');
writeFileSync(typeScriptArtifactPath, `${canonicalStandardsJson(typescript)}\n`);
writeFileSync(openApiArtifactPath, `${canonicalStandardsJson(openapi)}\n`);
writeFileSync(controlPlaneCatalogPath, `${canonicalStandardsJson(CONTROL_PLANE_CATALOG)}\n`);
writeFileSync(mcpCatalogInputPath, `${canonicalStandardsJson(mcpCatalogInput)}\n`);

const packRoot = resolve(outputRoot, 'package');
mkdirSync(packRoot, { recursive: true });
const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', packRoot], {
	cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
})) as Array<{ filename: string }>;
const tarball = resolve(packRoot, packed[0]?.filename ?? '');
if (!existsSync(tarball)) throw new Error('npm pack did not produce the declared SDK tarball.');
const packageDigest = `sha256:${createHash('sha256').update(readFileSync(tarball)).digest('hex')}` as const;
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const bundle = createStandardsContractBundle({
	package: { name: packageJson.name, version: packageJson.version, sourceCommit, artifactDigest: packageDigest },
	contracts: [
		{
			id: '@treeseed/sdk/openapi', family: 'openapi', version: '1.0.0',
			artifact: { path: '.treeseed/standards/openapi.json', mediaType: 'application/json', digest: await standardsSha256(openapi) },
			entrypoints: ['docs/api/openapi.json'], guarantees: ['deterministic-normalization', 'local-ref-resolution'], deprecations: [],
		},
		{
			id: '@treeseed/sdk/typescript-public-api', family: 'typescript', version: '1.0.0',
			artifact: { path: '.treeseed/standards/typescript-public-api.json', mediaType: 'application/json', digest: await standardsSha256(typescript) },
			entrypoints: Object.keys(packageJson.exports), guarantees: ['declared-export-closure', 'packed-declaration-source'], deprecations: [],
		},
		{
			id: '@treeseed/sdk/control-plane-catalog', family: 'json-schema', version: '1.0.0',
			artifact: { path: '.treeseed/standards/control-plane-catalog.json', mediaType: 'application/json', digest: await standardsSha256(CONTROL_PLANE_CATALOG) },
			entrypoints: ['@treeseed/sdk/operator-contracts'], guarantees: ['unique-operation-ids', 'unique-rest-bindings', 'catalog-only-client'], deprecations: [],
		},
		{
			id: '@treeseed/sdk/mcp-catalog-input', family: 'behavioral', version: '1.0.0',
			artifact: { path: '.treeseed/standards/mcp-catalog-input.json', mediaType: 'application/json', digest: await standardsSha256(mcpCatalogInput) },
			entrypoints: ['@treeseed/sdk/operator-contracts'], guarantees: ['catalog-derived-mcp-tools', 'catalog-derived-mcp-resources', 'catalog-owned-mcp-prompts'], deprecations: [],
		},
	],
	evidence: [
		{ kind: 'source', uri: `git:${sourceCommit}` },
		{ kind: 'artifact', uri: `.treeseed/standards/package/${packed[0]!.filename}`, digest: packageDigest },
	],
});
const bundlePath = resolve(outputRoot, 'contract-bundle.json');
writeFileSync(bundlePath, `${canonicalStandardsJson(bundle)}\n`);
console.log(JSON.stringify({
	ok: true, sourceCommit, packageDigest, modelsDigest: await standardsSha256(models),
	controlPlaneCatalogDigest: await standardsSha256(CONTROL_PLANE_CATALOG),
	mcpCatalogInputDigest: await standardsSha256(mcpCatalogInput),
	bundleDigest: await standardsSha256(bundle), bundlePath, tarball,
}));
