import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { standardsSha256 } from '../../src/standards/index.ts';

const root = resolve(import.meta.dirname, '../..');
const required = [
	'dist/standards/index.js', 'dist/standards/index.d.ts',
	'dist/standards/typescript/index.js', 'dist/standards/typescript/index.d.ts',
	'dist/standards/openapi/index.js', 'dist/standards/openapi/index.d.ts',
];
const missing = required.filter((path) => !existsSync(resolve(root, path)));
if (missing.length) throw new Error(`Missing standards package outputs: ${missing.join(', ')}.`);
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { exports: Record<string, unknown> };
for (const specifier of ['./standards', './standards/typescript', './standards/openapi']) {
	if (!packageJson.exports[specifier]) throw new Error(`Missing package export ${specifier}.`);
}
console.log(JSON.stringify({ ok: true, files: required.length, exportMapDigest: await standardsSha256(packageJson.exports) }));
