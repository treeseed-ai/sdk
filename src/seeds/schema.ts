import { errorDiagnostic, warningDiagnostic } from './errors.js';
import {
	SEED_ENVIRONMENTS,
	type SeedCatalogArtifactResource,
	type SeedCapacityGrantResource,
	type SeedCapacityLaneResource,
	type SeedCapacityProviderResource,
	type SeedDiagnostic,
	type SeedEnvironment,
	type SeedHubRepositoryResource,
	type SeedManifest,
	type SeedManifestResources,
	type SeedProductResource,
	type SeedProjectRepository,
	type SeedProjectResource,
	type SeedRepositoryHostResource,
	type SeedResourceBase,
	type SeedTeamResource,
	type SeedWorkPolicyResource,
} from './types.js';

const RESOURCE_BUCKETS = [
	'teams',
	'repositoryHosts',
	'projects',
	'hubRepositories',
	'products',
	'catalogArtifacts',
	'capacityProviders',
	'capacityGrants',
	'workPolicies',
	'agentPools',
] as const;

const SUPPORTED_BUCKETS = new Set(['teams', 'repositoryHosts', 'projects', 'hubRepositories', 'products', 'catalogArtifacts', 'capacityProviders', 'capacityGrants', 'workPolicies']);
const ALLOWED_ENVIRONMENTS = new Set<string>(SEED_ENVIRONMENTS);
const CREDENTIAL_REF_PATTERN = /^(?:env|secret|provider-session):[A-Za-z0-9_./:-]+$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown) {
	return typeof value === 'string' ? value.trim() : '';
}

function parseEnvironments(value: unknown, path: string, diagnostics: SeedDiagnostic[]): SeedEnvironment[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) {
		diagnostics.push(errorDiagnostic('seed.invalid_environments', 'Expected an array of environments.', path));
		return undefined;
	}
	const result: SeedEnvironment[] = [];
	for (let index = 0; index < value.length; index += 1) {
		const environment = asString(value[index]);
		if (!ALLOWED_ENVIRONMENTS.has(environment)) {
			diagnostics.push(errorDiagnostic('seed.unknown_environment', `Unknown environment: ${environment || String(value[index])}.`, `${path}[${index}]`));
			continue;
		}
		if (!result.includes(environment as SeedEnvironment)) {
			result.push(environment as SeedEnvironment);
		}
	}
	return result;
}

function requireString(record: Record<string, unknown>, field: string, path: string, diagnostics: SeedDiagnostic[]) {
	const value = asString(record[field]);
	if (!value) {
		diagnostics.push(errorDiagnostic('seed.missing_field', `Missing required field: ${field}.`, `${path}.${field}`));
	}
	return value;
}

function numberField(record: Record<string, unknown>, field: string, path: string, diagnostics: SeedDiagnostic[]) {
	const value = record[field];
	if (value === undefined) return undefined;
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		diagnostics.push(errorDiagnostic('seed.invalid_number', `Expected ${field} to be a finite number.`, `${path}.${field}`));
		return undefined;
	}
	return value;
}

function objectField(record: Record<string, unknown>, field: string, path: string, diagnostics: SeedDiagnostic[]) {
	const value = record[field];
	if (value === undefined) return undefined;
	if (!isRecord(value)) {
		diagnostics.push(errorDiagnostic('seed.invalid_object', `Expected ${field} to be an object.`, `${path}.${field}`));
		return undefined;
	}
	return value;
}

function stringArrayField(record: Record<string, unknown>, field: string, path: string, diagnostics: SeedDiagnostic[]) {
	const value = record[field];
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) {
		diagnostics.push(errorDiagnostic('seed.invalid_array', `Expected ${field} to be an array.`, `${path}.${field}`));
		return undefined;
	}
	return value.map((entry) => asString(entry)).filter(Boolean);
}

