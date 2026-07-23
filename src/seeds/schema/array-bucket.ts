import { errorDiagnostic, warningDiagnostic } from '../errors.js';
import {
	SEED_CONTENT_PUBLISH_TARGETS,
	SEED_CONTENT_RUNTIME_SOURCES,
	SEED_ENVIRONMENTS,
	SEED_LOCAL_CONTENT_MATERIALIZATIONS,
	SEED_PROJECT_TOPOLOGIES,
	type SeedCatalogArtifactResource,
	type SeedContentPublishTargetKind,
	type SeedContentRuntimeSource,
	type SeedDiagnostic,
	type SeedEnvironment,
	type SeedHubRepositoryResource,
	type SeedLocalContentMaterialization,
	type SeedManifest,
	type SeedManifestResources,
	type SeedOperationRecipe,
	type SeedOperationRecipeArtifact,
	type SeedOperationRecipeAssertion,
	type SeedOperationRecipeChannel,
	type SeedOperationRecipeCommand,
	type SeedOperationRecipeStep,
	type SeedProductResource,
	type SeedProjectArchitecture,
	type SeedProjectContentPublishTarget,
	type SeedProjectRepository,
	type SeedProjectResource,
	type SeedProjectTopology,
	type SeedRepositoryHostResource,
	type SeedResourceBase,
	type SeedTeamResource,
} from '../types.js';
import { RESOURCE_BUCKETS, SUPPORTED_BUCKETS, asString, isRecord, parseEnvironments, parseTeam, requireString } from './resource-buckets.ts';
import { parseCatalogArtifact, parseHubRepository, parseOperationRecipe, parseProduct, parseProject, parseRepositoryHost, walkForSecrets } from './parse-project.ts';

export function arrayBucket(resources: Record<string, unknown>, bucket: string, diagnostics: SeedDiagnostic[]) {
	const value = resources[bucket];
	if (value === undefined) return [];
	if (!Array.isArray(value)) {
		diagnostics.push(errorDiagnostic('seed.invalid_resource_bucket', `resources.${bucket} must be an array.`, `resources.${bucket}`));
		return [];
	}
	if (!SUPPORTED_BUCKETS.has(bucket) && value.length > 0) {
		diagnostics.push(errorDiagnostic('seed.unsupported_resource_kind', `resources.${bucket} is recognized but is not backed by seed reconciliation yet.`, `resources.${bucket}`));
	}
	return value;
}

export function validateResourceKeys(manifest: SeedManifest, diagnostics: SeedDiagnostic[]) {
	const seen = new Map<string, string>();
	const visit = (key: string, path: string) => {
		if (!key) return;
		const existingPath = seen.get(key);
		if (existingPath) {
			diagnostics.push(errorDiagnostic('seed.duplicate_key', `Duplicate resource key ${key}; first seen at ${existingPath}.`, path));
			return;
		}
		seen.set(key, path);
	};
	manifest.resources.teams.forEach((team, index) => visit(team.key, `resources.teams[${index}].key`));
	manifest.resources.repositoryHosts.forEach((host, index) => visit(host.key, `resources.repositoryHosts[${index}].key`));
	manifest.resources.projects.forEach((project, index) => visit(project.key, `resources.projects[${index}].key`));
	manifest.resources.hubRepositories.forEach((repository, index) => visit(repository.key, `resources.hubRepositories[${index}].key`));
	manifest.resources.products.forEach((product, index) => visit(product.key, `resources.products[${index}].key`));
	manifest.resources.catalogArtifacts.forEach((artifact, index) => visit(artifact.key, `resources.catalogArtifacts[${index}].key`));
}

export function validateReferences(manifest: SeedManifest, diagnostics: SeedDiagnostic[]) {
	const teamKeys = new Set(manifest.resources.teams.map((team) => team.key));
	const projectKeys = new Set(manifest.resources.projects.map((project) => project.key));
	const repositoryHostKeys = new Set(manifest.resources.repositoryHosts.map((host) => host.key));
	const productKeys = new Set(manifest.resources.products.map((product) => product.key));

	manifest.resources.repositoryHosts.forEach((host, index) => {
		if (!teamKeys.has(host.team)) diagnostics.push(errorDiagnostic('seed.invalid_reference', `Unknown team reference: ${host.team}.`, `resources.repositoryHosts[${index}].team`));
	});
	manifest.resources.projects.forEach((project, index) => {
		if (!teamKeys.has(project.team)) diagnostics.push(errorDiagnostic('seed.invalid_reference', `Unknown team reference: ${project.team}.`, `resources.projects[${index}].team`));
	});
	manifest.resources.hubRepositories.forEach((repository, index) => {
		if (!projectKeys.has(repository.project)) diagnostics.push(errorDiagnostic('seed.invalid_reference', `Unknown project reference: ${repository.project}.`, `resources.hubRepositories[${index}].project`));
		if (repository.repositoryHost && !repositoryHostKeys.has(repository.repositoryHost)) diagnostics.push(errorDiagnostic('seed.invalid_reference', `Unknown repository host reference: ${repository.repositoryHost}.`, `resources.hubRepositories[${index}].repositoryHost`));
	});
	manifest.resources.products.forEach((product, index) => {
		if (!teamKeys.has(product.team)) diagnostics.push(errorDiagnostic('seed.invalid_reference', `Unknown team reference: ${product.team}.`, `resources.products[${index}].team`));
	});
	manifest.resources.catalogArtifacts.forEach((artifact, index) => {
		if (!productKeys.has(artifact.product)) diagnostics.push(errorDiagnostic('seed.invalid_reference', `Unknown product reference: ${artifact.product}.`, `resources.catalogArtifacts[${index}].product`));
	});
}

