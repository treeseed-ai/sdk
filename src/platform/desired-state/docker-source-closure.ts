import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const PACKAGE_INPUTS = ['Dockerfile', 'src', 'scripts', 'templates', 'docs', 'package.json', 'package-lock.json'] as const;
const AGENT_SDK_INPUTS = ['../sdk/src', '../sdk/package.json', '../sdk/package-lock.json'] as const;

function files(path: string): string[] {
	if (!existsSync(path)) return [];
	const stat = lstatSync(path);
	if (stat.isSymbolicLink()) return [];
	if (stat.isFile()) return [path];
	if (!stat.isDirectory()) return [];
	return readdirSync(path).sort().flatMap((entry) => files(resolve(path, entry)));
}

export function dockerSourceClosureDigest(packageRoot: string, packageId: string) {
	const inputs = packageId === '@treeseed/agent' ? [...PACKAGE_INPUTS, ...AGENT_SDK_INPUTS] : [...PACKAGE_INPUTS];
	const hash = createHash('sha256');
	for (const input of inputs) {
		const matches = files(resolve(packageRoot, input));
		hash.update(input);
		hash.update('\0');
		if (matches.length === 0) hash.update('<missing>\0');
		for (const file of matches) {
			hash.update(relative(packageRoot, file));
			hash.update('\0');
			hash.update(readFileSync(file));
			hash.update('\0');
		}
	}
	return hash.digest('hex');
}
