import { errorDiagnostic, warningDiagnostic } from './errors.js';
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
} from './types.js';

const RESOURCE_BUCKETS = [
	'teams',
	'repositoryHosts',
	'projects',
	'hubRepositories',
	'products',
	'catalogArtifacts',
] as const;

const SUPPORTED_BUCKETS = new Set(['teams', 'repositoryHosts', 'projects', 'hubRepositories', 'products', 'catalogArtifacts']);
const ALLOWED_ENVIRONMENTS = new Set<string>(SEED_ENVIRONMENTS);
const ALLOWED_PROJECT_TOPOLOGIES = new Set<string>(SEED_PROJECT_TOPOLOGIES);
const ALLOWED_CONTENT_RUNTIME_SOURCES = new Set<string>(SEED_CONTENT_RUNTIME_SOURCES);
const ALLOWED_LOCAL_CONTENT_MATERIALIZATIONS = new Set<string>(SEED_LOCAL_CONTENT_MATERIALIZATIONS);
const ALLOWED_CONTENT_PUBLISH_TARGETS = new Set<string>(SEED_CONTENT_PUBLISH_TARGETS);
const ALLOWED_RECIPE_CHANNELS = new Set<string>(['cli', 'ui', 'api', 'provider-runtime', 'system-check']);
const ALLOWED_RECIPE_OPERATIONS = new Set<string>([
	'navigate',
	'seed.apply',
	'seed.plan',
	'verify.treedx',
	'project.create',
	'work.start',
	'work.review-decision',
	'knowledge.inspect-artifacts',
	'knowledge.publish',
	'system.health',
]);
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

