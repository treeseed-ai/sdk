import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const semverTagPattern = /^\d+\.\d+\.\d+$/;
const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const packageJsonPath = resolve(packageRoot, 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const packageVersion = packageJson.version;

const tagName = process.argv[2] || process.env.GITHUB_REF_NAME;

if (!tagName) {
	console.error('Release tag validation requires a tag name argument or GITHUB_REF_NAME.');
	process.exit(1);
}

if (!semverTagPattern.test(tagName)) {
	console.error(
		`Release tag "${tagName}" must use the "{MAJOR}.{MINOR}.{PATCH}" format, for example "${packageVersion}".`,
	);
	process.exit(1);
}

const taggedVersion = tagName;

if (taggedVersion !== packageVersion) {
	console.error(
		`Release tag version "${taggedVersion}" does not match @treeseed/sdk version "${packageVersion}".`,
	);
	process.exit(1);
}

console.log(`Release tag "${tagName}" matches @treeseed/sdk version "${packageVersion}".`);
