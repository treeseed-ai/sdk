import { existsSync,mkdirSync,readdirSync,readFileSync } from 'node:fs';
import { basename,dirname,relative,resolve } from 'node:path';
import {
normalizeTemplateId,
type SdkTemplateCatalogEntry
} from '../../../entrypoints/models/sdk-types.ts';
import {
cliPackageRoot,
localTemplateArtifactsRoot
} from '../runtime/runtime-paths.ts';
import { validateTemplatePlaceholders } from './validate-template-placeholders.ts';

export const TEMPLATE_CATEGORIES = ['starter', 'example', 'fixture', 'reference-app', 'platform'] as const;

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
	platform?: PlatformTemplateComposition;
	testing: {
		smokeCommand?: string;
		buildCommand?: string;
	};
}

export interface PlatformTemplateComposition {
	controlPlane: { mode: 'managed' | 'external'; baseUrl?: string };
	processing: { mode: 'team-owned' | 'project-owned' | 'local' | 'market-assigned' | 'none' };
	admin: { enabled: boolean };
	executionProvider: 'codex' | 'treeseed-ai' | 'none';
	aiAppliance: boolean;
	services: string[];
	seeds: string[];
	scenes: string[];
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
	controlPlaneBaseUrl?: string | null;
}

export interface TemplateState {
	templateId: string;
	templateVersion?: string;
	sourceRef?: string;
	installedAt: string;
	lastSyncedAt?: string;
	replacements: Record<string, string>;
	definitionDigest?: string;
	managedPaths?: string[];
	seedPaths?: string[];
	scenePaths?: string[];
}

export interface TemplateCatalogCache {
	endpoint: string;
	fetchedAt: string;
	items: SdkTemplateCatalogEntry[];
}

export interface TemplateCatalogOptions {
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	writeWarning?: (message: string) => void;
}

export function loadJsonFile<T>(filePath: string): T {
	return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

export function ensureDir(filePath: string) {
	mkdirSync(dirname(filePath), { recursive: true });
}

export const templatePayloadIgnoredDirectoryNames = new Set([
	'node_modules',
	'dist',
	'.astro',
]);

export const templatePayloadIgnoredRelativePaths = new Set([
	'.treeseed/generated',
	'.treeseed/test-reports',
	'public/books',
]);

const forbiddenPlatformAsset = /(^|\/)(?:\.treeseed|node_modules|dist|test-results|worktrees?|workspaces?|logs?|traces?|screenshots?|videos?|renders?|cache)(?:\/|$)|\.(?:png|jpe?g|gif|webp|mp4|webm|mov|trace|log|zip)$/iu;

function validatePlatformAssetPath(path: string, kind: 'seed' | 'scene') {
	const normalized = normalizeTemplateRelativePath(path);
	if (normalized.startsWith('/') || normalized.includes('../') || forbiddenPlatformAsset.test(normalized)) {
		throw new Error(`Platform template ${kind} path is not a portable configuration asset: ${path}`);
	}
	if (!/\.ya?ml$/iu.test(normalized)) throw new Error(`Platform template ${kind} path must be YAML: ${path}`);
}

function validatePlatformComposition(manifest: TemplateManifest) {
	const composition = manifest.platform;
	if (manifest.category !== 'platform') {
		if (composition) throw new Error(`Non-Platform template ${manifest.id} cannot declare platform composition.`);
		return;
	}
	if (!composition) throw new Error(`Platform template ${manifest.id} is missing platform composition.`);
	if (composition.controlPlane.mode === 'external' && !composition.controlPlane.baseUrl) throw new Error(`Platform template ${manifest.id} requires an external control-plane URL.`);
	if (composition.controlPlane.mode !== 'external' && composition.controlPlane.baseUrl) throw new Error(`Platform template ${manifest.id} cannot set a control-plane URL in ${composition.controlPlane.mode} mode.`);
	const services = new Set(composition.services);
	if (composition.controlPlane.mode === 'managed') {
		for (const required of ['api', 'treeseedDatabase', 'operationsRunner', 'treedx']) if (!services.has(required)) throw new Error(`Managed Platform template ${manifest.id} requires ${required}.`);
	}
	if (composition.executionProvider === 'treeseed-ai' && !composition.aiAppliance) throw new Error(`Platform template ${manifest.id} selects TreeSeed AI without the AI appliance.`);
	if (composition.executionProvider !== 'treeseed-ai' && composition.aiAppliance) throw new Error(`Platform template ${manifest.id} enables the AI appliance without selecting TreeSeed AI.`);
	for (const path of composition.seeds) validatePlatformAssetPath(path, 'seed');
	for (const path of composition.scenes) validatePlatformAssetPath(path, 'scene');
}

export function normalizeTemplateRelativePath(path: string) {
	return path.split(/[\\/]+/u).join('/');
}

export function isIgnoredTemplatePayloadDirectory(root: string, directoryPath: string) {
	const relativePath = normalizeTemplateRelativePath(relative(root, directoryPath));
	return templatePayloadIgnoredDirectoryNames.has(basename(directoryPath))
		|| templatePayloadIgnoredRelativePaths.has(relativePath);
}

export function listFiles(root: string, currentRoot = root): string[] {
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

export function listTemplateArtifactIds() {
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

export const LOCAL_STARTER_ID_TO_DIRECTORY: Record<string, string> = {
	'research': 'research',
	'engineering': 'engineering',
};

export function localStartersRoot() {
	return resolve(cliPackageRoot, '..', '..', 'starters');
}

export function resolveLocalStarterArtifactRoot(id: string) {
	const directory = LOCAL_STARTER_ID_TO_DIRECTORY[normalizeTemplateId(id)];
	if (!directory) {
		return null;
	}
	const artifactRoot = resolve(localStartersRoot(), directory);
	return existsSync(resolve(artifactRoot, 'template.config.json')) && existsSync(resolve(artifactRoot, 'template'))
		? artifactRoot
		: null;
}

export function listLocalStarterArtifacts() {
	return Object.keys(LOCAL_STARTER_ID_TO_DIRECTORY)
		.map((id) => {
			const artifactRoot = resolveLocalStarterArtifactRoot(id);
			return artifactRoot ? { id, artifactRoot } : null;
		})
		.filter((entry): entry is { id: string; artifactRoot: string } => Boolean(entry));
}

export function isTextFile(filePath: string) {
	return !/\.(png|jpe?g|gif|webp|ico|woff2?|ttf|eot|pdf|zip|gz)$/iu.test(filePath);
}

export function validateTemplateProductShape(product: TemplateProductDefinition) {
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

export function validateTemplateManifest(definition: ResolvedTemplateDefinition) {
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
	validateTemplatePlaceholders(definition);
	validatePlatformComposition(manifest);
	for (const path of [...(manifest.platform?.seeds ?? []), ...(manifest.platform?.scenes ?? [])]) {
		if (!existsSync(resolve(templateRoot, path))) throw new Error(`Platform template ${manifest.id} is missing configuration asset ${path}.`);
	}
}
