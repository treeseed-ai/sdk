import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { readBackPublishedPackage } from './published-package-readback.ts';

const root = resolve(import.meta.dirname, '../..');
const evidence = JSON.parse(readFileSync(resolve(root, '.treeseed/standards/release-evidence.json'), 'utf8')) as {
	packageName: string;
	packageVersion: string;
	packageDigest: string;
};
const baseline = JSON.parse(readFileSync(resolve(root, '.treeseed/standards/baseline/receipt.json'), 'utf8')) as { latestDistTag: string };
const destination = mkdtempSync(resolve(tmpdir(), 'treeseed-sdk-published-'));
try {
	const result = await readBackPublishedPackage({ ...evidence, latestDistTag: baseline.latestDistTag, destination, cwd: root });
	console.log(JSON.stringify({ ok: true, ...result }));
} finally {
	rmSync(destination, { recursive: true, force: true });
}