export function allResourceKeys(manifest: SeedManifest) {
	return new Set([
		...manifest.resources.teams.map((team) => team.key),
		...manifest.resources.repositoryHosts.map((host) => host.key),
		...manifest.resources.projects.map((project) => project.key),
		...manifest.resources.hubRepositories.map((repository) => repository.key),
		...manifest.resources.products.map((product) => product.key),
		...manifest.resources.catalogArtifacts.map((artifact) => artifact.key),
	]);
}

export function validateOperationRecipes(manifest: SeedManifest, diagnostics: SeedDiagnostic[]) {
	const recipeIds = new Map<string, string>();
	const resourceKeys = allResourceKeys(manifest);
	manifest.operationRecipes.forEach((recipe, recipeIndex) => {
		const recipePath = `operationRecipes[${recipeIndex}]`;
		const existingRecipePath = recipeIds.get(recipe.id);
		if (recipe.id && existingRecipePath) {
			diagnostics.push(errorDiagnostic('seed.recipe_duplicate_id', `Duplicate operation recipe id ${recipe.id}; first seen at ${existingRecipePath}.`, `${recipePath}.id`));
		}
		if (recipe.id) recipeIds.set(recipe.id, `${recipePath}.id`);
		if (recipe.environments.length === 0) {
			diagnostics.push(errorDiagnostic('seed.recipe_missing_environments', 'Operation recipe must target at least one environment.', `${recipePath}.environments`));
		}
		for (const environment of recipe.environments) {
			if (!manifest.environments.includes(environment)) {
				diagnostics.push(errorDiagnostic('seed.recipe_environment_not_declared', `Recipe environment ${environment} is not declared in environments.`, `${recipePath}.environments`));
			}
		}
		const steps = new Map<string, SeedOperationRecipeStep>();
		recipe.steps.forEach((step, stepIndex) => {
			const stepPath = `${recipePath}.steps[${stepIndex}]`;
			const existingStep = steps.get(step.id);
			if (step.id && existingStep) {
				diagnostics.push(errorDiagnostic('seed.recipe_duplicate_step_id', `Duplicate operation recipe step id ${step.id}.`, `${stepPath}.id`));
			}
			if (step.id) steps.set(step.id, step);
			step.uses.forEach((resourceKey, useIndex) => {
				if (!resourceKeys.has(resourceKey)) {
					diagnostics.push(errorDiagnostic('seed.recipe_invalid_resource_reference', `Unknown recipe resource reference: ${resourceKey}.`, `${stepPath}.uses[${useIndex}]`));
				}
			});
		});
		recipe.entrypoints.forEach((entrypoint, entrypointIndex) => {
			if (!steps.has(entrypoint)) {
				diagnostics.push(errorDiagnostic('seed.recipe_invalid_entrypoint', `Unknown recipe entrypoint step: ${entrypoint}.`, `${recipePath}.entrypoints[${entrypointIndex}]`));
			}
		});
		recipe.steps.forEach((step, stepIndex) => {
			step.dependsOn.forEach((dependency, dependencyIndex) => {
				if (!steps.has(dependency)) {
					diagnostics.push(errorDiagnostic('seed.recipe_invalid_dependency', `Unknown recipe dependency step: ${dependency}.`, `${recipePath}.steps[${stepIndex}].dependsOn[${dependencyIndex}]`));
				}
			});
		});
		const visiting = new Set<string>();
		const visited = new Set<string>();
		const visit = (stepId: string, chain: string[]) => {
			if (visited.has(stepId)) return;
			if (visiting.has(stepId)) {
				diagnostics.push(errorDiagnostic('seed.recipe_cycle', `Recipe dependency cycle detected: ${[...chain, stepId].join(' -> ')}.`, recipePath));
				return;
			}
			const step = steps.get(stepId);
			if (!step) return;
			visiting.add(stepId);
			for (const dependency of step.dependsOn) {
				visit(dependency, [...chain, stepId]);
			}
			visiting.delete(stepId);
			visited.add(stepId);
		};
		for (const step of recipe.steps) {
			visit(step.id, []);
		}
	});
}

