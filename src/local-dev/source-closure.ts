import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const API_RUNTIME_INPUTS = [
	'packages/api/src',
	'packages/api/migrations',
	'packages/api/package.json',
	'packages/api/tsconfig.json',
	'packages/sdk/dist',
	'packages/sdk/package.json',
] as const;

function closureFiles(path: string): string[] {
	if (!existsSync(path)) return [];
	const stat = lstatSync(path);
	if (stat.isSymbolicLink()) return [];
	if (stat.isFile()) return [path];
	if (!stat.isDirectory()) return [];
	return readdirSync(path)
		.sort()
		.flatMap((entry) => closureFiles(resolve(path, entry)));
}

export function managedDevSourceClosureDigest(input: {
	tenantRoot: string;
	surface: string;
}): string | null {
	if (input.surface !== 'api' && input.surface !== 'operations-runner') return null;
	const hash = createHash('sha256');
	for (const configuredPath of API_RUNTIME_INPUTS) {
		const absolutePath = resolve(input.tenantRoot, configuredPath);
		const files = closureFiles(absolutePath);
		hash.update(configuredPath);
		hash.update('\0');
		if (files.length === 0) {
			hash.update('<missing>');
			hash.update('\0');
			continue;
		}
		for (const file of files) {
			hash.update(relative(input.tenantRoot, file));
			hash.update('\0');
			hash.update(readFileSync(file));
			hash.update('\0');
		}
	}
	return hash.digest('hex');
}
