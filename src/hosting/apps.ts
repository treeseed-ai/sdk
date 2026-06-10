import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadTreeseedDeployConfigFromPath } from '../platform/deploy-config.ts';
import type { TreeseedDeployConfig } from '../platform/contracts.ts';

export interface TreeseedDiscoveredApplication {
	id: string;
	label: string;
	root: string;
	configPath: string;
	relativeRoot: string;
	config: TreeseedDeployConfig;
	roles: string[];
}

const IGNORED_DIRS = new Set([
	'.git',
	'.treeseed',
	'.astro',
	'.cache',
	'dist',
	'node_modules',
	'coverage',
	'target',
]);

function readPackageJson(root: string) {
	try {
		return JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as Record<string, unknown>;
	} catch {
		return null;
	}
}

function workspacePackageRoots(root: string) {
	const packageJson = readPackageJson(root);
	const workspaces = Array.isArray(packageJson?.workspaces)
		? packageJson.workspaces
		: packageJson?.workspaces && typeof packageJson.workspaces === 'object' && Array.isArray((packageJson.workspaces as Record<string, unknown>).packages)
			? (packageJson.workspaces as { packages: unknown[] }).packages
			: [];
	const roots = new Set<string>();
	for (const pattern of workspaces) {
		if (typeof pattern !== 'string') continue;
		const normalized = pattern.trim();
		if (!normalized.endsWith('/*')) continue;
		const base = resolve(root, normalized.slice(0, -2));
		if (!existsSync(base)) continue;
		for (const entry of readdirSync(base, { withFileTypes: true })) {
			if (!entry.isDirectory() || IGNORED_DIRS.has(entry.name)) continue;
			roots.add(resolve(base, entry.name));
		}
	}
	return [...roots].sort();
}

function applicationRoles(config: TreeseedDeployConfig) {
	const roles: string[] = [];
	if (config.surfaces?.web?.enabled !== false && config.surfaces?.web) roles.push('web');
	if (config.surfaces?.api?.enabled === true || config.services?.api?.enabled !== false && config.services?.api) roles.push('api');
	if (config.services?.operationsRunner?.enabled !== false && config.services?.operationsRunner) roles.push('operations-runner');
	if (config.hosting?.kind === 'treeseed_control_plane') roles.push('treeseed-control-plane');
	return [...new Set(roles)];
}

function inferApplicationId(config: TreeseedDeployConfig, root: string, workspaceRoot: string) {
	const roles = applicationRoles(config);
	const hasBackendServices = Boolean(config.services?.api || config.services?.operationsRunner || config.services?.treeseedDatabase);
	if (
		config.hosting?.kind === 'treeseed_control_plane'
		|| roles.includes('api')
		|| roles.includes('operations-runner')
	) {
		return 'api';
	}
	if (roles.includes('web') && !hasBackendServices && root === workspaceRoot) return 'web';
	const relative = root === workspaceRoot ? '.' : root.slice(workspaceRoot.length + 1).replaceAll('\\', '/');
	const configuredId = config.hosting?.projectId ?? config.runtime?.projectId ?? config.slug ?? relative;
	return (configuredId || 'app').replace(/^treeseed-/u, '').replace(/[^a-z0-9-]+/giu, '-').replace(/^-|-$/gu, '') || 'app';
}

function appFromConfigPath(configPath: string, workspaceRoot: string): TreeseedDiscoveredApplication {
	const root = dirname(configPath);
	const config = loadTreeseedDeployConfigFromPath(configPath);
	const roles = applicationRoles(config);
	const id = inferApplicationId(config, root, workspaceRoot);
	const relativeRoot = root === workspaceRoot ? '.' : root.slice(workspaceRoot.length + 1).replaceAll('\\', '/');
	return {
		id,
		label: config.name,
		root,
		configPath,
		relativeRoot,
		config,
		roles,
	};
}

export function discoverTreeseedApplications(workspaceRootInput: string): TreeseedDiscoveredApplication[] {
	const workspaceRoot = resolve(workspaceRootInput);
	const candidates = [
		workspaceRoot,
		...workspacePackageRoots(workspaceRoot),
	];
	const seenIds = new Set<string>();
	const apps: TreeseedDiscoveredApplication[] = [];
	for (const root of candidates) {
		const configPath = resolve(root, 'treeseed.site.yaml');
		if (!existsSync(configPath)) continue;
		const app = appFromConfigPath(configPath, workspaceRoot);
		let id = app.id;
		let suffix = 2;
		while (seenIds.has(id)) {
			id = `${app.id}-${suffix++}`;
		}
		seenIds.add(id);
		apps.push({ ...app, id });
	}
	return apps;
}

export function findTreeseedApplication(workspaceRoot: string, appId: string) {
	return discoverTreeseedApplications(workspaceRoot).find((app) => app.id === appId || app.relativeRoot === appId) ?? null;
}