function nonNegativeNumberField(record: Record<string, unknown>, field: string, path: string, diagnostics: SeedDiagnostic[]) {
	const value = numberField(record, field, path, diagnostics);
	if (value !== undefined && value < 0) {
		diagnostics.push(errorDiagnostic('seed.invalid_number', `Expected ${field} to be non-negative.`, `${path}.${field}`));
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

function booleanField(record: Record<string, unknown>, field: string, path: string, diagnostics: SeedDiagnostic[]) {
	const value = record[field];
	if (value === undefined) return undefined;
	if (typeof value !== 'boolean') {
		diagnostics.push(errorDiagnostic('seed.invalid_boolean', `Expected ${field} to be a boolean.`, `${path}.${field}`));
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

function recordArrayField<T extends Record<string, unknown>>(record: Record<string, unknown>, field: string, path: string, diagnostics: SeedDiagnostic[]): T[] {
	const value = record[field];
	if (value === undefined) return [];
	if (!Array.isArray(value)) {
		diagnostics.push(errorDiagnostic('seed.invalid_array', `Expected ${field} to be an array.`, `${path}.${field}`));
		return [];
	}
	const result: T[] = [];
	value.forEach((entry, index) => {
		if (!isRecord(entry)) {
			diagnostics.push(errorDiagnostic('seed.invalid_object', `Expected ${field} entry to be an object.`, `${path}.${field}[${index}]`));
			return;
		}
		result.push(entry as T);
	});
	return result;
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

function parseProjectContentPublishTarget(value: unknown, path: string, diagnostics: SeedDiagnostic[]): SeedProjectContentPublishTarget | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value)) {
		diagnostics.push(errorDiagnostic('seed.invalid_project_architecture', 'Expected contentPublishTarget to be an object.', path));
		return undefined;
	}
	const kind = requireString(value, 'kind', path, diagnostics);
	if (kind && !ALLOWED_CONTENT_PUBLISH_TARGETS.has(kind)) {
		diagnostics.push(errorDiagnostic('seed.invalid_project_architecture', `Unsupported content publish target: ${kind}.`, `${path}.kind`));
	}
	return {
		kind: ALLOWED_CONTENT_PUBLISH_TARGETS.has(kind) ? kind as SeedContentPublishTargetKind : 'none',
		bucket: asString(value.bucket) || undefined,
		prefix: asString(value.prefix) || undefined,
		manifestPath: asString(value.manifestPath) || undefined,
		metadata: objectField(value, 'metadata', path, diagnostics),
	};
}

function parseProjectArchitecture(value: unknown, path: string, diagnostics: SeedDiagnostic[]): SeedProjectArchitecture | null {
	if (!isRecord(value)) {
		diagnostics.push(errorDiagnostic('seed.missing_project_architecture', 'Project resources must declare canonical architecture.', path));
		return null;
	}
	const topology = requireString(value, 'topology', path, diagnostics);
	const contentRuntimeSource = requireString(value, 'contentRuntimeSource', path, diagnostics);
	const localContentMaterialization = requireString(value, 'localContentMaterialization', path, diagnostics);
	if (topology && !ALLOWED_PROJECT_TOPOLOGIES.has(topology)) {
		diagnostics.push(errorDiagnostic('seed.invalid_project_architecture', `Unsupported project topology: ${topology}.`, `${path}.topology`));
	}
	if (contentRuntimeSource && !ALLOWED_CONTENT_RUNTIME_SOURCES.has(contentRuntimeSource)) {
		diagnostics.push(errorDiagnostic('seed.invalid_project_architecture', `Unsupported content runtime source: ${contentRuntimeSource}.`, `${path}.contentRuntimeSource`));
	}
	if (localContentMaterialization && !ALLOWED_LOCAL_CONTENT_MATERIALIZATIONS.has(localContentMaterialization)) {
		diagnostics.push(errorDiagnostic('seed.invalid_project_architecture', `Unsupported local content materialization: ${localContentMaterialization}.`, `${path}.localContentMaterialization`));
	}
	const architecture: SeedProjectArchitecture = {
		topology: ALLOWED_PROJECT_TOPOLOGIES.has(topology) ? topology as SeedProjectTopology : 'single_repository_site',
		rootPath: asString(value.rootPath) || '.',
		sitePath: requireString(value, 'sitePath', path, diagnostics),
		contentPath: asString(value.contentPath) || undefined,
		contentRuntimeSource: ALLOWED_CONTENT_RUNTIME_SOURCES.has(contentRuntimeSource) ? contentRuntimeSource as SeedContentRuntimeSource : 'r2_published_manifest',
		localContentMaterialization: ALLOWED_LOCAL_CONTENT_MATERIALIZATIONS.has(localContentMaterialization) ? localContentMaterialization as SeedLocalContentMaterialization : 'none',
		contentPublishTarget: parseProjectContentPublishTarget(value.contentPublishTarget, `${path}.contentPublishTarget`, diagnostics),
		requiresLocalContentForCi: booleanField(value, 'requiresLocalContentForCi', path, diagnostics),
		requiresLocalContentForDeploy: booleanField(value, 'requiresLocalContentForDeploy', path, diagnostics),
	};
	validateProjectArchitecture(architecture, path, diagnostics);
	return architecture;
}

function validateProjectArchitecture(architecture: SeedProjectArchitecture, path: string, diagnostics: SeedDiagnostic[]) {
	if (!architecture.sitePath) return;
	if (architecture.topology === 'single_repository_site' && architecture.rootPath === '' && architecture.sitePath === '') {
		diagnostics.push(errorDiagnostic('seed.invalid_project_architecture', 'single_repository_site projects must have repository-relative rootPath and sitePath values.', path));
	}
	if (architecture.topology === 'split_site_content' && !architecture.contentPath && architecture.contentRuntimeSource === 'local_directory') {
		diagnostics.push(errorDiagnostic('seed.invalid_project_architecture', 'split_site_content projects using local_directory content must declare contentPath.', `${path}.contentPath`));
	}
	if (
		!architecture.requiresLocalContentForCi
		&& !architecture.requiresLocalContentForDeploy
		&& architecture.contentRuntimeSource !== 'local_directory'
		&& ['managed_clone', 'submodule'].includes(architecture.localContentMaterialization)
	) {
		diagnostics.push(errorDiagnostic(
			'seed.local_content_required_by_default',
			'CI/deploy defaults must not require managed_clone or submodule content unless requiresLocalContentForCi or requiresLocalContentForDeploy is explicit.',
			`${path}.localContentMaterialization`,
		));
	}
	if (architecture.contentPublishTarget?.kind === 'cloudflare_r2' && architecture.contentRuntimeSource === 'local_directory' && !architecture.contentPath) {
		diagnostics.push(errorDiagnostic('seed.invalid_project_architecture', 'Cloudflare R2 content publish targets need a contentPath when runtime source is local_directory.', `${path}.contentPath`));
	}
}

function parseProject(value: unknown, path: string, diagnostics: SeedDiagnostic[]): SeedProjectResource | null {
	if (!isRecord(value)) {
		diagnostics.push(errorDiagnostic('seed.invalid_resource', 'Expected project resource to be an object.', path));
		return null;
	}
	const metadata = objectField(value, 'metadata', path, diagnostics);
	if (metadata?.repositoryTopology !== undefined || metadata?.contentRoot !== undefined || metadata?.sitePath !== undefined || metadata?.contentPath !== undefined) {
		diagnostics.push(errorDiagnostic(
			'seed.legacy_project_topology_metadata',
			'Project topology must be declared in project.architecture, not metadata.',
			`${path}.metadata`,
		));
	}
	return {
		...keyBase(value, path, diagnostics),
		team: requireString(value, 'team', path, diagnostics),
		slug: requireString(value, 'slug', path, diagnostics),
		name: requireString(value, 'name', path, diagnostics),
		description: asString(value.description) || undefined,
		kind: asString(value.kind) || undefined,
		repository: parseRepository(value.repository, `${path}.repository`, diagnostics),
		architecture: parseProjectArchitecture(value.architecture, `${path}.architecture`, diagnostics) ?? {
			topology: 'single_repository_site',
			rootPath: '.',
			sitePath: '',
			contentRuntimeSource: 'r2_published_manifest',
			localContentMaterialization: 'none',
		},
		metadata,
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
function parseRecipeCommand(value: unknown, path: string, diagnostics: SeedDiagnostic[]): SeedOperationRecipeCommand | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value)) {
		diagnostics.push(errorDiagnostic('seed.invalid_object', 'Expected command to be an object.', path));
		return undefined;
	}
	const argv = stringArrayField(value, 'argv', path, diagnostics);
	if (argv.length === 0) {
		diagnostics.push(errorDiagnostic('seed.recipe_command_missing_argv', 'Recipe command must include argv.', `${path}.argv`));
	}
	return { argv };
}

function parseRecipeStep(value: unknown, path: string, diagnostics: SeedDiagnostic[]): SeedOperationRecipeStep | null {
	if (!isRecord(value)) {
		diagnostics.push(errorDiagnostic('seed.invalid_recipe_step', 'Expected operation recipe step to be an object.', path));
		return null;
	}
	const channel = requireString(value, 'channel', path, diagnostics);
	if (channel && !ALLOWED_RECIPE_CHANNELS.has(channel)) {
		diagnostics.push(errorDiagnostic('seed.recipe_unknown_channel', `Unsupported operation recipe channel: ${channel}.`, `${path}.channel`));
	}
	const operation = requireString(value, 'operation', path, diagnostics);
	if (operation && !ALLOWED_RECIPE_OPERATIONS.has(operation)) {
		diagnostics.push(errorDiagnostic('seed.recipe_unknown_operation', `Unsupported operation recipe operation: ${operation}.`, `${path}.operation`));
	}
	return {
		id: requireString(value, 'id', path, diagnostics),
		title: requireString(value, 'title', path, diagnostics),
		actor: asString(value.actor) || undefined,
		channel: ALLOWED_RECIPE_CHANNELS.has(channel) ? channel as SeedOperationRecipeChannel : 'system-check',
		operation,
		dependsOn: stringArrayField(value, 'dependsOn', path, diagnostics) ?? [],
		uses: stringArrayField(value, 'uses', path, diagnostics) ?? [],
		target: asString(value.target) || undefined,
		command: parseRecipeCommand(value.command, `${path}.command`, diagnostics),
		assertions: recordArrayField<SeedOperationRecipeAssertion>(value, 'assertions', path, diagnostics),
		artifacts: recordArrayField<SeedOperationRecipeArtifact>(value, 'artifacts', path, diagnostics),
	};
}

function parseOperationRecipe(value: unknown, path: string, diagnostics: SeedDiagnostic[], manifestEnvironments: SeedEnvironment[]): SeedOperationRecipe | null {
	if (!isRecord(value)) {
		diagnostics.push(errorDiagnostic('seed.invalid_recipe', 'Expected operation recipe to be an object.', path));
		return null;
	}
	const environments = parseEnvironments(value.environments, `${path}.environments`, diagnostics) ?? manifestEnvironments;
	const recipe: SeedOperationRecipe = {
		id: requireString(value, 'id', path, diagnostics),
		title: requireString(value, 'title', path, diagnostics),
		environments,
		entrypoints: stringArrayField(value, 'entrypoints', path, diagnostics) ?? [],
		steps: Array.isArray(value.steps)
			? value.steps.map((step, index) => parseRecipeStep(step, `${path}.steps[${index}]`, diagnostics)).filter((step): step is SeedOperationRecipeStep => Boolean(step))
			: [],
	};
	if (!Array.isArray(value.steps)) {
		diagnostics.push(errorDiagnostic('seed.invalid_recipe_steps', 'Operation recipe steps must be an array.', `${path}.steps`));
	}
	return recipe;
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
}

function validateReferences(manifest: SeedManifest, diagnostics: SeedDiagnostic[]) {
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

function allResourceKeys(manifest: SeedManifest) {
	return new Set([
		...manifest.resources.teams.map((team) => team.key),
		...manifest.resources.repositoryHosts.map((host) => host.key),
		...manifest.resources.projects.map((project) => project.key),
		...manifest.resources.hubRepositories.map((repository) => repository.key),
		...manifest.resources.products.map((product) => product.key),
		...manifest.resources.catalogArtifacts.map((artifact) => artifact.key),
	]);
}

function validateOperationRecipes(manifest: SeedManifest, diagnostics: SeedDiagnostic[]) {
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
