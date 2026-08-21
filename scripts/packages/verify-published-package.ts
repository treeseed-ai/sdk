import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const evidence = JSON.parse(readFileSync(resolve(root, '.treeseed/standards/release-evidence.json'), 'utf8')) as {
	packageName: string;
	packageVersion: string;
	packageDigest: string;
};
const baseline = JSON.parse(readFileSync(resolve(root, '.treeseed/standards/baseline/receipt.json'), 'utf8')) as { latestDistTag: string };
const destination = mkdtempSync(resolve(tmpdir(), 'treeseed-sdk-published-'));
try {
	let observedDigest = '';
	let tags: Record<string, string> = {};
	for (let attempt = 0; attempt < 40; attempt += 1) {
		try {
			const packed = JSON.parse(execFileSync('npm', [
				'pack', `${evidence.packageName}@${evidence.packageVersion}`, '--json', '--ignore-scripts', '--prefer-online', '--pack-destination', destination,
			], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })) as Array<{ filename: string }>;
			observedDigest = `sha256:${createHash('sha256').update(readFileSync(resolve(destination, packed[0]!.filename))).digest('hex')}`;
			tags = JSON.parse(execFileSync('npm', ['view', evidence.packageName, 'dist-tags', '--json', '--prefer-online'], { cwd: root, encoding: 'utf8' })) as Record<string, string>;
			if (tags.latest !== baseline.latestDistTag) throw new Error(`npm latest changed from ${baseline.latestDistTag} to ${tags.latest ?? 'nothing'}.`);
			if (tags.rc !== evidence.packageVersion) throw new Error(`npm rc points to ${tags.rc ?? 'nothing'}, expected ${evidence.packageVersion}.`);
			break;
		} catch (error) {
			if (attempt === 39) throw error;
			await new Promise((resolveDelay) => setTimeout(resolveDelay, 3000));
		}
	}
	if (observedDigest !== evidence.packageDigest) throw new Error(`Published SDK digest ${observedDigest} does not match ${evidence.packageDigest}.`);
	console.log(JSON.stringify({ ok: true, packageVersion: evidence.packageVersion, packageDigest: observedDigest, rc: tags.rc, latest: tags.latest }));
} finally {
	rmSync(destination, { recursive: true, force: true });
}
