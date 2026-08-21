import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { assertPackageReleaseTag, packageReleaseVersion, type PackageReleaseVersion } from './release-version.ts';

const packageRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const extraArgs = process.argv.slice(2);
const tagName = process.env.GITHUB_REF_NAME;
const packageVersion = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as { version: string };
const evidence = JSON.parse(readFileSync(resolve(packageRoot, '.treeseed/standards/release-evidence.json'), 'utf8')) as {
	packageName: string;
	packageVersion: string;
	sourceCommit: string;
	packageArtifact: string;
	packageDigest: string;
};

if (extraArgs.some((argument) => argument === '--tag' || argument.startsWith('--tag='))) {
	console.error('release:publish owns npm dist-tag selection; a caller cannot override --tag.');
	process.exit(1);
}

const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: packageRoot, encoding: 'utf8' }).trim();
const trackedStatus = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: packageRoot, encoding: 'utf8' }).trim();
if (trackedStatus) {
	console.error('SDK publication requires a clean tracked source tree.');
	process.exit(1);
}
const packageArtifact = resolve(packageRoot, evidence.packageArtifact);
const artifactDigest = `sha256:${createHash('sha256').update(readFileSync(packageArtifact)).digest('hex')}`;
if (evidence.packageName !== '@treeseed/sdk' || evidence.packageVersion !== packageVersion.version
	|| evidence.sourceCommit !== sourceCommit || evidence.packageDigest !== artifactDigest) {
	console.error('Release evidence does not bind the exact SDK source, version, and immutable package artifact.');
	process.exit(1);
}

let release: PackageReleaseVersion;
try {
	release = tagName
		? assertPackageReleaseTag(tagName, packageVersion.version)
		: packageReleaseVersion(packageVersion.version);
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}

const npmArgs = ['publish', packageArtifact, '--access', 'public', '--tag', release.npmDistTag];

if (process.env.GITHUB_ACTIONS === 'true') {
	npmArgs.push('--provenance');
}

npmArgs.push(...extraArgs);

const result = spawnSync('npm', npmArgs, {
	cwd: packageRoot,
	encoding: 'utf8',
	env: process.env,
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

if (result.error) {
	console.error(result.error.message);
	process.exit(1);
}

process.exit(result.status ?? 1);