function keyBase(record: Record<string, unknown>, path: string, diagnostics: SeedDiagnostic[]): SeedResourceBase {
	const key = requireString(record, 'key', path, diagnostics);
	const environments = parseEnvironments(record.environments, `${path}.environments`, diagnostics);
	return { key, ...(environments ? { environments } : {}) };
}

function parseTeam(value: unknown, path: string, diagnostics: SeedDiagnostic[]): SeedTeamResource | null {
	if (!isRecord(value)) {
		diagnostics.push(errorDiagnostic('seed.invalid_resource', 'Expected team resource to be an object.', path));
		return null;
	}
	return {
		...keyBase(value, path, diagnostics),
		slug: requireString(value, 'slug', path, diagnostics),
		name: asString(value.name) || undefined,
		displayName: asString(value.displayName) || undefined,
		logoUrl: asString(value.logoUrl) || undefined,
		profileSummary: asString(value.profileSummary) || undefined,
		metadata: objectField(value, 'metadata', path, diagnostics),
	};
}

function parseRepository(value: unknown, path: string, diagnostics: SeedDiagnostic[]): SeedProjectRepository {
	if (!isRecord(value)) {
		diagnostics.push(errorDiagnostic('seed.invalid_repository', 'Expected repository to be an object.', path));
		return { role: '', provider: '', owner: '', name: '', gitUrl: '' };
	}
	const repository: SeedProjectRepository = {
		role: requireString(value, 'role', path, diagnostics),
		provider: requireString(value, 'provider', path, diagnostics),
		owner: requireString(value, 'owner', path, diagnostics),
		name: requireString(value, 'name', path, diagnostics),
		gitUrl: requireString(value, 'gitUrl', path, diagnostics),
		defaultBranch: asString(value.defaultBranch) || undefined,
		checkoutPath: asString(value.checkoutPath) || undefined,
		submodulePath: asString(value.submodulePath) || undefined,
		webUrl: asString(value.webUrl) || undefined,
	};
	validateRepository(repository, path, diagnostics);
	return repository;
}

function parseProject(value: unknown, path: string, diagnostics: SeedDiagnostic[]): SeedProjectResource | null {
	if (!isRecord(value)) {
		diagnostics.push(errorDiagnostic('seed.invalid_resource', 'Expected project resource to be an object.', path));
		return null;
	}
	return {
		...keyBase(value, path, diagnostics),
		team: requireString(value, 'team', path, diagnostics),
		slug: requireString(value, 'slug', path, diagnostics),
		name: requireString(value, 'name', path, diagnostics),
		description: asString(value.description) || undefined,
		kind: asString(value.kind) || undefined,
		repository: parseRepository(value.repository, `${path}.repository`, diagnostics),
		metadata: objectField(value, 'metadata', path, diagnostics),
	};
}

function parseRepositoryHost(value: unknown, path: string, diagnostics: SeedDiagnostic[]): SeedRepositoryHostResource | null {
	if (!isRecord(value)) {
		diagnostics.push(errorDiagnostic('seed.invalid_resource', 'Expected repository host resource to be an object.', path));
		return null;
	}
	const credentialRef = asString(value.credentialRef) || undefined;
	if (credentialRef && !CREDENTIAL_REF_PATTERN.test(credentialRef)) {
		diagnostics.push(errorDiagnostic('seed.invalid_credential_ref', 'Repository host credentialRef must be env:, secret:, or provider-session:.', `${path}.credentialRef`));
	}
	return {
		...keyBase(value, path, diagnostics),
		team: requireString(value, 'team', path, diagnostics),
		provider: requireString(value, 'provider', path, diagnostics),
		name: requireString(value, 'name', path, diagnostics),
		ownership: asString(value.ownership) || undefined,
		accountLabel: asString(value.accountLabel) || undefined,
		organizationOrOwner: requireString(value, 'organizationOrOwner', path, diagnostics),
		defaultVisibility: asString(value.defaultVisibility) || undefined,
		softwareRepositoryNameTemplate: asString(value.softwareRepositoryNameTemplate) || undefined,
		contentRepositoryNameTemplate: asString(value.contentRepositoryNameTemplate) || undefined,
		branchPolicy: objectField(value, 'branchPolicy', path, diagnostics),
		workflowPolicy: objectField(value, 'workflowPolicy', path, diagnostics),
		allowedProjectKinds: stringArrayField(value, 'allowedProjectKinds', path, diagnostics),
		status: asString(value.status) || undefined,
		credentialRef,
		metadata: objectField(value, 'metadata', path, diagnostics),
	};
}

