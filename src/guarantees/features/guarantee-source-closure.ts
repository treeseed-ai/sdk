import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { managedDevSourceClosureDigest } from '../../local-dev/source-closure.ts';

function filesUnder(path: string): string[] {
	if (!existsSync(path)) return [];
	const stat = lstatSync(path);
	if (stat.isSymbolicLink()) return [];
	if (stat.isFile()) return [path];
	if (!stat.isDirectory()) return [];
	return readdirSync(path).sort().flatMap((entry) => filesUnder(resolve(path, entry)));
}

function guaranteeContractDigest(workspaceRoot: string) {
	const packagesRoot = resolve(workspaceRoot, 'packages');
	const roots = [
		resolve(workspaceRoot, 'guarantees'),
		...(existsSync(packagesRoot) ? readdirSync(packagesRoot, { withFileTypes: true }) : [])
			.filter((entry) => entry.isDirectory())
			.map((entry) => resolve(packagesRoot, entry.name, 'guarantees')),
	];
	const hash = createHash('sha256');
	for (const file of roots.flatMap(filesUnder).sort()) {
		hash.update(relative(workspaceRoot, file));
		hash.update('\0');
		hash.update(readFileSync(file));
		hash.update('\0');
	}
	return hash.digest('hex');
}

export function guaranteeSourceClosure(workspaceRoot: string) {
	return {
		schemaVersion: 'treeseed.guarantee-source-closure/v1' as const,
		web: managedDevSourceClosureDigest({ tenantRoot: workspaceRoot, surface: 'web' }),
		api: managedDevSourceClosureDigest({ tenantRoot: workspaceRoot, surface: 'api' }),
		contracts: guaranteeContractDigest(workspaceRoot),
	};
}
