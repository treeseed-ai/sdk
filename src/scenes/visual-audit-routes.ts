import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { sceneWarningDiagnostic } from './diagnostics.ts';
import type {
	TreeseedSceneDiagnostic,
	TreeseedSceneManifest,
	TreeseedSceneVisualAuditRoute,
	TreeseedSceneVisualAuditRouteSource,
} from './types.ts';

const SEEDED_VALUES: Record<string, string> = {
	teamId: 'visual-audit',
	projectId: 'visual-audit-project',
	providerId: 'visual-audit-provider',
	hostType: 'github',
	hostId: 'visual-audit-host',
	category: 'core',
	artifactId: 'visual-audit-artifact',
	collection: 'notes',
	slug: 'visual-audit',
	approvalId: 'visual-audit-approval',
	approvalPath: 'visual-audit',
	workdayId: 'visual-audit-workday',
	agentSlug: 'visual-audit-agent',
	id: 'visual-audit-deployment',
	name: 'visual-audit',
	username: 'visual-owner',
	token: 'visual-audit-token',
	provider: 'github',
};

function walk(root: string): string[] {
	if (!existsSync(root)) return [];
	const stats = statSync(root);
	if (stats.isFile()) return [root];
	return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
		const path = join(root, entry.name);
		if (entry.isDirectory()) return walk(path);
		return entry.isFile() ? [path] : [];
	});
}

function slugFromContentFile(root: string, file: string) {
	const raw = readFileSync(file, 'utf8');
	const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/u);
	const frontmatter = match?.[1] ?? '';
	const explicit = frontmatter.match(/^slug:\s*['"]?([^'"\n]+)['"]?\s*$/mu)?.[1]?.trim();
	if (explicit) return explicit.replace(/^\/+|\/+$/gu, '');
	const rel = relative(root, file).replace(/\.(md|mdx)$/iu, '');
	return rel.split(/[\\/]/gu).map((part) => part === 'index' ? '' : part).filter(Boolean).join('/');
}

function pathRootFor(path: string): string {
	if (path === '/') return '/';
	const parts = path.split('/').filter(Boolean);
	if (parts[0] === 'app' && parts[1]) return `/app/${parts[1]}`;
	if (parts[0] === 'auth') return '/auth';
	if (parts[0] === 'market') return parts[1] ? `/market/${parts[1]}` : '/market';
	return `/${parts[0] ?? ''}`;
}

function filesystemSlug(path: string) {
	return path.replace(/^\/+|\/+$/gu, '') || 'index';
}

function routeId(path: string) {
	return filesystemSlug(path).replace(/[^a-z0-9]+/giu, '-').replace(/^-+|-+$/gu, '').toLowerCase() || 'index';
}

function normalizePath(path: string) {
	const cleaned = path.trim().replace(/\/+$/u, '');
	return cleaned ? cleaned.startsWith('/') ? cleaned : `/${cleaned}` : '/';
}

function isExcludedPattern(path: string) {
	return path.startsWith('/api/')
		|| path === '/api'
		|| path.startsWith('/v1/')
		|| path === '/v1'
		|| path === '/knowledge'
		|| path.startsWith('/knowledge/')
		|| path === '/feed.xml'
		|| path.includes('${')
		|| path.includes('/delete')
		|| path.startsWith('/auth/callback')
		|| path.startsWith('/team-invites/');
}

function dynamicKeys(pattern: string) {
	return [...pattern.matchAll(/\[(?:\.\.\.)?([^\]]+)\]/gu)].map((match) => match[1]!).filter(Boolean);
}

function canMaterializeDynamicPattern(pattern: string) {
	const keys = dynamicKeys(pattern);
	if (keys.length === 0) return true;
	const path = normalizePath(pattern);
	const unsupportedSeedBackedAppRoutes = new Set([
		'/app/capacity/providers/[providerId]/edit',
		'/app/capacity/providers/[providerId]/keys',
		'/app/hosts/[hostType]/new',
		'/app/hosts/[hostType]/[hostId]/edit',
		'/app/knowledge/[category]/[slug]',
		'/app/knowledge/artifacts/[artifactId]',
		'/app/projects/deployment/[id]',
		'/app/projects/[projectId]/workdays/[workdayId]',
		'/app/teams/[teamId]/edit',
		'/app/teams/[teamId]/members',
		'/app/work/[collection]/[slug]',
		'/app/work/decisions/[...approvalPath]',
		'/app/work/decisions/[approvalId]',
	]);
	if (unsupportedSeedBackedAppRoutes.has(path)) return false;
	const appFixtureKeys = new Set([
		'teamId',
		'projectId',
		'providerId',
		'hostType',
		'hostId',
		'category',
		'artifactId',
		'approvalId',
		'approvalPath',
		'workdayId',
		'id',
	]);
	if (path.startsWith('/app/')) return keys.every((key) => appFixtureKeys.has(key));
	if (path.startsWith('/u/')) return keys.every((key) => key === 'username');
	if (path.startsWith('/t/')) return keys.every((key) => key === 'teamId' || key === 'projectId');
	return false;
}