function parseHubRepository(value: unknown, path: string, diagnostics: SeedDiagnostic[]): SeedHubRepositoryResource | null {
	if (!isRecord(value)) {
		diagnostics.push(errorDiagnostic('seed.invalid_resource', 'Expected hub repository resource to be an object.', path));
		return null;
	}
	const repository: SeedHubRepositoryResource = {
		...keyBase(value, path, diagnostics),
		project: requireString(value, 'project', path, diagnostics),
		role: requireString(value, 'role', path, diagnostics),
		repositoryHost: asString(value.repositoryHost) || undefined,
		provider: requireString(value, 'provider', path, diagnostics),
		owner: requireString(value, 'owner', path, diagnostics),
		name: requireString(value, 'name', path, diagnostics),
		gitUrl: requireString(value, 'gitUrl', path, diagnostics),
		defaultBranch: asString(value.defaultBranch) || undefined,
		currentBranch: asString(value.currentBranch) || undefined,
		submodulePath: asString(value.submodulePath) || undefined,
		status: asString(value.status) || undefined,
		accessPolicy: objectField(value, 'accessPolicy', path, diagnostics),
		releasePolicy: objectField(value, 'releasePolicy', path, diagnostics),
		publishPolicy: objectField(value, 'publishPolicy', path, diagnostics),
		metadata: objectField(value, 'metadata', path, diagnostics),
	};
	validateRepository({
		role: repository.role,
		provider: repository.provider,
		owner: repository.owner,
		name: repository.name,
		gitUrl: repository.gitUrl,
		defaultBranch: repository.defaultBranch,
		submodulePath: repository.submodulePath,
	}, path, diagnostics);
	return repository;
}

function parseProduct(value: unknown, path: string, diagnostics: SeedDiagnostic[]): SeedProductResource | null {
	if (!isRecord(value)) {
		diagnostics.push(errorDiagnostic('seed.invalid_resource', 'Expected product resource to be an object.', path));
		return null;
	}
	return {
		...keyBase(value, path, diagnostics),
		team: requireString(value, 'team', path, diagnostics),
		kind: requireString(value, 'kind', path, diagnostics),
		slug: requireString(value, 'slug', path, diagnostics),
		title: requireString(value, 'title', path, diagnostics),
		summary: asString(value.summary) || undefined,
		visibility: asString(value.visibility) || undefined,
		listingEnabled: typeof value.listingEnabled === 'boolean' ? value.listingEnabled : undefined,
		offerMode: asString(value.offerMode) || undefined,
		manifestKey: asString(value.manifestKey) || undefined,
		artifactKey: asString(value.artifactKey) || undefined,
		searchText: asString(value.searchText) || undefined,
		metadata: objectField(value, 'metadata', path, diagnostics),
	};
}

function parseCatalogArtifact(value: unknown, path: string, diagnostics: SeedDiagnostic[]): SeedCatalogArtifactResource | null {
	if (!isRecord(value)) {
		diagnostics.push(errorDiagnostic('seed.invalid_resource', 'Expected catalog artifact resource to be an object.', path));
		return null;
	}
	if (value.content !== undefined || value.bytes !== undefined || value.data !== undefined) {
		diagnostics.push(errorDiagnostic('seed.inline_artifact_content', 'Catalog artifact resources must reference content keys, not inline bytes/content.', path));
	}
	return {
		...keyBase(value, path, diagnostics),
		product: requireString(value, 'product', path, diagnostics),
		version: requireString(value, 'version', path, diagnostics),
		kind: requireString(value, 'kind', path, diagnostics),
		contentKey: requireString(value, 'contentKey', path, diagnostics),
		manifestKey: asString(value.manifestKey) || undefined,
		publishedAt: asString(value.publishedAt) || undefined,
		metadata: objectField(value, 'metadata', path, diagnostics),
	};
}

