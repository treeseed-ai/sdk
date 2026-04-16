import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import type { TreeseedFieldAliasRegistry } from '../field-aliases.ts';
import { normalizeAliasedRecord } from '../field-aliases.ts';
import type { TreeseedContentCollection, TreeseedFeatureName, TreeseedTenantConfig } from './contracts.ts';

function resolvePackageRoot() {
	const moduleUrl = typeof import.meta?.url === 'string' ? import.meta.url : null;
	if (!moduleUrl) {
		return process.cwd();
	}

	return resolve(dirname(fileURLToPath(moduleUrl)), '../..');
}

const packageRoot = resolvePackageRoot();
const packageFixtureRoot = resolve(packageRoot, '.fixtures', 'treeseed-fixtures', 'sites', 'working-site');
const explicitTenantRoot = process.env.TREESEED_TENANT_ROOT
	? resolve(process.env.TREESEED_TENANT_ROOT)
	: null;

const manifestFieldAliases: TreeseedFieldAliasRegistry = {
	siteConfigPath: { key: 'siteConfigPath', aliases: ['site_config_path'] },
};

const manifestContentFieldAliases: TreeseedFieldAliasRegistry = {
	pages: { key: 'pages', aliases: ['page_root', 'pages_root'] },
	notes: { key: 'notes', aliases: ['notes_root'] },
	questions: { key: 'questions', aliases: ['questions_root'] },
	objectives: { key: 'objectives', aliases: ['objectives_root'] },
	people: { key: 'people', aliases: ['people_root'] },
	agents: { key: 'agents', aliases: ['agents_root'] },
	books: { key: 'books', aliases: ['books_root'] },
	docs: { key: 'docs', aliases: ['knowledge', 'knowledge_root', 'docs_root'] },
};

const manifestOverrideFieldAliases: TreeseedFieldAliasRegistry = {
	pagesRoot: { key: 'pagesRoot', aliases: ['pages_root'] },
	stylesRoot: { key: 'stylesRoot', aliases: ['styles_root'] },
	componentsRoot: { key: 'componentsRoot', aliases: ['components_root'] },
};

function pathWithin(parent: string, candidate: string) {
	const normalizedParent = resolve(parent);
	const normalizedCandidate = resolve(candidate);
	return normalizedCandidate === normalizedParent || normalizedCandidate.startsWith(`${normalizedParent}/`);
}

function collectTenantRootCandidates(start: string) {
	const candidates: string[] = [];
	let current = resolve(start);

	while (true) {
		candidates.push(
			current,
			resolve(current, '.fixtures', 'treeseed-fixtures', 'sites', 'working-site'),
			resolve(current, 'fixture'),
		);
		const parent = resolve(current, '..');
		if (parent === current) {
			break;
		}
		current = parent;
	}

	return candidates;
}

function uniqueCandidates(entries: string[]) {
	return [...new Set(entries.map((entry) => resolve(entry)))];
}

function tenantRootCandidates() {
	const cwd = resolve(process.cwd());
	const cwdCandidates = collectTenantRootCandidates(cwd);
	const packageCandidates = collectTenantRootCandidates(packageRoot);

	if (explicitTenantRoot) {
		return uniqueCandidates([explicitTenantRoot, ...cwdCandidates, packageFixtureRoot, ...packageCandidates]);
	}

	if (pathWithin(packageRoot, cwd)) {
		return uniqueCandidates([packageFixtureRoot, ...cwdCandidates, ...packageCandidates]);
	}

	return uniqueCandidates([...cwdCandidates, packageFixtureRoot, ...packageCandidates]);
}

function resolveTenantPath(manifestPath: string) {
	if (existsSync(manifestPath) && resolve(manifestPath) === manifestPath) {
		return resolve(manifestPath);
	}

	if (explicitTenantRoot) {
		const explicitCandidate = resolve(explicitTenantRoot, manifestPath);
		if (existsSync(explicitCandidate)) {
			return explicitCandidate;
		}
	}

	if (existsSync(manifestPath)) {
		return resolve(manifestPath);
	}

	const candidates = tenantRootCandidates().map((root) => resolve(root, manifestPath));

	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}

	throw new Error(
		`Unable to resolve Treeseed tenant manifest at "${manifestPath}" from ${process.cwd()} or ${packageFixtureRoot}.`,
	);
}

export function resolveTreeseedTenantRoot() {
	const candidates = tenantRootCandidates();

	for (const candidate of candidates) {
		if (existsSync(resolve(candidate, 'src/manifest.yaml'))) {
			return candidate;
		}
	}

	throw new Error(
		`Unable to resolve a Treeseed tenant root from ${process.cwd()} or ${packageFixtureRoot}.`,
	);
}

