import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync,lstatSync,readdirSync } from 'node:fs';
import { relative,resolve } from 'node:path';

const API_RUNTIME_INPUTS = [
	'packages/api/src',
	'packages/api/migrations',
	'packages/api/package.json',
	'packages/api/tsconfig.json',
	'packages/sdk/dist',
	'packages/sdk/drizzle/market',
	'packages/sdk/package.json',
	'packages/sdk/src',
] as const;

const WEB_RUNTIME_INPUTS = [
	'src',
	'astro.config.mjs',
	'package.json',
	'treeseed.site.yaml',
	'packages/admin/dist',
	'packages/admin/package.json',
	'packages/admin/src',
	'packages/core/dist',
	'packages/core/package.json',
	'packages/core/src',
	'packages/ui/dist',
	'packages/ui/package.json',
	'packages/ui/src',
	'packages/sdk/dist',
	'packages/sdk/package.json',
	'packages/sdk/src',
] as const;

const WEB_BUILD_ORDER = ['packages/sdk','packages/ui','packages/core','packages/admin'] as const;

function newestMtime(path: string): number {
	if (!existsSync(path)) return 0;
	const stat = lstatSync(path);
	if (stat.isFile()) return stat.mtimeMs;
	if (!stat.isDirectory() || stat.isSymbolicLink()) return 0;
	return readdirSync(path).reduce((latest, entry) => Math.max(latest, newestMtime(resolve(path, entry))), 0);
}

export function managedDevStaleRuntimePackages(input: { tenantRoot:string; surfaces:string[] }) {
	const required = new Set<string>();
	if (input.surfaces.some((surface) => ['api', 'operations-runner'].includes(surface))) required.add('packages/sdk');
	if (input.surfaces.includes('web')) WEB_BUILD_ORDER.forEach((entry) => required.add(entry));
	return WEB_BUILD_ORDER.filter((packagePath) => {
		if (!required.has(packagePath)) return false;
		const root = resolve(input.tenantRoot, packagePath);
		const source = Math.max(
			newestMtime(resolve(root, 'src')),
			newestMtime(resolve(root, 'package.json')),
			packagePath === 'packages/sdk' ? newestMtime(resolve(root, 'drizzle')) : 0,
		);
		const output = newestMtime(resolve(root, 'dist'));
		return output <= 0 || output < source;
	});
}

export function ensureManagedDevRuntimeBuilds(input: { tenantRoot:string; surfaces:string[] }) {
	const rebuilt: string[] = [];
	for (const packagePath of managedDevStaleRuntimePackages(input)) {
		const root = resolve(input.tenantRoot, packagePath);
		try {
			execFileSync('npm', ['--prefix', root, 'run', 'build:dist'], { cwd: input.tenantRoot, stdio: 'inherit' });
			rebuilt.push(packagePath);
		} catch (error) {
			throw new Error(`Managed development could not rebuild stale runtime package ${packagePath}.`, { cause: error });
		}
	}
	return rebuilt;
}

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
			const stat = lstatSync(file);
			hash.update(relative(input.tenantRoot, file));
			hash.update('\0');
			hash.update(String(stat.size));
			hash.update('\0');
			hash.update(String(stat.mtimeMs));
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