function parseLane(value: unknown, path: string, diagnostics: SeedDiagnostic[]): SeedCapacityLaneResource | null {
	if (!isRecord(value)) {
		diagnostics.push(errorDiagnostic('seed.invalid_resource', 'Expected lane resource to be an object.', path));
		return null;
	}
	return {
		...keyBase(value, path, diagnostics),
		name: requireString(value, 'name', path, diagnostics),
		businessModel: asString(value.businessModel) || undefined,
		modelFamily: asString(value.modelFamily) || undefined,
		modelClass: asString(value.modelClass) || undefined,
		regionPolicy: asString(value.regionPolicy) || undefined,
		unit: asString(value.unit) || undefined,
		scarcityLevel: asString(value.scarcityLevel) || undefined,
		hardLimits: objectField(value, 'hardLimits', path, diagnostics),
		routingPolicy: objectField(value, 'routingPolicy', path, diagnostics),
		metadata: objectField(value, 'metadata', path, diagnostics),
	};
}

function parseProviderRegistration(value: unknown, path: string, diagnostics: SeedDiagnostic[]) {
	if (value === undefined) return undefined;
	if (!isRecord(value)) {
		diagnostics.push(errorDiagnostic('seed.invalid_object', 'Expected registration to be an object.', path));
		return undefined;
	}
	const apiKeyValue = value.apiKey;
	if (apiKeyValue === undefined) return {};
	if (!isRecord(apiKeyValue)) {
		diagnostics.push(errorDiagnostic('seed.invalid_object', 'Expected registration.apiKey to be an object.', `${path}.apiKey`));
		return {};
	}
	if (apiKeyValue.createIfMissing !== undefined && typeof apiKeyValue.createIfMissing !== 'boolean') {
		diagnostics.push(errorDiagnostic('seed.invalid_boolean', 'Expected registration.apiKey.createIfMissing to be a boolean.', `${path}.apiKey.createIfMissing`));
	}
	return {
		apiKey: {
			createIfMissing: typeof apiKeyValue.createIfMissing === 'boolean' ? apiKeyValue.createIfMissing : undefined,
			name: asString(apiKeyValue.name) || undefined,
			scopes: stringArrayField(apiKeyValue, 'scopes', `${path}.apiKey`, diagnostics),
			expiresAt: asString(apiKeyValue.expiresAt) || undefined,
		},
	};
}

function parseProvider(value: unknown, path: string, diagnostics: SeedDiagnostic[]): SeedCapacityProviderResource | null {
	if (!isRecord(value)) {
		diagnostics.push(errorDiagnostic('seed.invalid_resource', 'Expected capacity provider resource to be an object.', path));
		return null;
	}
	const lanesValue = value.lanes;
	const lanes = lanesValue === undefined
		? []
		: Array.isArray(lanesValue)
			? lanesValue.map((lane, index) => parseLane(lane, `${path}.lanes[${index}]`, diagnostics)).filter((lane): lane is SeedCapacityLaneResource => Boolean(lane))
			: (diagnostics.push(errorDiagnostic('seed.invalid_lanes', 'Expected lanes to be an array.', `${path}.lanes`)), []);
	return {
		...keyBase(value, path, diagnostics),
		team: requireString(value, 'team', path, diagnostics),
		name: requireString(value, 'name', path, diagnostics),
		kind: asString(value.kind) || undefined,
		provider: requireString(value, 'provider', path, diagnostics),
		billingScope: asString(value.billingScope) || undefined,
		monthlyCreditBudget: numberField(value, 'monthlyCreditBudget', path, diagnostics),
		dailyCreditBudget: numberField(value, 'dailyCreditBudget', path, diagnostics),
		maxConcurrentWorkdays: numberField(value, 'maxConcurrentWorkdays', path, diagnostics),
		maxConcurrentWorkers: numberField(value, 'maxConcurrentWorkers', path, diagnostics),
		capacityModel: objectField(value, 'capacityModel', path, diagnostics),
		registration: parseProviderRegistration(value.registration, `${path}.registration`, diagnostics),
		metadata: objectField(value, 'metadata', path, diagnostics),
		lanes,
	};
}

