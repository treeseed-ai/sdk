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
	workflows: ['verify.yml'],
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

function lifecycleUnits(input: {
	repositoryUnit: DesiredUnit;
	repository: string;
	policy: SeedRepositoryPolicy | undefined;
	environment: SeedEnvironment;
}) {
	const defaultBranch = input.policy?.defaultBranch ?? safePolicy.defaultBranch;
	const stagingBranch = input.policy?.stagingBranch ?? safePolicy.stagingBranch;
	const bootstrapUnitId = createReconcileUnitId('github-repository-bootstrap', `${input.repository}:${defaultBranch}`);
	const bootstrap: DesiredUnit = {
		...input.repositoryUnit,
		unitId: bootstrapUnitId,
		unitType: 'github-repository-bootstrap',
		logicalName: `${input.repository}:${defaultBranch}`,
		dependencies: [input.repositoryUnit.unitId],
		spec: { repository: input.repository, branch: defaultBranch },
		metadata: { ...input.repositoryUnit.metadata, lifecyclePhase: 'bootstrap' },
	};
	const branch: DesiredUnit = {
		...input.repositoryUnit,
		unitId: createReconcileUnitId('github-branch', `${input.repository}:${stagingBranch}`),
		unitType: 'github-branch',
		logicalName: `${input.repository}:${stagingBranch}`,
		dependencies: [bootstrapUnitId],
		spec: { repository: input.repository, branch: stagingBranch, baseBranch: defaultBranch },
		metadata: { ...input.repositoryUnit.metadata, lifecyclePhase: 'branches' },
	};
	if (input.environment === 'local') return [bootstrap, branch];
	const githubEnvironment = input.environment === 'prod' ? 'production' : input.environment;
	const deploymentBranch = input.environment === 'prod' ? defaultBranch : stagingBranch;
	const rulesUnitId = createReconcileUnitId('github-branch-rules', `${input.repository}:${defaultBranch}`);
	const environmentUnitId = createReconcileUnitId('github-environment', `${input.repository}:${githubEnvironment}`);
	const rulesUnit: DesiredUnit = {
		...input.repositoryUnit,
		unitId: rulesUnitId,
		unitType: 'github-branch-rules',
		logicalName: `${input.repository}:${defaultBranch}:rules`,
		dependencies: [environmentUnitId],
		spec: { repository: input.repository, branch: defaultBranch },
		metadata: { ...input.repositoryUnit.metadata, lifecyclePhase: 'rules-and-environments' },
	};
	const environmentUnit: DesiredUnit = {
		...input.repositoryUnit,
		unitId: environmentUnitId,
		unitType: 'github-environment',
		logicalName: `${input.repository}:${githubEnvironment}`,
		dependencies: [branch.unitId],
		spec: { repository: input.repository, environment: githubEnvironment, branch: deploymentBranch },
		metadata: { ...input.repositoryUnit.metadata, lifecyclePhase: 'rules-and-environments' },
	};
	const workflows = (input.policy ?? safePolicy).workflows ?? [];
	const workflowUnits = workflows.map((workflow): DesiredUnit => ({
		...input.repositoryUnit,
		unitId: createReconcileUnitId('github-workflow-observation', `${input.repository}:${deploymentBranch}:${workflow}`),
		unitType: 'github-workflow-observation',
		logicalName: `${input.repository}:${workflow}`,
		dependencies: [environmentUnitId],
		spec: { repository: input.repository, workflow, ref: deploymentBranch },
		metadata: { ...input.repositoryUnit.metadata, lifecyclePhase: 'workflow-observation' },
	}));
	return [bootstrap, branch, rulesUnit, environmentUnit, ...workflowUnits];
}

export function compileSeedRepositoryUnits(manifest: SeedManifest, environment: SeedEnvironment): DesiredUnit[] {
	const units: DesiredUnit[] = [];
	const projects = new Map(manifest.resources.projects.map((project) => [project.key, project]));
	for (const project of manifest.resources.projects) {
		if (!selected(project, manifest, environment)) continue;
		const repository = `${project.repository.owner}/${project.repository.name}`;
		const repositoryUnit: DesiredUnit = {
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
		};
		units.push(repositoryUnit, ...lifecycleUnits({ repositoryUnit, repository, policy: project.repository.repositoryPolicy, environment }));
	}
	for (const repository of manifest.resources.hubRepositories) {
		if (!selected(repository, manifest, environment)) continue;
		const project = projects.get(repository.project);
		if (!project) continue;
		const slug = `${repository.owner}/${repository.name}`;
		const repositoryUnit: DesiredUnit = {
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
		};
		units.push(repositoryUnit, ...lifecycleUnits({ repositoryUnit, repository: slug, policy: repository.repositoryPolicy, environment }));
	}
	for (const repository of manifest.resources.supportRepositories) {
		if (!selected(repository, manifest, environment)) continue;
		const slug = `${repository.owner}/${repository.name}`;
		const repositoryUnit: DesiredUnit = {
			unitId: createReconcileUnitId('github-repository', slug),
			unitType: 'github-repository',
			provider: 'github',
			identity: identity('team:treeseed', repository.key, repository.name, environment),
			target: targetFor(environment),
			logicalName: slug,
			dependencies: [],
			spec: spec(slug, repository.repositoryPolicy, repository.description, repository.metadata?.visibility === 'public' ? 'public' : 'private'),
			secrets: {},
			metadata: { seed: manifest.name, resourceKey: repository.key, repositoryRole: 'support' },
		};
		units.push(repositoryUnit, ...lifecycleUnits({ repositoryUnit, repository: slug, policy: repository.repositoryPolicy, environment }));
	}
	return units.sort((left, right) => left.unitId.localeCompare(right.unitId));
}
