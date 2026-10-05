import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parse } from 'yaml';
import { inventorySchema, profileSchema, type Inventory, type PlatformProfile } from './schemas.ts';

export interface LoadedInventory { root: string; path: string; digest: string; inventory: Inventory }

function yamlFile(path: string): unknown {
	return parse(readFileSync(path, 'utf8'));
}

export function loadPlatformInventory(root = process.cwd()): LoadedInventory {
	const sitePath = resolve(root, 'treeseed.site.yaml');
	const site = yamlFile(sitePath) as { development?: { local?: { inventory?: { source?: string; path?: string } } } };
	const reference = site.development?.local?.inventory;
	if (reference?.source !== 'seed' || !reference.path) {
		throw new Error('treeseed.site.yaml must declare development.local.inventory with source seed and a relative path.');
	}
	if (resolve(root, reference.path) !== resolve(dirname(sitePath), reference.path)) {
		throw new Error('Inventory path must resolve beneath the Platform root.');
	}
	const path = resolve(root, reference.path);
	if (!path.startsWith(`${resolve(root)}/`)) throw new Error('Inventory path escapes the Platform root.');
	const source = readFileSync(path, 'utf8');
	return { root: resolve(root), path, digest: `sha256:${createHash('sha256').update(source).digest('hex')}`, inventory: inventorySchema.parse(parse(source)) };
}

export function loadPlatformProfile(path: string): PlatformProfile {
	return profileSchema.parse(yamlFile(path));
}

export function loadPlatformProfiles(root = process.cwd()): PlatformProfile[] {
	const directory = resolve(root, 'profiles');
	if (!existsSync(directory)) return [];
	return readdirSync(directory, { withFileTypes: true })
		.filter((entry) => entry.isFile() && /\.ya?ml$/u.test(entry.name))
		.map((entry) => loadPlatformProfile(resolve(directory, entry.name)))
		.sort((left, right) => left.id.localeCompare(right.id));
}

export function resolveProfileProjects(profiles: readonly PlatformProfile[], selected: readonly string[]): string[] {
	const catalog = new Map(profiles.map((profile) => [profile.id, profile]));
	const result = new Set<string>();
	const active = new Set<string>();
	const visit = (id: string) => {
		if (active.has(id)) throw new Error(`Profile inheritance cycle includes ${id}.`);
		const profile = catalog.get(id);
		if (!profile) throw new Error(`Unknown Platform profile ${id}.`);
		active.add(id);
		profile.extends.forEach(visit);
		profile.sources.projects.forEach((project) => result.add(project));
		active.delete(id);
	};
	selected.forEach(visit);
	return [...result].sort();
}