function materializePattern(pattern: string): { path: string; dynamic: boolean } | null {
	if (isExcludedPattern(pattern)) return null;
	if (!canMaterializeDynamicPattern(pattern)) return null;
	let dynamic = false;
	const path = normalizePath(pattern.replace(/\[\.\.\.([^\]]+)\]/gu, (_match, key) => {
		dynamic = true;
		return SEEDED_VALUES[String(key)] ?? `visual-audit-${String(key)}`;
	}).replace(/\[([^\]]+)\]/gu, (_match, key) => {
		dynamic = true;
		return SEEDED_VALUES[String(key)] ?? `visual-audit-${String(key)}`;
	}));
	if (isExcludedPattern(path)) return null;
	return { path, dynamic };
}

function addRoute(
	routes: Map<string, TreeseedSceneVisualAuditRoute>,
	input: {
		path: string;
		source: TreeseedSceneVisualAuditRouteSource;
		dynamic?: boolean;
		contentCollection?: string | null;
		contentSlug?: string | null;
		title?: string | null;
	},
) {
	const path = normalizePath(input.path);
	if (isExcludedPattern(path)) return;
	const requiresAuth = path === '/app' || path.startsWith('/app/');
	const roles = requiresAuth ? ['owner', 'admin', 'member'] : ['anonymous', 'owner', 'admin', 'member'];
	const expectedStatus = path === '/404' ? 404 : 200;
	const existing = routes.get(path);
	if (existing) {
		if (existing.source !== 'content-collection' && input.source === 'content-collection') {
			existing.contentCollection = input.contentCollection ?? existing.contentCollection;
			existing.contentSlug = input.contentSlug ?? existing.contentSlug;
		}
		return;
	}
	routes.set(path, {
		id: routeId(path),
		path,
		pathRoot: pathRootFor(path),
		title: input.title ?? null,
		source: input.source,
		requiresAuth,
		roles,
		dynamic: Boolean(input.dynamic),
		contentCollection: input.contentCollection ?? null,
		contentSlug: input.contentSlug ?? null,
		expectedStatus,
		expectedFinalPath: null,
		expectedAuthRedirect: requiresAuth,
		expectedEmpty: path === '/404',
	});
}

