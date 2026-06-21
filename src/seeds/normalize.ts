import type {
	NormalizedSeedResource,
	SeedCapacityLaneResource,
	SeedCapacityProviderResource,
	SeedEnvironment,
	SeedManifest,
	SeedResourceBase,
} from './types.js';

function declaredEnvironments(resource: SeedResourceBase, manifest: SeedManifest) {
	return resource.environments && resource.environments.length > 0 ? resource.environments : manifest.environments;
}

function selectedEnvironments(resource: SeedResourceBase, manifest: SeedManifest, selected: SeedEnvironment[]) {
	return declaredEnvironments(resource, manifest).filter((environment) => selected.includes(environment));
}

function ownership(seed: SeedManifest, resourceKey: string) {
	return {
		seed: {
			name: seed.name,
			resourceKey,
			version: seed.version,
		},
	};
}

export function seedOwnershipMetadata(seed: SeedManifest, resourceKey: string) {
	return ownership(seed, resourceKey);
}

function withMetadata(seed: SeedManifest, resourceKey: string, metadata: Record<string, unknown> | undefined) {
	return {
		...(metadata ?? {}),
		...ownership(seed, resourceKey),
	};
}

function providerLaneEnvironments(provider: SeedCapacityProviderResource, lane: SeedCapacityLaneResource, manifest: SeedManifest) {
	const providerEnvironments = declaredEnvironments(provider, manifest);
	const laneEnvironments = lane.environments && lane.environments.length > 0 ? lane.environments : providerEnvironments;
	return laneEnvironments.filter((environment) => providerEnvironments.includes(environment));
}

