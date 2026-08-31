import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';
import { hostTemplateSchema, integrationLockSchema } from './contracts.ts';
import { inventorySchema, profileSchema } from './schemas.ts';
import type { PlatformDiagnostic } from './schemas.ts';

export interface PlatformVerification { schemaVersion: 'treeseed.platform-verification/v1'; root: string; digest: string; ok: boolean; diagnostics: PlatformDiagnostic[] }

const allowedRoots = new Set(['.github', 'config', 'docs', 'profiles', 'seeds', 'templates']);
const allowedFiles = new Set(['.gitignore', 'AGENTS.md', 'LICENSE', 'LICENSE.md', 'README.md', 'skills-lock.json', 'treeseed.site.yaml']);
const allowedExtensions = new Set(['.md', '.yaml', '.yml', '.json', '.lock', '.toml']);
const forbiddenExtensions = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.py', '.sh', '.go', '.rs', '.java']);
const personalPath = /(?:^|[\s'"`:=])(?:\/home\/[^/\s]+|\/Users\/[^/\s]+|[A-Za-z]:\\Users\\[^\\\s]+)/u;

function semanticDiagnostics(root: string, tracked: ReadonlySet<string>): PlatformDiagnostic[] {
	const diagnostics: PlatformDiagnostic[] = [];
	const document = (path: string) => parse(readFileSync(resolve(root, path), 'utf8')) as Record<string, unknown>;
	const report = (code: string, path: string, message: string) => diagnostics.push({ code, path, message });
	const safe = <T>(path: string, load: () => T): T | undefined => {
		try { return load(); }
		catch (error) { report('declaration_invalid', path, error instanceof Error ? error.message : String(error)); return undefined; }
	};
	const profiles = new Map<string, ReturnType<typeof profileSchema.parse>>();
	for (const path of [...tracked].filter((value) => /^profiles\/[^/]+\.ya?ml$/u.test(value))) {
		const profile = safe(path, () => profileSchema.parse(document(path)));
		if (profile) profiles.set(profile.id, profile);
	}
	const sitePath = 'treeseed.site.yaml';
	if (!tracked.has(sitePath)) return diagnostics;
	const site = safe(sitePath, () => document(sitePath));
	if (!site) return diagnostics;
	const development = site.development as { local?: { inventory?: { source?: string; path?: string } } } | undefined;
	const inventoryPath = development?.local?.inventory?.path;
	let projectSlugs = new Set<string>();
	if (development?.local?.inventory?.source !== 'seed' || !inventoryPath || !tracked.has(inventoryPath)) {
		report('inventory_reference_invalid', sitePath, 'The local inventory must reference a tracked seed declaration.');
	} else {
		const inventory = safe(inventoryPath, () => inventorySchema.parse(document(inventoryPath)));
		if (inventory) projectSlugs = new Set(inventory.resources.projects.map((project) => project.slug));
	}
	for (const [id, profile] of profiles) {
		for (const project of profile.sources.projects) if (!projectSlugs.has(project)) report('profile_project_unknown', `profiles/${id}.yaml`, `Profile project ${project} is absent from the portable inventory.`);
		for (const parent of profile.extends) if (!profiles.has(parent)) report('profile_parent_unknown', `profiles/${id}.yaml`, `Profile parent ${parent} does not exist.`);
	}
	const integrations = site.integrations as Record<string, string> | undefined;
	const integrationDigests = new Map<string, string>();
	for (const path of Object.values(integrations ?? {}).filter((value) => value.includes('/integrations/'))) {
		if (!tracked.has(path)) { report('integration_reference_invalid', sitePath, `Integration lock ${path} is not tracked.`); continue; }
		const lock = safe(path, () => integrationLockSchema.parse(document(path)));
		if (!lock) continue;
		const digest = `sha256:${createHash('sha256').update(JSON.stringify(lock.components)).digest('hex')}`;
		if (digest !== lock.digest) report('integration_digest_mismatch', path, 'Integration lock digest does not bind its exact component list.');
		integrationDigests.set(lock.release.replace(/-\d+$/u, ''), lock.digest);
	}
	for (const path of [...tracked].filter((value) => /^config\/hosts\/[^/]+\.ya?ml$/u.test(value))) {
		const host = safe(path, () => hostTemplateSchema.parse(document(path)));
		if (!host) continue;
		for (const profile of host.profiles) if (!profiles.has(profile)) report('host_profile_unknown', path, `Host template profile ${profile} does not exist.`);
		if (![...integrationDigests.values()].includes(host.integration.digest)) report('host_integration_unknown', path, 'Host template integration digest is not present in a referenced integration lock.');
	}
	const production = site.production as { mutation?: string; topology?: string } | undefined;
	if (production?.mutation !== 'blocked') report('production_not_fail_closed', sitePath, 'Production mutation must remain blocked until promotion gates pass.');
	if (production?.topology && !tracked.has(production.topology)) report('topology_reference_invalid', sitePath, 'Production topology must reference a tracked declaration.');
	return diagnostics;
}

export function verifyPlatformRepository(root = process.cwd()): PlatformVerification {
	const absoluteRoot = resolve(root);
	const listed = execFileSync('git', ['ls-files', '-z'], { cwd: absoluteRoot, encoding: 'utf8' }).split('\0').filter(Boolean).sort();
	const diagnostics: PlatformDiagnostic[] = [];
	const hash = createHash('sha256');
	for (const path of listed) {
		const fullPath = resolve(absoluteRoot, path);
		if (!fullPath.startsWith(`${absoluteRoot}/`)) {
			diagnostics.push({ code: 'path_not_portable', path, message: 'Tracked paths must stay beneath the repository and cannot be symbolic links.' });
			continue;
		}
		if (!existsSync(fullPath)) {
			diagnostics.push({ code: 'tracked_file_missing', path, message: 'Tracked Platform files must exist in the working tree.' });
			continue;
		}
		if (lstatSync(fullPath).isSymbolicLink()) {
			diagnostics.push({ code: 'path_not_portable', path, message: 'Tracked paths must stay beneath the repository and cannot be symbolic links.' });
			continue;
		}
		const rootSegment = path.split('/')[0];
		const extension = extname(path);
		if (!allowedFiles.has(path) && !allowedRoots.has(rootSegment)) diagnostics.push({ code: 'content_root_forbidden', path, message: 'Platform may contain only declarations, documentation, locks, and GitHub configuration.' });
		if (forbiddenExtensions.has(extension)) diagnostics.push({ code: 'implementation_forbidden', path, message: 'Executable implementation belongs in its owning package.' });
		if (!allowedFiles.has(path) && !allowedExtensions.has(extension)) diagnostics.push({ code: 'file_type_forbidden', path, message: 'This tracked file type is outside the declarative Platform boundary.' });
		const source = readFileSync(fullPath);
		hash.update(relative(absoluteRoot, fullPath)).update('\0').update(source);
		if (personalPath.test(source.toString('utf8'))) diagnostics.push({ code: 'personal_path_forbidden', path, message: 'Committed home-directory paths are forbidden.' });
	}
	diagnostics.push(...semanticDiagnostics(absoluteRoot, new Set(listed)));
	return { schemaVersion: 'treeseed.platform-verification/v1', root: absoluteRoot, digest: `sha256:${hash.digest('hex')}`, ok: diagnostics.length === 0, diagnostics };
}