export function defineTreeseedTenant<T>(tenantConfig: T): T {
	return tenantConfig;
}

export function loadTreeseedManifest(manifestPath = './src/manifest.yaml'): TreeseedTenantConfig {
	const resolvedManifestPath = resolveTenantPath(manifestPath);
	const tenantRoot = resolve(dirname(resolvedManifestPath), '..');
	const parsed = normalizeAliasedRecord(
		manifestFieldAliases,
		parseYaml(readFileSync(resolvedManifestPath, 'utf8')) as Record<string, unknown>,
	) as unknown as TreeseedTenantConfig;
	const content = normalizeAliasedRecord(
		manifestContentFieldAliases,
		(parsed.content ?? {}) as Record<string, unknown>,
	) as unknown as TreeseedTenantConfig['content'];
	const overrides = parsed.overrides
		? normalizeAliasedRecord(
			manifestOverrideFieldAliases,
			parsed.overrides as Record<string, unknown>,
		) as TreeseedTenantConfig['overrides']
		: undefined;
	const normalizedSurfaceOverrides = Object.fromEntries(
		Object.entries(overrides?.surfaces ?? {}).map(([surface, definition]) => [
			surface,
			{
				layers: (definition?.layers ?? []).map((layer) => ({
					root: resolve(tenantRoot, layer.root),
					kinds: layer.kinds,
				})),
			},
		]),
	);
	const legacyWebLayers = [
		overrides?.pagesRoot
			? { root: resolve(tenantRoot, overrides.pagesRoot), kinds: ['pages'] as const }
			: null,
		overrides?.stylesRoot
			? { root: resolve(tenantRoot, overrides.stylesRoot), kinds: ['styles'] as const }
			: null,
		overrides?.componentsRoot
			? { root: resolve(tenantRoot, overrides.componentsRoot), kinds: ['components'] as const }
			: null,
	].filter(Boolean);
	const tenantConfig = defineTreeseedTenant({
		...parsed,
		siteConfigPath: resolve(tenantRoot, parsed.siteConfigPath),
		content: Object.fromEntries(
			Object.entries(content ?? {}).map(([collectionName, rootPath]) => [
				collectionName,
				resolve(tenantRoot, String(rootPath)),
			]),
		) as unknown as TreeseedTenantConfig['content'],
		overrides: overrides
			? {
					pagesRoot: overrides.pagesRoot ? resolve(tenantRoot, overrides.pagesRoot) : undefined,
					stylesRoot: overrides.stylesRoot ? resolve(tenantRoot, overrides.stylesRoot) : undefined,
					componentsRoot: overrides.componentsRoot ? resolve(tenantRoot, overrides.componentsRoot) : undefined,
					surfaces: {
						...normalizedSurfaceOverrides,
						web: {
							layers: [
								...(normalizedSurfaceOverrides.web?.layers ?? []),
								...legacyWebLayers,
							],
						},
					},
			  } satisfies NonNullable<TreeseedTenantConfig['overrides']>
			: undefined,
	}) as TreeseedTenantConfig;

	Object.defineProperty(tenantConfig, '__tenantRoot', {
		value: tenantRoot,
		enumerable: false,
	});

	return tenantConfig;
}

export const loadTreeseedTenantManifest = loadTreeseedManifest;

export function getTenantContentRoot(
	tenantConfig: Pick<TreeseedTenantConfig, 'content'>,
	collectionName: string,
) {
	const root = tenantConfig.content[collectionName as keyof TreeseedTenantConfig['content']];
	if (!root) {
		throw new Error(`Unknown tenant content collection: ${collectionName}`);
	}

	return root;
}

export function tenantFeatureEnabled(
	tenantConfig: Pick<TreeseedTenantConfig, 'features'>,
	featureName: string,
) {
	return tenantConfig.features?.[featureName] !== false;
}

const MODEL_FEATURE_MAP: Partial<Record<TreeseedContentCollection, TreeseedFeatureName>> = {
	docs: 'docs',
	books: 'books',
	notes: 'notes',
	questions: 'questions',
	objectives: 'objectives',
	agents: 'agents',
};

export function tenantModelRendered(
	tenantConfig: Pick<TreeseedTenantConfig, 'features' | 'site'>,
	modelName: TreeseedContentCollection,
) {
	const featureName = MODEL_FEATURE_MAP[modelName];
	if (featureName && !tenantFeatureEnabled(tenantConfig, featureName)) {
		return false;
	}

	return tenantConfig.site?.models?.[modelName]?.rendered !== false;
}
