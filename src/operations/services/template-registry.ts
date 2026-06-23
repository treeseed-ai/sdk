import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, relative, resolve } from 'node:path';
import { runTreeseedGit } from './git-runner.ts';
import {
	normalizeTreeseedTemplateId,
	type SdkTemplateCatalogEntry,
	type SdkTemplateCatalogResponse,
	type TemplateLaunchRequirements,
} from '../../sdk-types.ts';
import { RemoteTemplateCatalogClient } from '../../template-catalog.ts';
import {
	type ProjectLaunchConfigWritePlanItem,
	type ProjectLaunchLocalHostBindingSummary,
	type ProjectLaunchResolvedHostBinding,
	type ProjectLaunchSecretDeploymentPlanItem,
	normalizeTemplateLaunchRequirements,
} from '../../template-launch-requirements.ts';
import { preserveProjectLaunchHostBindingConfigOverlay } from './template-host-bindings.ts';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
	resolveTreeseedTemplateCatalogCachePath,
	resolveTreeseedTemplateCatalogEndpoint,
} from './config-runtime.ts';
import {
	cliPackageVersion,
	agentPackageVersion,
	corePackageVersion,
	cliPackageRoot,
	localTemplateArtifactsRoot,
	sdkPackageVersion,
} from './runtime-paths.ts';

export const TEMPLATE_CATEGORIES = ['starter', 'example', 'fixture', 'reference-app'] as const;

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export interface TemplateVariableDefinition {
	name: string;
	token: string;
	deriveFrom?: string;
	required?: boolean;
	default?: string;
}

export interface TemplateManifest {
	schemaVersion?: number;
	id: string;
	displayName: string;
	description: string;
	category: TemplateCategory;
	tags: string[];
	templateVersion?: string;
	templateApiVersion: number;
	minCliVersion: string;
	minCoreVersion?: string;
	variables: TemplateVariableDefinition[];
	actions?: string[];
	postCreate?: string[];
	managedSurface?: {
		coreManaged?: string[];
		validatedOnly?: string[];
		tenantManaged?: string[];
	};
	launchRequirements?: TemplateLaunchRequirements;
	testing: {
		smokeCommand?: string;
		buildCommand?: string;
	};
}

export interface TemplateProductDefinition extends SdkTemplateCatalogEntry {
	contentPath: string;
	artifactRoot: string;
	artifactManifestPath: string;
	templateRoot: string;
	fulfillmentMode: 'packaged' | 'git';
}

export interface ResolvedTemplateDefinition {
	product: TemplateProductDefinition;
	manifestPath: string;
	templateRoot: string;
	manifest: TemplateManifest;
}

export interface StarterResolutionInput {
	target: string;
	name?: string | null;
	slug?: string | null;
	siteUrl?: string | null;
	contactEmail?: string | null;
	repositoryUrl?: string | null;
	discordUrl?: string | null;
	hostBindingState?: StarterHostBindingState | null;
}

export interface StarterHostBindingState {
	hostBindings: Record<string, ProjectLaunchResolvedHostBinding>;
	hostBindingPlans: {
		configWrites: ProjectLaunchConfigWritePlanItem[];
		secretDeployment: {
			items: ProjectLaunchSecretDeploymentPlanItem[];
		};
	};
	hostBindingSummaries?: ProjectLaunchLocalHostBindingSummary[];
	hostBindingConfig?: {
		configWrites?: unknown[];
		environmentWrites?: unknown[];
		targets?: string[];
	} | null;
}

interface TemplateState {
	templateId: string;
	templateVersion?: string;
	sourceRef?: string;
	installedAt: string;
	lastSyncedAt?: string;
	replacements: Record<string, string>;
	hostBindings?: StarterHostBindingState['hostBindings'];
	hostBindingPlans?: StarterHostBindingState['hostBindingPlans'];
	hostBindingSummaries?: ProjectLaunchLocalHostBindingSummary[];
	hostBindingConfig?: StarterHostBindingState['hostBindingConfig'];
}

interface TemplateCatalogCache {
	endpoint: string;
	fetchedAt: string;
	items: SdkTemplateCatalogEntry[];
}

interface TemplateCatalogOptions {
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	writeWarning?: (message: string) => void;
}