function extractRoutePatterns(source: string) {
	return [
		...source.matchAll(/pattern:\s*['"`]([^'"`]+)['"`]/gu),
		...source.matchAll(/\b[A-Za-z][A-Za-z0-9]*Route\(\s*['"`]([^'"`]+)['"`]/gu),
	].map((match) => match[1]!).filter(Boolean);
}

function discoverCoreRoutes(projectRoot: string, routes: Map<string, TreeseedSceneVisualAuditRoute>, diagnostics: TreeseedSceneDiagnostic[]) {
	const sitePath = resolve(projectRoot, 'packages/core/src/site.ts');
	if (!existsSync(sitePath)) {
		diagnostics.push(sceneWarningDiagnostic('scene.visual_audit_route_discovery_failed', `Core route registry not found at ${sitePath}.`, 'visualAudit.routeDiscovery.core'));
		return;
	}
	for (const pattern of extractRoutePatterns(readFileSync(sitePath, 'utf8'))) {
		const materialized = materializePattern(pattern);
		if (!materialized) continue;
		addRoute(routes, { path: materialized.path, source: 'core-route-registry', dynamic: materialized.dynamic });
	}
}

function discoverAdminRoutes(projectRoot: string, routes: Map<string, TreeseedSceneVisualAuditRoute>, diagnostics: TreeseedSceneDiagnostic[]) {
	const routesPath = resolve(projectRoot, 'packages/admin/src/routes.ts');
	if (!existsSync(routesPath)) {
		diagnostics.push(sceneWarningDiagnostic('scene.visual_audit_route_discovery_failed', `Admin route registry not found at ${routesPath}.`, 'visualAudit.routeDiscovery.admin'));
		return;
	}
	for (const pattern of extractRoutePatterns(readFileSync(routesPath, 'utf8'))) {
		const materialized = materializePattern(pattern);
		if (!materialized) continue;
		addRoute(routes, { path: materialized.path, source: 'admin-route-registry', dynamic: materialized.dynamic });
	}
}

function pagePathFromOverride(projectRoot: string, file: string) {
	const root = resolve(projectRoot, 'src/overrides/pages');
	const rel = relative(root, file).replace(/\.(astro|mdx|md)$/iu, '');
	if (rel === 'index') return '/';
	return normalizePath(rel.replace(/\/index$/u, ''));
}

function discoverTenantOverrides(projectRoot: string, routes: Map<string, TreeseedSceneVisualAuditRoute>) {
	for (const file of walk(resolve(projectRoot, 'src/overrides/pages')).filter((entry) => /\.(astro|mdx|md)$/iu.test(entry))) {
		const materialized = materializePattern(pagePathFromOverride(projectRoot, file));
		if (!materialized) continue;
		addRoute(routes, { path: materialized.path, source: 'tenant-page-override', dynamic: materialized.dynamic });
	}
}

const CONTENT_COLLECTION_ROUTES: Record<string, string> = {
	agents: '/agents',
	books: '/books',
	notes: '/notes',
	objectives: '/objectives',
	proposals: '/proposals',
	people: '/people',
	decisions: '/decisions',
	questions: '/questions',
	pages: '',
	templates: '/market/templates',
};

function discoverContentRoutes(projectRoot: string, routes: Map<string, TreeseedSceneVisualAuditRoute>) {
	const contentRoot = resolve(projectRoot, 'src/content');
	for (const [collection, prefix] of Object.entries(CONTENT_COLLECTION_ROUTES)) {
		const root = join(contentRoot, collection);
		for (const file of walk(root).filter((entry) => /\.(md|mdx)$/iu.test(entry))) {
			const slug = slugFromContentFile(root, file);
			if (!slug) continue;
			const path = prefix ? `${prefix}/${slug}` : `/${slug}`;
			addRoute(routes, {
				path,
				source: 'content-collection',
				dynamic: true,
				contentCollection: collection,
				contentSlug: slug,
				title: basename(file).replace(/\.(md|mdx)$/iu, ''),
			});
		}
	}
}

function rootMatches(path: string, roots: string[]) {
	if (roots.length === 0) return true;
	return roots.some((root) => {
		const normalized = normalizePath(root);
		return normalized === '/' ? path === '/' : path === normalized || path.startsWith(`${normalized}/`);
	});
}

function normalizeGlob(pattern: string) {
	const trimmed = pattern.trim();
	if (!trimmed) return '';
	if (trimmed === '*') return '/*';
	if (trimmed.startsWith('/') || trimmed.startsWith('**')) return trimmed.replace(/\/+$/u, '') || '/';
	return `/${trimmed}`.replace(/\/+$/u, '') || '/';
}

function regexEscape(value: string) {
	return value.replace(/[|\\{}()[\]^$+?.]/gu, '\\$&');
}

function globToRegex(pattern: string) {
	const normalized = normalizeGlob(pattern);
	if (!normalized) return null;
	if (!/[*?]/u.test(normalized)) {
		const exact = normalizePath(normalized);
		return new RegExp(`^${regexEscape(exact)}$`, 'u');
	}
	if (normalized.endsWith('/**')) {
		const base = normalized.slice(0, -3) || '/';
		return new RegExp(`^${regexEscape(base)}(?:/.*)?$`, 'u');
	}
	let source = '';
	for (let index = 0; index < normalized.length; index += 1) {
		const char = normalized[index]!;
		const next = normalized[index + 1];
		if (char === '*' && next === '*') {
			source += '.*';
			index += 1;
			continue;
		}
		if (char === '*') {
			source += '[^/]*';
			continue;
		}
		if (char === '?') {
			source += '[^/]';
			continue;
		}
		source += regexEscape(char);
	}
	return new RegExp(`^${source}$`, 'u');
}

function globMatches(path: string, globs: string[]) {
	if (globs.length === 0) return true;
	return globs.some((pattern) => {
		const regex = globToRegex(pattern);
		return regex ? regex.test(path) : false;
	});
}

function isExcludedByGlob(path: string, globs: string[]) {
	if (globs.length === 0) return false;
	return globs.some((pattern) => {
		const regex = globToRegex(pattern);
		return regex ? regex.test(path) : false;
	});
}

export function discoverTreeseedSceneVisualAuditRoutes(input: {
	projectRoot: string;
	scene: TreeseedSceneManifest;
	pathRoots?: string[];
	pathGlobs?: string[];
	excludePathGlobs?: string[];
}): {
	routes: TreeseedSceneVisualAuditRoute[];
	diagnostics: TreeseedSceneDiagnostic[];
} {
	const routes = new Map<string, TreeseedSceneVisualAuditRoute>();
	const diagnostics: TreeseedSceneDiagnostic[] = [];
	const config = input.scene.visualAudit;
	if (config.routeDiscovery.core) discoverCoreRoutes(input.projectRoot, routes, diagnostics);
	if (config.routeDiscovery.admin) discoverAdminRoutes(input.projectRoot, routes, diagnostics);
	if (config.routeDiscovery.tenantOverrides) discoverTenantOverrides(input.projectRoot, routes);
	if (config.routeDiscovery.contentCollections) discoverContentRoutes(input.projectRoot, routes);
	const roots = input.pathRoots?.length ? input.pathRoots : config.pathRoots;
	const pathGlobs = input.pathGlobs?.length ? input.pathGlobs : config.pathGlobs;
	const excludePathGlobs = input.excludePathGlobs?.length ? input.excludePathGlobs : config.excludePathGlobs;
	const selected = [...routes.values()]
		.filter((route) => rootMatches(route.path, roots))
		.filter((route) => globMatches(route.path, pathGlobs))
		.filter((route) => !isExcludedByGlob(route.path, excludePathGlobs))
		.sort((a, b) => a.path.localeCompare(b.path));
	return { routes: selected, diagnostics };
}

export function treeseedSceneVisualAuditPathRoot(path: string) {
	return pathRootFor(path);
}

export function treeseedSceneVisualAuditRouteFilename(path: string) {
	return `${routeId(path)}.png`;
}
