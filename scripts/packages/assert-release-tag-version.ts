import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPackageReleaseTag } from './release-version.ts';

const packageRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const packageJsonPath = resolve(packageRoot, 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const packageVersion = packageJson.version;

const tagName = process.argv[2] || process.env.GITHUB_REF_NAME;

if (!tagName) {
	console.error('Release tag validation requires a tag name argument or GITHUB_REF_NAME.');
	process.exit(1);
}

try {
	const release = assertPackageReleaseTag(tagName, packageVersion);
	console.log(`Release tag "${tagName}" matches @treeseed/sdk version "${packageVersion}" for npm dist-tag "${release.npmDistTag}".`);
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}