export function normalizeSeedResources(manifest: SeedManifest, selected: SeedEnvironment[]): NormalizedSeedResource[] {
	const resources: NormalizedSeedResource[] = [];

	for (const team of manifest.resources.teams) {
		resources.push({
			kind: 'team',
			key: team.key,
			label: team.displayName ?? team.name ?? team.slug,
			environments: selectedEnvironments(team, manifest, selected),
			payload: {
				slug: team.slug,
				name: team.name ?? team.slug,
				displayName: team.displayName ?? team.name ?? team.slug,
				logoUrl: team.logoUrl ?? null,
				profileSummary: team.profileSummary ?? null,
				metadata: withMetadata(manifest, team.key, team.metadata),
			},
		});
	}

	for (const host of manifest.resources.repositoryHosts) {
		resources.push({
			kind: 'repositoryHost',
			key: host.key,
			label: `${host.provider}/${host.name}`,
			environments: selectedEnvironments(host, manifest, selected),
			payload: {
				teamKey: host.team,
				provider: host.provider,
				name: host.name,
				ownership: host.ownership ?? 'treeseed_managed',
				accountLabel: host.accountLabel ?? null,
				organizationOrOwner: host.organizationOrOwner,
				defaultVisibility: host.defaultVisibility ?? 'private',
				softwareRepositoryNameTemplate: host.softwareRepositoryNameTemplate ?? null,
				contentRepositoryNameTemplate: host.contentRepositoryNameTemplate ?? null,
				branchPolicy: host.branchPolicy ?? null,
				workflowPolicy: host.workflowPolicy ?? null,
				allowedProjectKinds: host.allowedProjectKinds ?? null,
				status: host.status ?? 'active',
				credentialRef: host.credentialRef ?? null,
				metadata: withMetadata(manifest, host.key, host.metadata),
			},
		});
	}

	for (const project of manifest.resources.projects) {
		resources.push({
			kind: 'project',
			key: project.key,
			label: `${project.team.replace(/^team:/u, '')}/${project.slug}`,
			environments: selectedEnvironments(project, manifest, selected),
			payload: {
				teamKey: project.team,
				slug: project.slug,
				name: project.name,
				description: project.description ?? null,
				kind: project.kind ?? null,
				repository: project.repository,
				architecture: project.architecture,
				metadata: withMetadata(manifest, project.key, project.metadata),
			},
		});
	}

	for (const repository of manifest.resources.hubRepositories) {
		resources.push({
			kind: 'hubRepository',
			key: repository.key,
			label: `${repository.project.replace(/^project:/u, '')}/${repository.role}`,
			environments: selectedEnvironments(repository, manifest, selected),
			payload: {
				projectKey: repository.project,
				repositoryHostKey: repository.repositoryHost ?? null,
				role: repository.role,
				provider: repository.provider,
				owner: repository.owner,
				name: repository.name,
				gitUrl: repository.gitUrl,
				defaultBranch: repository.defaultBranch ?? null,
				currentBranch: repository.currentBranch ?? repository.defaultBranch ?? null,
				submodulePath: repository.submodulePath ?? null,
				status: repository.status ?? 'active',
				accessPolicy: repository.accessPolicy ?? null,
				releasePolicy: repository.releasePolicy ?? null,
				publishPolicy: repository.publishPolicy ?? null,
				metadata: withMetadata(manifest, repository.key, repository.metadata),
			},
		});
	}

	for (const provider of manifest.resources.capacityProviders) {
		resources.push({
			kind: 'capacityProvider',
			key: provider.key,
			label: provider.name,
			environments: selectedEnvironments(provider, manifest, selected),
			payload: {
				teamKey: provider.team,
				name: provider.name,
				kind: provider.kind ?? null,
				provider: provider.provider,
				billingScope: provider.billingScope ?? null,
					creditBudgetMode: provider.creditBudgetMode ?? 'derived',
				monthlyCreditBudget: provider.monthlyCreditBudget ?? null,
				dailyCreditBudget: provider.dailyCreditBudget ?? null,
				maxConcurrentWorkdays: provider.maxConcurrentWorkdays ?? null,
				maxConcurrentWorkers: provider.maxConcurrentWorkers ?? null,
				capacityModel: provider.capacityModel ?? null,
				registration: provider.registration ?? null,
				executionProviders: provider.executionProviders ?? [],
				metadata: withMetadata(manifest, provider.key, provider.metadata),
			},
		});
		for (const lane of provider.lanes ?? []) {
			resources.push({
				kind: 'capacityLane',
				key: lane.key,
				label: lane.name,
				parentKey: provider.key,
				environments: providerLaneEnvironments(provider, lane, manifest).filter((environment) => selected.includes(environment)),
				payload: {
					providerKey: provider.key,
					name: lane.name,
					businessModel: lane.businessModel ?? null,
					modelFamily: lane.modelFamily ?? null,
					modelClass: lane.modelClass ?? null,
					regionPolicy: lane.regionPolicy ?? null,
					unit: lane.unit ?? null,
					scarcityLevel: lane.scarcityLevel ?? null,
					hardLimits: lane.hardLimits ?? null,
					routingPolicy: lane.routingPolicy ?? null,
					metadata: withMetadata(manifest, lane.key, lane.metadata),
				},
			});
		}
	}

	for (const grant of manifest.resources.capacityGrants) {
		resources.push({
			kind: 'capacityGrant',
			key: grant.key,
			label: `${grant.provider.replace(/^capacity-provider:/u, '')} -> ${grant.project?.replace(/^project:/u, '') ?? grant.team.replace(/^team:/u, '')}`,
			environments: selectedEnvironments(grant, manifest, selected),
			payload: {
				providerKey: grant.provider,
				laneKey: grant.lane ?? null,
				teamKey: grant.team,
				projectKey: grant.project ?? null,
				environment: grant.environment ?? null,
				grantScope: grant.grantScope ?? null,
				dailyCreditLimit: grant.dailyCreditLimit ?? null,
				weeklyCreditLimit: grant.weeklyCreditLimit ?? null,
				monthlyCreditLimit: grant.monthlyCreditLimit ?? null,
				dailyUsdLimit: grant.dailyUsdLimit ?? null,
				weeklyQuotaMinutes: grant.weeklyQuotaMinutes ?? null,
				monthlyProviderUnits: grant.monthlyProviderUnits ?? null,
				portfolioAllocationPercent: grant.portfolioAllocationPercent ?? null,
				reservePoolPercent: grant.reservePoolPercent ?? null,
				maxDailyProjectCredits: grant.maxDailyProjectCredits ?? null,
				emergencyOverride: grant.emergencyOverride ?? null,
				priorityWeight: grant.priorityWeight ?? null,
				overflowPolicy: grant.overflowPolicy ?? null,
				state: grant.state ?? null,
				metadata: withMetadata(manifest, grant.key, grant.metadata),
			},
		});
	}

	for (const policy of manifest.resources.workPolicies) {
		resources.push({
			kind: 'workPolicy',
			key: policy.key,
			label: `${policy.project.replace(/^project:[^/]+\//u, '')}/${policy.environment}`,
			environments: selectedEnvironments(policy, manifest, selected),
			payload: {
				projectKey: policy.project,
				environment: policy.environment,
				enabled: policy.enabled ?? true,
				startCron: policy.startCron ?? '0 9 * * 1-5',
				durationMinutes: policy.durationMinutes ?? 480,
				maxRunners: policy.maxRunners ?? 1,
				maxWorkersPerRunner: policy.maxWorkersPerRunner ?? 4,
				dailyCreditBudget: policy.dailyCreditBudget ?? null,
				maxQueuedTasks: policy.maxQueuedTasks ?? null,
				maxQueuedCredits: policy.maxQueuedCredits ?? null,
				autoscale: policy.autoscale ?? null,
				creditWeights: policy.creditWeights ?? null,
				metadata: withMetadata(manifest, policy.key, policy.metadata),
			},
		});
	}

	for (const product of manifest.resources.products) {
		resources.push({
			kind: 'product',
			key: product.key,
			label: `${product.kind}/${product.slug}`,
			environments: selectedEnvironments(product, manifest, selected),
			payload: {
				teamKey: product.team,
				kind: product.kind,
				slug: product.slug,
				title: product.title,
				summary: product.summary ?? null,
				visibility: product.visibility ?? 'private',
				listingEnabled: product.listingEnabled ?? false,
				offerMode: product.offerMode ?? 'private',
				manifestKey: product.manifestKey ?? null,
				artifactKey: product.artifactKey ?? null,
				searchText: product.searchText ?? null,
				metadata: withMetadata(manifest, product.key, product.metadata),
			},
		});
	}

	for (const artifact of manifest.resources.catalogArtifacts) {
		resources.push({
			kind: 'catalogArtifact',
			key: artifact.key,
			label: `${artifact.product.replace(/^product:/u, '')}@${artifact.version}`,
			environments: selectedEnvironments(artifact, manifest, selected),
			payload: {
				productKey: artifact.product,
				version: artifact.version,
				kind: artifact.kind,
				contentKey: artifact.contentKey,
				manifestKey: artifact.manifestKey ?? null,
				publishedAt: artifact.publishedAt ?? null,
				metadata: withMetadata(manifest, artifact.key, artifact.metadata),
			},
		});
	}

	return resources;
}

export function resolveSelectedSeedEnvironments(manifest: SeedManifest, requested: string | undefined): { environments: SeedEnvironment[]; errors: string[] } {
	const errors: string[] = [];
	const raw = requested
		? requested.split(',').map((entry) => entry.trim()).filter(Boolean)
		: (manifest.defaultEnvironments && manifest.defaultEnvironments.length > 0 ? manifest.defaultEnvironments : ['local']);
	const environments: SeedEnvironment[] = [];
	for (const environment of raw) {
		if (!['local', 'staging', 'prod'].includes(environment)) {
			errors.push(`Unknown seed environment: ${environment}.`);
			continue;
		}
		if (!manifest.environments.includes(environment as SeedEnvironment)) {
			errors.push(`Seed ${manifest.name} does not declare environment: ${environment}.`);
			continue;
		}
		if (!environments.includes(environment as SeedEnvironment)) {
			environments.push(environment as SeedEnvironment);
		}
	}
	if (environments.length === 0 && errors.length === 0) {
		errors.push('No seed environments selected.');
	}
	return { environments, errors };
}
