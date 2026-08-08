import type { DesiredUnit, ReconcileTarget } from '../../reconcile/support/contracts/contracts.js';
import { createReconcileUnitId } from '../../reconcile/support/engine/units.js';
import type { SeedEnvironment, SeedManifest, SeedRepositoryPolicy } from '../types.js';

const safePolicy: SeedRepositoryPolicy = {
	visibility: 'private',
	lifecycle: 'adopt-only',
	deletionPolicy: 'retain',
	defaultBranch: 'main',
	stagingBranch: 'staging',
	issues: true,
	actions: true,
};

function targetFor(environment: SeedEnvironment): ReconcileTarget {
	return { kind: 'persistent', scope: environment };
}

function selected(resource: { environments?: SeedEnvironment[] }, manifest: SeedManifest, environment: SeedEnvironment) {
	return (resource.environments?.length ? resource.environments : manifest.environments).includes(environment);
}

function identity(teamKey: string, projectKey: string, slug: string, environment: SeedEnvironment) {
	return {
		teamId: teamKey,
		projectId: projectKey,
		slug,
		environment,
		deploymentKey: `${slug}-${environment}`,
		environmentKey: environment,
	};
}

function spec(repository: string, policy: SeedRepositoryPolicy | undefined, description: string | undefined, fallbackVisibility: SeedRepositoryPolicy['visibility'] = 'private') {
	const resolved = policy ?? { ...safePolicy, visibility: fallbackVisibility };
	return {
		repository,
		description: description ?? null,
		visibility: resolved.visibility,
		lifecycle: resolved.lifecycle,
		deletionPolicy: resolved.deletionPolicy,
		defaultBranch: resolved.defaultBranch,
		stagingBranch: resolved.stagingBranch,
		issues: resolved.issues,
		actions: resolved.actions,
		projects: false,
		wiki: false,
	};
}

export function compileSeedRepositoryUnits(manifest: SeedManifest, environment: SeedEnvironment): DesiredUnit[] {
	const units: DesiredUnit[] = [];
	const projects = new Map(manifest.resources.projects.map((project) => [project.key, project]));
	for (const project of manifest.resources.projects) {
		if (!selected(project, manifest, environment)) continue;
		const repository = `${project.repository.owner}/${project.repository.name}`;
		units.push({
			unitId: createReconcileUnitId('github-repository', repository),
			unitType: 'github-repository',
			provider: 'github',
			identity: identity(project.team, project.key, project.slug, environment),
			target: targetFor(environment),
			logicalName: repository,
			dependencies: [],
			spec: spec(repository, project.repository.repositoryPolicy, project.description, project.metadata?.visibility === 'public' ? 'public' : 'private'),
			secrets: {},
			metadata: { seed: manifest.name, resourceKey: project.key, repositoryRole: 'primary' },
		});
	}
	for (const repository of manifest.resources.hubRepositories) {
		if (!selected(repository, manifest, environment)) continue;
		const project = projects.get(repository.project);
		if (!project) continue;
		const slug = `${repository.owner}/${repository.name}`;
		units.push({
			unitId: createReconcileUnitId('github-repository', slug),
			unitType: 'github-repository',
			provider: 'github',
			identity: identity(project.team, project.key, project.slug, environment),
			target: targetFor(environment),
			logicalName: slug,
			dependencies: [],
			spec: spec(slug, repository.repositoryPolicy, `${project.name} content repository.`),
			secrets: {},
			metadata: { seed: manifest.name, resourceKey: repository.key, repositoryRole: repository.role },
		});
	}
	return units.sort((left, right) => left.unitId.localeCompare(right.unitId));
}