function parseGrant(value: unknown, path: string, diagnostics: SeedDiagnostic[]): SeedCapacityGrantResource | null {
	if (!isRecord(value)) {
		diagnostics.push(errorDiagnostic('seed.invalid_resource', 'Expected capacity grant resource to be an object.', path));
		return null;
	}
	const environment = asString(value.environment);
	if (environment && !ALLOWED_ENVIRONMENTS.has(environment)) {
		diagnostics.push(errorDiagnostic('seed.unknown_environment', `Unknown grant environment: ${environment}.`, `${path}.environment`));
	}
	return {
		...keyBase(value, path, diagnostics),
		provider: requireString(value, 'provider', path, diagnostics),
		lane: asString(value.lane) || undefined,
		team: requireString(value, 'team', path, diagnostics),
		project: asString(value.project) || undefined,
		environment: environment && ALLOWED_ENVIRONMENTS.has(environment) ? environment as SeedEnvironment : undefined,
		grantScope: asString(value.grantScope) || undefined,
		dailyCreditLimit: numberField(value, 'dailyCreditLimit', path, diagnostics),
		weeklyCreditLimit: numberField(value, 'weeklyCreditLimit', path, diagnostics),
		monthlyCreditLimit: numberField(value, 'monthlyCreditLimit', path, diagnostics),
		dailyUsdLimit: numberField(value, 'dailyUsdLimit', path, diagnostics),
		weeklyQuotaMinutes: numberField(value, 'weeklyQuotaMinutes', path, diagnostics),
		monthlyProviderUnits: numberField(value, 'monthlyProviderUnits', path, diagnostics),
		priorityWeight: numberField(value, 'priorityWeight', path, diagnostics),
		overflowPolicy: asString(value.overflowPolicy) || undefined,
		state: asString(value.state) || undefined,
		metadata: objectField(value, 'metadata', path, diagnostics),
	};
}

function parseWorkPolicy(value: unknown, path: string, diagnostics: SeedDiagnostic[]): SeedWorkPolicyResource | null {
	if (!isRecord(value)) {
		diagnostics.push(errorDiagnostic('seed.invalid_resource', 'Expected work policy resource to be an object.', path));
		return null;
	}
	const environment = requireString(value, 'environment', path, diagnostics);
	if (environment && !ALLOWED_ENVIRONMENTS.has(environment)) {
		diagnostics.push(errorDiagnostic('seed.unknown_environment', `Unknown work policy environment: ${environment}.`, `${path}.environment`));
	}
	return {
		...keyBase(value, path, diagnostics),
		project: requireString(value, 'project', path, diagnostics),
		environment: ALLOWED_ENVIRONMENTS.has(environment) ? environment as SeedEnvironment : 'local',
		enabled: typeof value.enabled === 'boolean' ? value.enabled : undefined,
		startCron: asString(value.startCron) || undefined,
		durationMinutes: numberField(value, 'durationMinutes', path, diagnostics),
		maxRunners: numberField(value, 'maxRunners', path, diagnostics),
		maxWorkersPerRunner: numberField(value, 'maxWorkersPerRunner', path, diagnostics),
		dailyCreditBudget: numberField(value, 'dailyCreditBudget', path, diagnostics),
		maxQueuedTasks: numberField(value, 'maxQueuedTasks', path, diagnostics),
		maxQueuedCredits: numberField(value, 'maxQueuedCredits', path, diagnostics),
		autoscale: objectField(value, 'autoscale', path, diagnostics),
		creditWeights: Array.isArray(value.creditWeights) ? value.creditWeights : undefined,
		metadata: objectField(value, 'metadata', path, diagnostics),
	};
}