export function parseSeedManifest(value: unknown, diagnostics: SeedDiagnostic[]): SeedManifest | null {
	walkForSecrets(value, '', diagnostics);
	if (!isRecord(value)) {
		diagnostics.push(errorDiagnostic('seed.invalid_manifest', 'Seed manifest must be an object.', 'manifest'));
		return null;
	}
	const name = requireString(value, 'name', 'manifest', diagnostics);
	if (value.version !== 1) {
		diagnostics.push(errorDiagnostic('seed.unsupported_version', `Unsupported seed manifest version: ${String(value.version)}.`, 'version'));
	}
	const environments = parseEnvironments(value.environments, 'environments', diagnostics) ?? [];
	if (environments.length === 0) {
		diagnostics.push(errorDiagnostic('seed.missing_environments', 'Seed manifest must declare at least one environment.', 'environments'));
	}
	const defaultEnvironments = parseEnvironments(value.defaultEnvironments, 'defaultEnvironments', diagnostics);
	for (const environment of defaultEnvironments ?? []) {
		if (!environments.includes(environment)) {
			diagnostics.push(errorDiagnostic('seed.default_environment_not_declared', `Default environment ${environment} is not declared in environments.`, 'defaultEnvironments'));
		}
	}

	const resourcesValue = value.resources;
	if (!isRecord(resourcesValue)) {
		diagnostics.push(errorDiagnostic('seed.invalid_resources', 'Seed manifest resources must be an object.', 'resources'));
		return null;
	}
	for (const bucket of Object.keys(resourcesValue)) {
		if (!(RESOURCE_BUCKETS as readonly string[]).includes(bucket)) {
			diagnostics.push(errorDiagnostic('seed.unsupported_resource_kind', `Unsupported resource bucket: ${bucket}.`, `resources.${bucket}`));
		}
	}

	const resources: SeedManifestResources = {
		teams: arrayBucket(resourcesValue, 'teams', diagnostics).map((entry, index) => parseTeam(entry, `resources.teams[${index}]`, diagnostics)).filter((team): team is SeedTeamResource => Boolean(team)),
		repositoryHosts: arrayBucket(resourcesValue, 'repositoryHosts', diagnostics).map((entry, index) => parseRepositoryHost(entry, `resources.repositoryHosts[${index}]`, diagnostics)).filter((host): host is SeedRepositoryHostResource => Boolean(host)),
		projects: arrayBucket(resourcesValue, 'projects', diagnostics).map((entry, index) => parseProject(entry, `resources.projects[${index}]`, diagnostics)).filter((project): project is SeedProjectResource => Boolean(project)),
		hubRepositories: arrayBucket(resourcesValue, 'hubRepositories', diagnostics).map((entry, index) => parseHubRepository(entry, `resources.hubRepositories[${index}]`, diagnostics)).filter((repository): repository is SeedHubRepositoryResource => Boolean(repository)),
		products: arrayBucket(resourcesValue, 'products', diagnostics).map((entry, index) => parseProduct(entry, `resources.products[${index}]`, diagnostics)).filter((product): product is SeedProductResource => Boolean(product)),
		catalogArtifacts: arrayBucket(resourcesValue, 'catalogArtifacts', diagnostics).map((entry, index) => parseCatalogArtifact(entry, `resources.catalogArtifacts[${index}]`, diagnostics)).filter((artifact): artifact is SeedCatalogArtifactResource => Boolean(artifact)),
	};

	const manifest: SeedManifest = {
		name,
		version: 1,
		description: asString(value.description) || undefined,
		defaultEnvironments,
		environments,
		resources,
		operationRecipes: Array.isArray(value.operationRecipes)
			? value.operationRecipes.map((recipe, index) => parseOperationRecipe(recipe, `operationRecipes[${index}]`, diagnostics, environments)).filter((recipe): recipe is SeedOperationRecipe => Boolean(recipe))
			: [],
	};
	if (value.operationRecipes !== undefined && !Array.isArray(value.operationRecipes)) {
		diagnostics.push(errorDiagnostic('seed.invalid_operation_recipes', 'operationRecipes must be an array.', 'operationRecipes'));
	}
	validateResourceKeys(manifest, diagnostics);
	validateReferences(manifest, diagnostics);
	validateOperationRecipes(manifest, diagnostics);
	if (diagnostics.length === 0 && manifest.resources.projects.length === 0) {
		diagnostics.push(warningDiagnostic('seed.empty_projects', 'Seed manifest does not define projects.', 'resources.projects'));
	}
	return manifest;
}
