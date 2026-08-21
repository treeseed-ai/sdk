import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import {
	canonicalStandardsJson,
	createStandardsContractBundle,
	standardsSha256,
} from '../../src/standards/index.ts';
import { normalizeOpenApi } from '../../src/standards/openapi/index.ts';
import { extractTypeScriptApi, type TypeScriptDeclarationEntrypointInput } from '../../src/standards/typescript/index.ts';

const root = resolve(import.meta.dirname, '../..');
const outputRoot = resolve(root, '.treeseed/standards');
mkdirSync(outputRoot, { recursive: true });
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
	name: string; version: string; exports: Record<string, unknown>;
};

function typesTarget(value: unknown): string | null {
	if (typeof value === 'string') return value.endsWith('.d.ts') ? value : null;
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	return typesTarget(record.types) ?? Object.values(record).map(typesTarget).find(Boolean) ?? null;
}

const entrypoints: TypeScriptDeclarationEntrypointInput[] = Object.entries(packageJson.exports).map(([specifier, value]) => {
	const target = typesTarget(value);
	if (!target) throw new Error(`Public export ${specifier} has no declaration target.`);
	const declarationPath = target.replace(/^\.\//u, '');
	const absolutePath = resolve(root, declarationPath);
	if (!existsSync(absolutePath)) throw new Error(`Public export ${specifier} declaration is missing: ${declarationPath}.`);
	return { specifier, declarationPath, source: readFileSync(absolutePath, 'utf8') };
});

function declarationFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = resolve(directory, entry.name);
		return entry.isDirectory() ? declarationFiles(path) : path.endsWith('.d.ts') ? [path] : [];
	});
}

const declarations = Object.fromEntries(declarationFiles(resolve(root, 'dist')).map((path) => [
	relative(root, path).replaceAll('\\', '/'),
	readFileSync(path, 'utf8'),
]));
const typescript = extractTypeScriptApi(entrypoints, declarations);
const openapi = normalizeOpenApi(JSON.parse(readFileSync(resolve(root, 'docs/api/openapi.json'), 'utf8')));
const models = { schemaVersion: 1, packageVersion: packageJson.version, typescript, openapi };
const modelsPath = resolve(outputRoot, 'contract-models.json');
writeFileSync(modelsPath, `${canonicalStandardsJson(models)}\n`);

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
			artifact: { path: '.treeseed/standards/contract-models.json', mediaType: 'application/json', digest: await standardsSha256(openapi) },
			entrypoints: ['docs/api/openapi.json'], guarantees: ['deterministic-normalization', 'local-ref-resolution'], deprecations: [],
		},
		{
			id: '@treeseed/sdk/typescript-public-api', family: 'typescript', version: '1.0.0',
			artifact: { path: '.treeseed/standards/contract-models.json', mediaType: 'application/json', digest: await standardsSha256(typescript) },
			entrypoints: Object.keys(packageJson.exports), guarantees: ['declared-export-closure', 'packed-declaration-source'], deprecations: [],
		},
	],
	evidence: [{ kind: 'source', uri: `git:${sourceCommit}` }, { kind: 'artifact', uri: tarball, digest: packageDigest }],
});
const bundlePath = resolve(outputRoot, 'contract-bundle.json');
writeFileSync(bundlePath, `${canonicalStandardsJson(bundle)}\n`);
console.log(JSON.stringify({ ok: true, sourceCommit, packageDigest, modelsDigest: await standardsSha256(models), bundleDigest: await standardsSha256(bundle), bundlePath, tarball }));
