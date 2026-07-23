import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, relative, resolve } from 'node:path';
import { runTreeseedGit } from '../git-runner.ts';
import {
	normalizeTreeseedTemplateId,
	type SdkTemplateCatalogEntry,
	type SdkTemplateCatalogResponse,
	type TemplateLaunchRequirements,
} from '../../../sdk-types.ts';
import { RemoteTemplateCatalogClient } from '../../../template-catalog.ts';
import {
	type ProjectLaunchConfigWritePlanItem,
	type ProjectLaunchLocalHostBindingSummary,
	type ProjectLaunchResolvedHostBinding,
	type ProjectLaunchSecretDeploymentPlanItem,
	normalizeTemplateLaunchRequirements,
} from '../../../template-launch-requirements.ts';
import { preserveProjectLaunchHostBindingConfigOverlay } from '../template-host-bindings.ts';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
	resolveTreeseedTemplateCatalogCachePath,
	resolveTreeseedTemplateCatalogEndpoint,
} from '../config-runtime.ts';
import {
	cliPackageVersion,
	agentPackageVersion,
	corePackageVersion,
	cliPackageRoot,
	localTemplateArtifactsRoot,
	sdkPackageVersion,
} from '../runtime-paths.ts';
import { validateTemplatePlaceholders } from './validate-template-placeholders.ts';

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

export interface TemplateState {
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
	const directory = LOCAL_STARTER_ID_TO_DIRECTORY[normalizeTreeseedTemplateId(id)];
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
	manifest.launchRequirements = normalizeTemplateLaunchRequirements(manifest.launchRequirements, `${manifestPath}: launchRequirements`);
	validateTemplatePlaceholders(definition);
}