function validateRepository(repository: SeedProjectRepository, path: string, diagnostics: SeedDiagnostic[]) {
	if (!repository.gitUrl) return;
	if (/^(?:\.{1,2}\/?|packages\/|\/)/u.test(repository.gitUrl) || !/(?:^[a-z][a-z0-9+.-]*:\/\/|^git@)/iu.test(repository.gitUrl)) {
		diagnostics.push(errorDiagnostic('seed.invalid_git_url', 'Project repository gitUrl must be a remote Git URL, not a local path.', `${path}.gitUrl`));
		return;
	}
	if (repository.provider !== 'github') return;
	const parsed = parseGitHubRepository(repository.gitUrl);
	if (!parsed) {
		diagnostics.push(errorDiagnostic('seed.invalid_git_url', 'GitHub repository gitUrl must identify an owner and repository.', `${path}.gitUrl`));
		return;
	}
	if (parsed.owner !== repository.owner || parsed.name !== repository.name) {
		diagnostics.push(errorDiagnostic(
			'seed.repository_metadata_mismatch',
			`gitUrl points to ${parsed.owner}/${parsed.name}, but owner/name are ${repository.owner}/${repository.name}.`,
			path,
		));
	}
}

function parseGitHubRepository(gitUrl: string): { owner: string; name: string } | null {
	const ssh = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/u.exec(gitUrl);
	if (ssh) return { owner: ssh[1]!, name: ssh[2]! };
	try {
		const url = new URL(gitUrl);
		if (url.hostname !== 'github.com') return null;
		const [owner, rawName] = url.pathname.replace(/^\/+/u, '').split('/');
		if (!owner || !rawName) return null;
		return { owner, name: rawName.replace(/\.git$/u, '') };
	} catch {
		return null;
	}
}

function walkForSecrets(value: unknown, path: string, diagnostics: SeedDiagnostic[]) {
	if (typeof value === 'string') {
		if (/(?:ghp_|github_pat_|sk-[A-Za-z0-9]|xox[baprs]-|-----BEGIN [A-Z ]*PRIVATE KEY-----)/u.test(value)) {
			diagnostics.push(errorDiagnostic('seed.secret_value', 'Manifest appears to contain a raw secret value.', path));
		}
		return;
	}
	if (Array.isArray(value)) {
		value.forEach((entry, index) => walkForSecrets(entry, `${path}[${index}]`, diagnostics));
		return;
	}
	if (!isRecord(value)) return;
	for (const [key, entry] of Object.entries(value)) {
		const nextPath = path ? `${path}.${key}` : key;
		if (typeof entry === 'string' && /(?:api[_-]?key|token|private[_-]?key|password|secret|credential)/iu.test(key)) {
			if (!CREDENTIAL_REF_PATTERN.test(entry)) {
				diagnostics.push(errorDiagnostic('seed.secret_field', `Field ${key} must use a credential reference, not an inline value.`, nextPath));
			}
		}
		walkForSecrets(entry, nextPath, diagnostics);
	}
}

