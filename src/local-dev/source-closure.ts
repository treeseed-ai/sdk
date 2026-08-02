import { createHash } from 'node:crypto';
import { existsSync,lstatSync,readdirSync,readFileSync } from 'node:fs';
import { relative,resolve } from 'node:path';

const API_RUNTIME_INPUTS = [
	'packages/api/src',
	'packages/api/migrations',
	'packages/api/package.json',
	'packages/api/tsconfig.json',
	'packages/sdk/dist',
	'packages/sdk/package.json',
] as const;

const WEB_RUNTIME_INPUTS = [
	'src',
	'astro.config.mjs',
	'package.json',
	'treeseed.site.yaml',
	'packages/admin/dist',
	'packages/admin/package.json',
	'packages/core/dist',
	'packages/core/package.json',
	'packages/ui/dist',
	'packages/ui/package.json',
	'packages/sdk/dist',
	'packages/sdk/package.json',
] as const;

const TREEDX_RUNTIME_INPUTS = [
	'packages/treedx/apps/api/lib',
	'packages/treedx/apps/api/config',
	'packages/treedx/apps/api/mix.exs',
	'packages/treedx/crates/treedx_git/src',
	'packages/treedx/crates/treedx_graph/src',
	'packages/treedx/crates/treedx_store/src',
	'packages/treedx/Cargo.toml',
	'packages/treedx/Cargo.lock',
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
	runtimeEnv?: Record<string, string>;
}): string | null {
	const configuredPaths = input.surface === 'web'
		? WEB_RUNTIME_INPUTS
		: input.surface === 'treedx'
			? TREEDX_RUNTIME_INPUTS
		: input.surface === 'api' || input.surface === 'operations-runner'
			? API_RUNTIME_INPUTS
			: null;
	if (!configuredPaths) return null;
	const hash = createHash('sha256');
	for (const configuredPath of configuredPaths) {
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
	for (const [key, value] of Object.entries(input.runtimeEnv ?? {})
		.filter(([key]) => (key.startsWith('TREESEED_') || key === 'LOCAL_DEV_MODE') && key !== 'TREESEED_KEY_PASSPHRASE')
		.sort(([left], [right]) => left.localeCompare(right))) {
		hash.update(key);
		hash.update('\0');
		hash.update(value);
		hash.update('\0');
	}
	return hash.digest('hex');
}
