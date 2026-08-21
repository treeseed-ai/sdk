import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { assertPackageReleaseTag, packageReleaseVersion, type PackageReleaseVersion } from './release-version.ts';

const packageRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const extraArgs = process.argv.slice(2);
const tagName = process.env.GITHUB_REF_NAME;
const packageVersion = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as { version: string };

if (extraArgs.some((argument) => argument === '--tag' || argument.startsWith('--tag='))) {
	console.error('release:publish owns npm dist-tag selection; a caller cannot override --tag.');
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

const npmArgs = ['publish', '.', '--access', 'public', '--tag', release.npmDistTag];

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