function arrayBucket(resources: Record<string, unknown>, bucket: string, diagnostics: SeedDiagnostic[]) {
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

function validateResourceKeys(manifest: SeedManifest, diagnostics: SeedDiagnostic[]) {
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
	manifest.resources.capacityProviders.forEach((provider, providerIndex) => {
		visit(provider.key, `resources.capacityProviders[${providerIndex}].key`);
		(provider.lanes ?? []).forEach((lane, laneIndex) => visit(lane.key, `resources.capacityProviders[${providerIndex}].lanes[${laneIndex}].key`));
	});
	manifest.resources.capacityGrants.forEach((grant, index) => visit(grant.key, `resources.capacityGrants[${index}].key`));
	manifest.resources.workPolicies.forEach((policy, index) => visit(policy.key, `resources.workPolicies[${index}].key`));
}

function validateReferences(manifest: SeedManifest, diagnostics: SeedDiagnostic[]) {
	const teamKeys = new Set(manifest.resources.teams.map((team) => team.key));
	const projectKeys = new Set(manifest.resources.projects.map((project) => project.key));
	const repositoryHostKeys = new Set(manifest.resources.repositoryHosts.map((host) => host.key));
	const productKeys = new Set(manifest.resources.products.map((product) => product.key));
	const providerKeys = new Set(manifest.resources.capacityProviders.map((provider) => provider.key));
	const laneKeys = new Set(manifest.resources.capacityProviders.flatMap((provider) => (provider.lanes ?? []).map((lane) => lane.key)));

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
	manifest.resources.capacityProviders.forEach((provider, index) => {
		if (!teamKeys.has(provider.team)) diagnostics.push(errorDiagnostic('seed.invalid_reference', `Unknown team reference: ${provider.team}.`, `resources.capacityProviders[${index}].team`));
	});
	manifest.resources.capacityGrants.forEach((grant, index) => {
		if (!teamKeys.has(grant.team)) diagnostics.push(errorDiagnostic('seed.invalid_reference', `Unknown team reference: ${grant.team}.`, `resources.capacityGrants[${index}].team`));
		if (!providerKeys.has(grant.provider)) diagnostics.push(errorDiagnostic('seed.invalid_reference', `Unknown capacity provider reference: ${grant.provider}.`, `resources.capacityGrants[${index}].provider`));
		if (grant.lane && !laneKeys.has(grant.lane)) diagnostics.push(errorDiagnostic('seed.invalid_reference', `Unknown capacity lane reference: ${grant.lane}.`, `resources.capacityGrants[${index}].lane`));
		if (grant.project && !projectKeys.has(grant.project)) diagnostics.push(errorDiagnostic('seed.invalid_reference', `Unknown project reference: ${grant.project}.`, `resources.capacityGrants[${index}].project`));
	});
	manifest.resources.workPolicies.forEach((policy, index) => {
		if (!projectKeys.has(policy.project)) diagnostics.push(errorDiagnostic('seed.invalid_reference', `Unknown project reference: ${policy.project}.`, `resources.workPolicies[${index}].project`));
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
		capacityProviders: arrayBucket(resourcesValue, 'capacityProviders', diagnostics).map((entry, index) => parseProvider(entry, `resources.capacityProviders[${index}]`, diagnostics)).filter((provider): provider is SeedCapacityProviderResource => Boolean(provider)),
		capacityGrants: arrayBucket(resourcesValue, 'capacityGrants', diagnostics).map((entry, index) => parseGrant(entry, `resources.capacityGrants[${index}]`, diagnostics)).filter((grant): grant is SeedCapacityGrantResource => Boolean(grant)),
		workPolicies: arrayBucket(resourcesValue, 'workPolicies', diagnostics).map((entry, index) => parseWorkPolicy(entry, `resources.workPolicies[${index}]`, diagnostics)).filter((policy): policy is SeedWorkPolicyResource => Boolean(policy)),
		agentPools: arrayBucket(resourcesValue, 'agentPools', diagnostics) as Record<string, unknown>[],
	};

	const manifest: SeedManifest = {
		name,
		version: 1,
		description: asString(value.description) || undefined,
		defaultEnvironments,
		environments,
		resources,
	};
	validateResourceKeys(manifest, diagnostics);
	validateReferences(manifest, diagnostics);
	if (diagnostics.length === 0 && manifest.resources.projects.length === 0) {
		diagnostics.push(warningDiagnostic('seed.empty_projects', 'Seed manifest does not define projects.', 'resources.projects'));
	}
	return manifest;
}