function loadJsonFile<T>(filePath: string): T {
	return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function ensureDir(filePath: string) {
	mkdirSync(dirname(filePath), { recursive: true });
}

const templatePayloadIgnoredDirectoryNames = new Set([
	'node_modules',
	'dist',
	'.astro',
]);

const templatePayloadIgnoredRelativePaths = new Set([
	'.treeseed/generated',
	'.treeseed/test-reports',
	'public/books',
]);

function normalizeTemplateRelativePath(path: string) {
	return path.split(/[\\/]+/u).join('/');
}

function isIgnoredTemplatePayloadDirectory(root: string, directoryPath: string) {
	const relativePath = normalizeTemplateRelativePath(relative(root, directoryPath));
	return templatePayloadIgnoredDirectoryNames.has(basename(directoryPath))
		|| templatePayloadIgnoredRelativePaths.has(relativePath);
}

function listFiles(root: string, currentRoot = root): string[] {
	if (!existsSync(currentRoot)) {
		return [];
	}

	const files: string[] = [];
	for (const entry of readdirSync(currentRoot, { withFileTypes: true })) {
		const fullPath = resolve(currentRoot, entry.name);
		if (entry.isDirectory()) {
			if (!isIgnoredTemplatePayloadDirectory(root, fullPath)) {
				files.push(...listFiles(root, fullPath));
			}
			continue;
		}
		files.push(fullPath);
	}
	return files;
}

function listTemplateArtifactIds() {
	const packagedIds = existsSync(localTemplateArtifactsRoot)
		? readdirSync(localTemplateArtifactsRoot, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		: [];
	const localStarterIds = listLocalStarterArtifacts()
		.map((entry) => entry.id);

	return [...new Set([...packagedIds, ...localStarterIds])]
		.sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
}

const LOCAL_STARTER_ID_TO_DIRECTORY: Record<string, string> = {
	'research': 'research',
	'engineering': 'engineering',
	'information-hub': 'information-hub',
};

function localStartersRoot() {
	return resolve(cliPackageRoot, '..', '..', 'starters');
}

function resolveLocalStarterArtifactRoot(id: string) {
	const directory = LOCAL_STARTER_ID_TO_DIRECTORY[normalizeTreeseedTemplateId(id)];
	if (!directory) {
		return null;
	}
	const artifactRoot = resolve(localStartersRoot(), directory);
	return existsSync(resolve(artifactRoot, 'template.config.json')) && existsSync(resolve(artifactRoot, 'template'))
		? artifactRoot
		: null;
}

function listLocalStarterArtifacts() {
	return Object.keys(LOCAL_STARTER_ID_TO_DIRECTORY)
		.map((id) => {
			const artifactRoot = resolveLocalStarterArtifactRoot(id);
			return artifactRoot ? { id, artifactRoot } : null;
		})
		.filter((entry): entry is { id: string; artifactRoot: string } => Boolean(entry));
}

function isTextFile(filePath: string) {
	return !/\.(png|jpe?g|gif|webp|ico|woff2?|ttf|eot|pdf|zip|gz)$/iu.test(filePath);
}

function validateTemplateProductShape(product: TemplateProductDefinition) {
	if (!product.id || !product.displayName || !product.description || !product.summary) {
		throw new Error(`Template product ${product.id || '(unknown)'} is missing required identity metadata.`);
	}
	if (!TEMPLATE_CATEGORIES.includes(product.category)) {
		throw new Error(`Template product ${product.id} uses unsupported category "${product.category}".`);
	}
	if (product.status !== 'draft' && product.status !== 'live' && product.status !== 'archived') {
		throw new Error(`Template product ${product.id} uses unsupported status "${product.status}".`);
	}
	if (product.fulfillmentMode === 'packaged' && !existsSync(product.artifactManifestPath)) {
		throw new Error(`Template product ${product.id} points to a missing artifact manifest: ${product.artifactManifestPath}`);
	}
	if (product.fulfillmentMode === 'packaged' && !existsSync(product.templateRoot)) {
		throw new Error(`Template product ${product.id} points to a missing template payload: ${product.templateRoot}`);
	}
}

function validateTemplateManifest(definition: ResolvedTemplateDefinition) {
	const { manifest, templateRoot, manifestPath, product } = definition;
	if (!TEMPLATE_CATEGORIES.includes(manifest.category)) {
		throw new Error(`Invalid template category in ${manifestPath}: ${manifest.category}`);
	}
	if (!manifest.id || !manifest.displayName || !manifest.description) {
		throw new Error(`Template manifest ${manifestPath} is missing required metadata fields.`);
	}
	if (manifest.id !== product.id) {
		throw new Error(`Template product ${product.id} does not match artifact id ${manifest.id}.`);
	}
	if (!existsSync(templateRoot)) {
		throw new Error(`Template ${manifest.id} is missing template/ at ${templateRoot}.`);
	}
	manifest.launchRequirements = normalizeTemplateLaunchRequirements(manifest.launchRequirements, `${manifestPath}: launchRequirements`);
	validateTemplatePlaceholders(definition);
}

function validateTemplatePlaceholders(definition: ResolvedTemplateDefinition) {
	const declaredTokens = new Set(definition.manifest.variables.map((variable) => variable.token));
	const discoveredTokens = new Set<string>();
	for (const filePath of listFiles(definition.templateRoot)) {
		if (!isTextFile(filePath)) {
			continue;
		}
		const contents = readFileSync(filePath, 'utf8');
		for (const match of contents.matchAll(/__[A-Z0-9_]+__/g)) {
			discoveredTokens.add(match[0]);
		}
	}
	for (const token of discoveredTokens) {
		if (!declaredTokens.has(token)) {
			throw new Error(`Template ${definition.manifest.id} uses undeclared token ${token}.`);
		}
	}
}

function normalizeTemplateProduct(remoteProduct: SdkTemplateCatalogEntry): TemplateProductDefinition {
	const id = normalizeTreeseedTemplateId(remoteProduct.id);
	const artifactRoot = resolve(localTemplateArtifactsRoot, id);
	const source = remoteProduct.fulfillment.source;
	return {
		...remoteProduct,
		id,
		contentPath: source.kind === 'git'
			? `${source.repoUrl}#${id}`
			: `r2://${source.bucket ?? 'bucket'}/${source.objectKey}#${id}`,
		artifactRoot,
		artifactManifestPath: resolve(artifactRoot, 'template.config.json'),
		templateRoot: resolve(artifactRoot, 'template'),
		fulfillmentMode: remoteProduct.fulfillment.mode ?? 'packaged',
	};
}

function sanitizeCacheSegment(value: string) {
	return value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'source';
}

function resolveTemplateSourceCacheRoot(product: TemplateProductDefinition, options: TemplateCatalogOptions) {
	const cachePath = resolveTreeseedTemplateCatalogCachePath(options.cwd ?? process.cwd());
	const sourceVersion = product.fulfillment.source.kind === 'git'
		? product.fulfillment.source.ref
		: product.fulfillment.source.version;
	return resolve(dirname(cachePath), 'templates', sanitizeCacheSegment(product.id), sanitizeCacheSegment(sourceVersion));
}

function runGit(commandArgs: string[], cwd?: string) {
	const mutating = /^(add|commit|checkout|switch|merge|tag|push|fetch|worktree|submodule|reset|clean|restore|branch|clone)$/u.test(commandArgs[0] ?? '');
	const result = runTreeseedGit(commandArgs, {
		cwd: cwd ?? process.cwd(),
		mode: mutating ? 'mutate' : 'read',
	});
	if (result.status !== 0) {
		throw new Error(result.stderr?.trim() || result.stdout?.trim() || `git ${commandArgs.join(' ')} failed`);
	}
}

function readGitOutput(commandArgs: string[], cwd?: string) {
	const result = runTreeseedGit(commandArgs, {
		cwd: cwd ?? process.cwd(),
		mode: 'read',
		allowFailure: true,
	});
	return result.status === 0 ? result.stdout.trim() : null;
}

function materializeGitTemplateSource(product: TemplateProductDefinition, options: TemplateCatalogOptions) {
	const cacheRoot = resolveTemplateSourceCacheRoot(product, options);
	const repoRoot = resolve(cacheRoot, 'repo');
	const source = product.fulfillment.source;
	const cachedOrigin = existsSync(resolve(repoRoot, '.git'))
		? readGitOutput(['config', '--get', 'remote.origin.url'], repoRoot)
		: null;
	if (cachedOrigin !== source.repoUrl) {
		rmSync(cacheRoot, { recursive: true, force: true });
		mkdirSync(cacheRoot, { recursive: true });
		runGit(['clone', '--no-checkout', source.repoUrl, repoRoot]);
	}
	runGit(['fetch', '--all', '--tags'], repoRoot);
	runGit(['checkout', '--force', source.ref], repoRoot);
	const artifactRoot = resolve(repoRoot, source.directory);
	return {
		artifactRoot,
		manifestPath: resolve(artifactRoot, 'template.config.json'),
		templateRoot: resolve(artifactRoot, 'template'),
	};
}

function materializeR2TemplateSource(product: TemplateProductDefinition) {
	if (existsSync(product.artifactManifestPath) && existsSync(product.templateRoot)) {
		return {
			artifactRoot: product.artifactRoot,
			manifestPath: product.artifactManifestPath,
			templateRoot: product.templateRoot,
		};
	}

	throw new Error(
		`Template ${product.id} uses an R2 fulfillment source (${product.fulfillment.source.objectKey}) `
		+ 'but no packaged artifact is present in the local cache yet.',
	);
}

function resolveTemplateDefinitionPaths(product: TemplateProductDefinition, options: TemplateCatalogOptions) {
	const localStarterArtifactRoot = resolveLocalStarterArtifactRoot(product.id);
	if (localStarterArtifactRoot) {
		return {
			artifactRoot: localStarterArtifactRoot,
			manifestPath: resolve(localStarterArtifactRoot, 'template.config.json'),
			templateRoot: resolve(localStarterArtifactRoot, 'template'),
		};
	}
	if (existsSync(product.artifactManifestPath) && existsSync(product.templateRoot)) {
		return {
			artifactRoot: product.artifactRoot,
			manifestPath: product.artifactManifestPath,
			templateRoot: product.templateRoot,
		};
	}
	return product.fulfillment.source.kind === 'git'
		? materializeGitTemplateSource(product, options)
		: materializeR2TemplateSource(product);
}

function readTemplateCatalogCache(cachePath: string) {
	if (!existsSync(cachePath)) {
		return null;
	}
	return loadJsonFile<TemplateCatalogCache>(cachePath);
}

function writeTemplateCatalogCache(cachePath: string, endpoint: string, response: SdkTemplateCatalogResponse) {
	ensureDir(cachePath);
	const payload: TemplateCatalogCache = {
		endpoint,
		fetchedAt: new Date().toISOString(),
		items: response.items,
	};
	writeFileSync(cachePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function loadRemoteTemplateCatalog(options: TemplateCatalogOptions = {}) {
	const cwd = options.cwd ?? process.cwd();
	const env = options.env ?? process.env;
	const endpoint = resolveTreeseedTemplateCatalogEndpoint(cwd, env);
	const cachePath = resolveTreeseedTemplateCatalogCachePath(cwd);

	try {
		const response = await new RemoteTemplateCatalogClient({ endpoint }).listTemplates();
		writeTemplateCatalogCache(cachePath, endpoint, response);
		return {
			items: response.items,
			endpoint,
			usedCache: false,
		};
	} catch (error) {
		const cached = readTemplateCatalogCache(cachePath);
		if (!cached) {
			throw error;
		}

		options.writeWarning?.(
			`Using cached template catalog from ${cached.fetchedAt} because the remote endpoint could not be reached.`,
		);
		return {
			items: cached.items,
			endpoint: cached.endpoint,
			usedCache: true,
		};
	}
}

function loadTemplateState(siteRoot: string): TemplateState {
	const statePath = resolve(siteRoot, '.treeseed', 'template-state.json');
	if (!existsSync(statePath)) {
		throw new Error(`Template state is missing at ${statePath}. This site may not have been created from a Treeseed template.`);
	}
	return loadJsonFile<TemplateState>(statePath);
}

function writeTemplateState(siteRoot: string, state: TemplateState) {
	const statePath = resolve(siteRoot, '.treeseed', 'template-state.json');
	ensureDir(statePath);
	writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function toTitleCase(value: string) {
	return value
		.split(/[-_\s]+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ');
}

function inferSlug(target: string, explicitSlug?: string | null) {
	return (explicitSlug ?? target).toLowerCase().replace(/[^a-z0-9-]+/g, '-');
}

function inferName(target: string, explicitName?: string | null) {
	return explicitName ?? toTitleCase(target);
}

function resolveVariableValue(variable: TemplateVariableDefinition, input: StarterResolutionInput) {
	switch (variable.deriveFrom) {
		case 'slug':
			return inferSlug(input.target, input.slug);
		case 'name':
			return inferName(input.target, input.name);
		case 'siteUrl':
			return input.siteUrl ?? variable.default ?? '';
		case 'contactEmail':
			return input.contactEmail ?? variable.default ?? '';
		case 'repositoryUrl':
			return input.repositoryUrl ?? variable.default ?? '';
		case 'discordUrl':
			return input.discordUrl ?? variable.default ?? '';
		case 'cliVersion':
			return `^${cliPackageVersion}`;
		case 'agentVersion':
			return `^${agentPackageVersion}`;
		case 'coreVersion':
			return `^${corePackageVersion}`;
		case 'sdkVersion':
			return `^${sdkPackageVersion}`;
		default:
			return variable.default ?? '';
	}
}

function applyReplacements(source: string, replacements: Record<string, string>) {
	let output = source;
	for (const [token, value] of Object.entries(replacements)) {
		output = output.split(token).join(value);
	}
	return output;
}

function renderTemplateFile(filePath: string, replacements: Record<string, string>) {
	return applyReplacements(readFileSync(filePath, 'utf8'), replacements);
}

function copyTemplateTree(templateRoot: string, targetRoot: string, replacements: Record<string, string>) {
	for (const filePath of listFiles(templateRoot)) {
		const relativePath = relative(templateRoot, filePath);
		const outputPath = resolve(targetRoot, relativePath);
		ensureDir(outputPath);
		if (isTextFile(filePath)) {
			writeFileSync(outputPath, renderTemplateFile(filePath, replacements), 'utf8');
			continue;
		}
		cpSync(filePath, outputPath, { recursive: false });
	}
}

function syncManagedPackageJson(targetPath: string, sourcePath: string, replacements: Record<string, string>, check: boolean) {
	const currentJson = existsSync(targetPath) ? loadJsonFile<Record<string, unknown>>(targetPath) : {};
	const templateJson = JSON.parse(renderTemplateFile(sourcePath, replacements)) as Record<string, unknown>;
	const nextJson = {
		...currentJson,
		type: templateJson.type ?? currentJson.type,
		scripts: typeof templateJson.scripts === 'object' && templateJson.scripts !== null
			? { ...(currentJson.scripts as Record<string, unknown> | undefined ?? {}), ...(templateJson.scripts as Record<string, unknown>) }
			: currentJson.scripts,
		dependencies: {
			...(currentJson.dependencies as Record<string, unknown> | undefined ?? {}),
			...Object.fromEntries(
				Object.entries((templateJson.dependencies as Record<string, unknown> | undefined) ?? {}).filter(([name]) => name.startsWith('@treeseed/')),
			),
		},
	};
	const currentSerialized = `${JSON.stringify(currentJson, null, 2)}\n`;
	const nextSerialized = `${JSON.stringify(nextJson, null, 2)}\n`;
	if (currentSerialized === nextSerialized) {
		return false;
	}
	if (!check) {
		writeFileSync(targetPath, nextSerialized, 'utf8');
	}
	return true;
}

function validateYamlFile(filePath: string) {
	parseYaml(readFileSync(filePath, 'utf8'));
}

export async function listTemplateProducts(options: TemplateCatalogOptions = {}) {
	const remoteCatalog = await loadRemoteTemplateCatalog(options);
	return remoteCatalog.items
		.map((entry) => normalizeTemplateProduct(entry))
		.sort((left, right) => {
			const featuredDiff = Number(Boolean(right.featured)) - Number(Boolean(left.featured));
			if (featuredDiff !== 0) {
				return featuredDiff;
			}
			return left.displayName.localeCompare(right.displayName, undefined, { sensitivity: 'base' });
		});
}

export async function resolveTemplateProduct(id: string, options: TemplateCatalogOptions = {}) {
	const normalizedId = normalizeTreeseedTemplateId(id);
	const product = (await listTemplateProducts(options)).find((entry) => entry.id === normalizedId);
	if (!product) {
		throw new Error(`Unable to resolve remote template product "${id}".`);
	}
	return product;
}

export async function resolveTemplateDefinition(id: string, options: TemplateCatalogOptions = {}, category?: TemplateCategory): Promise<ResolvedTemplateDefinition> {
	const product = await resolveTemplateProduct(id, options);
	if (category && product.category !== category) {
		throw new Error(`Unable to resolve template "${id}" in category "${category}".`);
	}
	validateTemplateProductShape(product);
	const resolvedPaths = resolveTemplateDefinitionPaths(product, options);
	const manifest = loadJsonFile<TemplateManifest>(resolvedPaths.manifestPath);
	const definition = {
		product,
		manifestPath: resolvedPaths.manifestPath,
		templateRoot: resolvedPaths.templateRoot,
		manifest,
	};
	validateTemplateManifest(definition);
	return definition;
}

export async function validateTemplateProduct(product: Pick<TemplateProductDefinition, 'id'>, options: TemplateCatalogOptions = {}) {
	const definition = await resolveTemplateDefinition(product.id, options);
	if (definition.manifest.templateApiVersion !== definition.product.templateApiVersion) {
		throw new Error(`Template product ${definition.product.id} and artifact templateApiVersion do not match.`);
	}
	if ((definition.manifest.templateVersion ?? '') && definition.manifest.templateVersion !== definition.product.templateVersion) {
		throw new Error(`Template product ${definition.product.id} and artifact templateVersion do not match.`);
	}
	if (definition.manifest.minCliVersion !== definition.product.minCliVersion) {
		throw new Error(`Template product ${definition.product.id} and artifact minCliVersion do not match.`);
	}
	if ((definition.manifest.minCoreVersion ?? '') && definition.manifest.minCoreVersion !== definition.product.minCoreVersion) {
		throw new Error(`Template product ${definition.product.id} and artifact minCoreVersion do not match.`);
	}
	return definition;
}

export async function validateAllTemplateDefinitions(options: TemplateCatalogOptions = {}) {
	const ids = listTemplateArtifactIds();
	return Promise.all(ids.map((id) => validateTemplateProduct({ id }, options)));
}

export function buildTemplateReplacements(manifest: TemplateManifest, input: StarterResolutionInput) {
	const replacements: Record<string, string> = {};
	for (const variable of manifest.variables) {
		const value = resolveVariableValue(variable, input);
		if (variable.required && !value) {
			throw new Error(`Template "${manifest.id}" requires a value for "${variable.name}".`);
		}
		replacements[variable.token] = value;
	}
	return replacements;
}

export async function scaffoldTemplateProject(templateId: string, targetRoot: string, input: StarterResolutionInput, options: TemplateCatalogOptions = {}) {
	const definition = await resolveTemplateDefinition(templateId, options);
	const replacements = buildTemplateReplacements(definition.manifest, {
		...input,
		target: basename(targetRoot),
	});
	copyTemplateTree(definition.templateRoot, targetRoot, replacements);
	writeTemplateState(targetRoot, {
		templateId: definition.product.id,
		templateVersion: definition.product.templateVersion,
		sourceRef: definition.product.fulfillment.source.ref,
		installedAt: new Date().toISOString(),
		lastSyncedAt: new Date().toISOString(),
		replacements,
		...(input.hostBindingState ? {
			hostBindings: input.hostBindingState.hostBindings,
			hostBindingPlans: input.hostBindingState.hostBindingPlans,
			hostBindingSummaries: input.hostBindingState.hostBindingSummaries,
			hostBindingConfig: input.hostBindingState.hostBindingConfig,
		} : {}),
	});
	return definition.product;
}

export function recordTemplateHostBindingState(siteRoot: string, hostBindingState: StarterHostBindingState) {
	const state = loadTemplateState(siteRoot);
	writeTemplateState(siteRoot, {
		...state,
		hostBindings: hostBindingState.hostBindings,
		hostBindingPlans: hostBindingState.hostBindingPlans,
		hostBindingSummaries: hostBindingState.hostBindingSummaries,
		hostBindingConfig: hostBindingState.hostBindingConfig,
	});
}

function preserveHostBindingOverlayIfNeeded(relativePath: string, currentContent: string, nextContent: string, state: TemplateState) {
	if (!state.hostBindingPlans) {
		return nextContent;
	}
	if (
		relativePath !== 'treeseed.site.yaml'
		&& relativePath !== 'src/env.yaml'
		&& relativePath !== 'src/manifest.yaml'
		&& relativePath !== 'package.json'
	) {
		return nextContent;
	}
	return preserveProjectLaunchHostBindingConfigOverlay({
		target: relativePath as 'treeseed.site.yaml' | 'src/env.yaml' | 'src/manifest.yaml' | 'package.json',
		currentContent,
		nextContent,
		hostBindingPlans: state.hostBindingPlans,
	});
}

function structuredTemplateContentMatches(relativePath: string, currentContent: string, nextContent: string) {
	if (
		relativePath !== 'treeseed.site.yaml'
		&& relativePath !== 'src/env.yaml'
		&& relativePath !== 'src/manifest.yaml'
		&& relativePath !== 'package.json'
	) {
		return false;
	}
	try {
		const current = relativePath === 'package.json' ? JSON.parse(currentContent || '{}') : parseYaml(currentContent || '{}');
		const next = relativePath === 'package.json' ? JSON.parse(nextContent || '{}') : parseYaml(nextContent || '{}');
		return JSON.stringify(current) === JSON.stringify(next);
	} catch {
		return false;
	}
}

export async function syncTemplateProject(siteRoot: string, options: TemplateCatalogOptions & { check?: boolean } = {}) {
	const check = options.check === true;
	const state = loadTemplateState(siteRoot);
	const definition = await resolveTemplateDefinition(state.templateId, options);
	const managedSurface = definition.manifest.managedSurface ?? {};
	const changes: string[] = [];

	for (const relativePath of managedSurface.coreManaged ?? []) {
		const targetPath = resolve(siteRoot, relativePath);
		const sourcePath = resolve(definition.templateRoot, relativePath);
		if (!existsSync(sourcePath)) {
			throw new Error(`Managed template file is missing from artifact: ${relativePath}`);
		}

		if (relativePath === 'package.json') {
			if (syncManagedPackageJson(targetPath, sourcePath, state.replacements, check)) {
				changes.push(relativePath);
			}
			continue;
		}

		const currentContent = existsSync(targetPath) ? readFileSync(targetPath, 'utf8') : '';
		const nextContent = preserveHostBindingOverlayIfNeeded(
			relativePath,
			currentContent,
			renderTemplateFile(sourcePath, state.replacements),
			state,
		);
		if (currentContent === nextContent) {
			continue;
		}
		if (state.hostBindingPlans && structuredTemplateContentMatches(relativePath, currentContent, nextContent)) {
			continue;
		}
		if (!check) {
			ensureDir(targetPath);
			writeFileSync(targetPath, nextContent, 'utf8');
		}
		changes.push(relativePath);
	}

	for (const relativePath of managedSurface.validatedOnly ?? []) {
		const targetPath = resolve(siteRoot, relativePath);
		if (!existsSync(targetPath)) {
			throw new Error(`Validated file is missing from generated site: ${relativePath}`);
		}
		validateYamlFile(targetPath);
	}

	if (!check) {
		writeTemplateState(siteRoot, {
			...state,
			templateId: definition.product.id,
			templateVersion: definition.product.templateVersion,
			sourceRef: definition.product.fulfillment.source.ref,
			lastSyncedAt: new Date().toISOString(),
		});
	}

	return changes;
}

export function serializeTemplateRegistryEntry(product: Pick<TemplateProductDefinition, 'id' | 'displayName' | 'description' | 'summary' | 'status' | 'featured' | 'category' | 'tags' | 'publisher' | 'templateVersion' | 'templateApiVersion' | 'minCliVersion' | 'minCoreVersion' | 'fulfillment' | 'launchRequirements'>) {
	return {
		id: product.id,
		displayName: product.displayName,
		description: product.description,
		summary: product.summary,
		status: product.status,
		featured: Boolean(product.featured),
		category: product.category,
		tags: product.tags ?? [],
		publisher: product.publisher,
		templateVersion: product.templateVersion,
		templateApiVersion: product.templateApiVersion,
		minCliVersion: product.minCliVersion,
		minCoreVersion: product.minCoreVersion,
		fulfillmentMode: product.fulfillment.mode ?? 'packaged',
		source: product.fulfillment.source,
		launchRequirements: product.launchRequirements,
	};
}

export async function exportTemplateCatalogYaml(options: TemplateCatalogOptions = {}) {
	return stringifyYaml((await listTemplateProducts(options)).map(serializeTemplateRegistryEntry));
}
