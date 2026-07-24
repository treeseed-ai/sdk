import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, relative, resolve } from 'node:path';
import { runRepositoryGit } from '../operations/git-runner.ts';
import {
	normalizeTemplateId,
	type SdkTemplateCatalogEntry,
	type SdkTemplateCatalogResponse,
	type TemplateLaunchRequirements,
} from '../../../entrypoints/models/sdk-types.ts';
import { RemoteTemplateCatalogClient } from '../../../commerce/catalog/template-catalog.ts';
import {
	type ProjectLaunchConfigWritePlanItem,
	type ProjectLaunchLocalHostBindingSummary,
	type ProjectLaunchResolvedHostBinding,
	type ProjectLaunchSecretDeploymentPlanItem,
	normalizeTemplateLaunchRequirements,
} from '../../../entrypoints/templates/template-launch-requirements.ts';
import { preserveProjectLaunchHostBindingConfigOverlay } from '../hosting/deployment/template-host-bindings.ts';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
	resolveTemplateCatalogCachePath,
	resolveTemplateCatalogEndpoint,
} from '../configuration/config-runtime.ts';
import {
	cliPackageVersion,
	agentPackageVersion,
	corePackageVersion,
	cliPackageRoot,
	localTemplateArtifactsRoot,
	sdkPackageVersion,
} from '../runtime/runtime-paths.ts';
import { ResolvedTemplateDefinition, StarterHostBindingState, StarterResolutionInput, TemplateCatalogOptions, TemplateCategory, TemplateManifest, TemplateProductDefinition, TemplateState, ensureDir, listTemplateArtifactIds, loadJsonFile, validateTemplateManifest, validateTemplateProductShape } from './template-categories.ts';
import { copyTemplateTree, loadRemoteTemplateCatalog, loadTemplateState, normalizeTemplateProduct, renderTemplateFile, resolveTemplateDefinitionPaths, resolveVariableValue, writeTemplateState } from './validate-template-placeholders.ts';

export function syncManagedPackageJson(targetPath: string, sourcePath: string, replacements: Record<string, string>, check: boolean) {
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

export function validateYamlFile(filePath: string) {
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
	const normalizedId = normalizeTemplateId(id);
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

export function preserveHostBindingOverlayIfNeeded(relativePath: string, currentContent: string, nextContent: string, state: TemplateState) {
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

export function structuredTemplateContentMatches(relativePath: string, currentContent: string, nextContent: string) {
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
