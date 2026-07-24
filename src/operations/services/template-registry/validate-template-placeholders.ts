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
import { ResolvedTemplateDefinition, StarterResolutionInput, TemplateCatalogCache, TemplateCatalogOptions, TemplateProductDefinition, TemplateState, TemplateVariableDefinition, ensureDir, isTextFile, listFiles, loadJsonFile, resolveLocalStarterArtifactRoot } from './template-categories.ts';

export function validateTemplatePlaceholders(definition: ResolvedTemplateDefinition) {
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

export function normalizeTemplateProduct(remoteProduct: SdkTemplateCatalogEntry): TemplateProductDefinition {
	const id = normalizeTemplateId(remoteProduct.id);
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

export function sanitizeCacheSegment(value: string) {
	return value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'source';
}

export function resolveTemplateSourceCacheRoot(product: TemplateProductDefinition, options: TemplateCatalogOptions) {
	const cachePath = resolveTemplateCatalogCachePath(options.cwd ?? process.cwd());
	const sourceVersion = product.fulfillment.source.kind === 'git'
		? product.fulfillment.source.ref
		: product.fulfillment.source.version;
	return resolve(dirname(cachePath), 'templates', sanitizeCacheSegment(product.id), sanitizeCacheSegment(sourceVersion));
}

export function runGit(commandArgs: string[], cwd?: string) {
	const mutating = /^(add|commit|checkout|switch|merge|tag|push|fetch|worktree|submodule|reset|clean|restore|branch|clone)$/u.test(commandArgs[0] ?? '');
	const result = runRepositoryGit(commandArgs, {
		cwd: cwd ?? process.cwd(),
		mode: mutating ? 'mutate' : 'read',
	});
	if (result.status !== 0) {
		throw new Error(result.stderr?.trim() || result.stdout?.trim() || `git ${commandArgs.join(' ')} failed`);
	}
}

export function readGitOutput(commandArgs: string[], cwd?: string) {
	const result = runRepositoryGit(commandArgs, {
		cwd: cwd ?? process.cwd(),
		mode: 'read',
		allowFailure: true,
	});
	return result.status === 0 ? result.stdout.trim() : null;
}

export function materializeGitTemplateSource(product: TemplateProductDefinition, options: TemplateCatalogOptions) {
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

export function materializeR2TemplateSource(product: TemplateProductDefinition) {
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

export function resolveTemplateDefinitionPaths(product: TemplateProductDefinition, options: TemplateCatalogOptions) {
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

export function readTemplateCatalogCache(cachePath: string) {
	if (!existsSync(cachePath)) {
		return null;
	}
	return loadJsonFile<TemplateCatalogCache>(cachePath);
}

export function writeTemplateCatalogCache(cachePath: string, endpoint: string, response: SdkTemplateCatalogResponse) {
	ensureDir(cachePath);
	const payload: TemplateCatalogCache = {
		endpoint,
		fetchedAt: new Date().toISOString(),
		items: response.items,
	};
	writeFileSync(cachePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

export async function loadRemoteTemplateCatalog(options: TemplateCatalogOptions = {}) {
	const cwd = options.cwd ?? process.cwd();
	const env = options.env ?? process.env;
	const endpoint = resolveTemplateCatalogEndpoint(cwd, env);
	const cachePath = resolveTemplateCatalogCachePath(cwd);

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

export function loadTemplateState(siteRoot: string): TemplateState {
	const statePath = resolve(siteRoot, '.treeseed', 'template-state.json');
	if (!existsSync(statePath)) {
		throw new Error(`Template state is missing at ${statePath}. This site may not have been created from a Treeseed template.`);
	}
	return loadJsonFile<TemplateState>(statePath);
}

export function writeTemplateState(siteRoot: string, state: TemplateState) {
	const statePath = resolve(siteRoot, '.treeseed', 'template-state.json');
	ensureDir(statePath);
	writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function toTitleCase(value: string) {
	return value
		.split(/[-_\s]+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ');
}

export function inferSlug(target: string, explicitSlug?: string | null) {
	return (explicitSlug ?? target).toLowerCase().replace(/[^a-z0-9-]+/g, '-');
}

export function inferName(target: string, explicitName?: string | null) {
	return explicitName ?? toTitleCase(target);
}

export function resolveVariableValue(variable: TemplateVariableDefinition, input: StarterResolutionInput) {
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

export function applyReplacements(source: string, replacements: Record<string, string>) {
	let output = source;
	for (const [token, value] of Object.entries(replacements)) {
		output = output.split(token).join(value);
	}
	return output;
}

export function renderTemplateFile(filePath: string, replacements: Record<string, string>) {
	return applyReplacements(readFileSync(filePath, 'utf8'), replacements);
}

export function copyTemplateTree(templateRoot: string, targetRoot: string, replacements: Record<string, string>) {
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
