import { existsSync, readFileSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import { standardsSha256 } from '../../src/standards/index.ts';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { assertPackageCandidateOutputs, assertPackageExportTargets } from './acceptance/package-exports.ts';

const root = resolve(import.meta.dirname, '../..');
const required = [
	'dist/standards/index.js', 'dist/standards/index.d.ts',
	'dist/standards/typescript/index.js', 'dist/standards/typescript/index.d.ts',
	'dist/standards/openapi/index.js', 'dist/standards/openapi/index.d.ts',
	'dist/standards/mcp/index.js', 'dist/standards/mcp/index.d.ts',
	'dist/operator-contracts/index.js', 'dist/operator-contracts/index.d.ts',
	'dist/treedx/index.js', 'dist/treedx/index.d.ts',
	'dist/treeai/index.js', 'dist/treeai/index.d.ts',
	'.treeseed/standards/contract-models.json', '.treeseed/standards/contract-bundle.json',
	'.treeseed/standards/typescript-public-api.json', '.treeseed/standards/openapi.json',
	'.treeseed/standards/control-plane-catalog.json', '.treeseed/standards/mcp-catalog-input.json',
	'.treeseed/standards/treedx-service-contract.json',
	'.treeseed/standards/treeai-service-contract.json',
];
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--archive')) throw new Error('Expected --archive <local npm tarball>.');
const archive = args[1] ? resolve(args[1]) : null;
const archiveFiles = archive ? new Set(execFileSync('tar', ['-tzf', archive], { encoding: 'utf8', timeout: 30000 }).trim().split('\n')) : null;
for (const path of archiveFiles ?? [])
	if (['package/dist/.treeseed-build-complete.json', 'package/dist/.treeseed-build-complete.json.new'].includes(posix.normalize(path)))
		throw new Error('Packed SDK archive contains a local build coordination marker.');
const missing = archive ? [] : required.filter((path) => !existsSync(resolve(root, path)));
if (missing.length) throw new Error(`Missing standards package outputs: ${missing.join(', ')}.`);
const localManifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { name: string; version: string; exports: Record<string, unknown>; types?: string };
const packageJson = archive ? JSON.parse(execFileSync('tar', ['-xOzf', archive, 'package/package.json'], { encoding: 'utf8', timeout: 30000 })) as typeof localManifest : localManifest;
if (archive && (packageJson.name !== localManifest.name || packageJson.version !== localManifest.version))
	throw new Error('Packed package identity differs from this candidate.');
for (const specifier of ['./standards', './standards/typescript', './standards/openapi', './standards/mcp', './operator-contracts', './treedx', './treeai']) {
	if (!packageJson.exports[specifier]) throw new Error(`Missing package export ${specifier}.`);
}
for (const forbidden of ['./treedx/auth', './treedx/transport', './treedx/openapi']) {
	if (packageJson.exports[forbidden]) throw new Error(`Direct TreeDX implementation export is forbidden: ${forbidden}.`);
}

const exists = (target: string) => archiveFiles ? archiveFiles.has(`package/${target.replace(/^\.\//u, '')}`) : existsSync(resolve(root, target));
const exportTargets = assertPackageExportTargets(packageJson.exports, exists);
if (archive) {
	assertPackageCandidateOutputs(packageJson.exports, localManifest.exports,
		target => execFileSync('tar', ['-xOzf', archive, `package/${target.slice(2)}`], { timeout: 30000 }),
		target => readFileSync(resolve(root, target)));
	for (const [specifier, entry] of Object.entries(packageJson.exports)) {
		const types = entry && typeof entry === 'object' ? (entry as { types?: unknown }).types : null;
		if (typeof types !== 'string' || !types.endsWith('.d.ts'))
			throw new Error(`Packed SDK export must declare TypeScript types: ${specifier}.`);
	}
	if (packageJson.types !== undefined) assertPackageExportTargets({ types: packageJson.types }, exists);
}

console.log(JSON.stringify({
	ok: true,
	files: archiveFiles?.size ?? required.length,
	exportTargets: exportTargets.length,
	exportMapDigest: await standardsSha256(packageJson.exports),
	...(archive ? { archiveDigest: `sha256:${createHash('sha256').update(readFileSync(archive)).digest('hex')}`,
		declarations: [...archiveFiles!].filter(path => path.endsWith('.d.ts')).length } : {}),
}));
