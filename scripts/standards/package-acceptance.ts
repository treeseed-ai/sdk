import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { standardsSha256 } from '../../src/standards/index.ts';

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
const missing = required.filter((path) => !existsSync(resolve(root, path)));
if (missing.length) throw new Error(`Missing standards package outputs: ${missing.join(', ')}.`);
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { exports: Record<string, unknown> };
for (const specifier of ['./standards', './standards/typescript', './standards/openapi', './standards/mcp', './operator-contracts', './treedx', './treeai']) {
	if (!packageJson.exports[specifier]) throw new Error(`Missing package export ${specifier}.`);
}
for (const forbidden of ['./treedx/auth', './treedx/transport', './treedx/openapi']) {
	if (packageJson.exports[forbidden]) throw new Error(`Direct TreeDX implementation export is forbidden: ${forbidden}.`);
}

function collectExportTargets(value: unknown): string[] {
	if (typeof value === 'string') return [value];
	if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
	return Object.values(value).flatMap(collectExportTargets);
}

const exportTargets = [...new Set(collectExportTargets(packageJson.exports))];
const missingExportTargets = exportTargets.filter((target) => {
	if (!target.startsWith('./')) {
		throw new Error(`Package export targets must be package-relative: ${target}.`);
	}
	return !existsSync(resolve(root, target));
});
if (missingExportTargets.length) {
	throw new Error(`Package exports reference missing build outputs: ${missingExportTargets.join(', ')}.`);
}

console.log(JSON.stringify({
	ok: true,
	files: required.length,
	exportTargets: exportTargets.length,
	exportMapDigest: await standardsSha256(packageJson.exports),
}));
