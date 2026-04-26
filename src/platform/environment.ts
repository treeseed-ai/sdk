import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import type { TreeseedDeployConfig, TreeseedTenantConfig } from './contracts.ts';
import { loadTreeseedDeployConfig } from './deploy-config.ts';
import { loadTreeseedPlugins, type LoadedTreeseedPluginEntry } from './plugins.ts';
import { loadTreeseedManifest } from './tenant-config.ts';

export const TREESEED_ENVIRONMENT_SCOPES = ['local', 'staging', 'prod'] as const;
export const TREESEED_ENVIRONMENT_REQUIREMENTS = ['required', 'conditional', 'optional'] as const;
export const TREESEED_ENVIRONMENT_TARGETS = [
	'local-runtime',
	'local-cloudflare',
	'github-secret',
	'github-variable',
	'cloudflare-secret',
	'cloudflare-var',
	'railway-secret',
	'railway-var',
	'config-file',
] as const;
export const TREESEED_ENVIRONMENT_PURPOSES = ['dev', 'save', 'deploy', 'destroy', 'config'] as const;
export const TREESEED_ENVIRONMENT_SENSITIVITY = ['secret', 'plain', 'derived'] as const;
export const TREESEED_ENVIRONMENT_STORAGE = ['scoped', 'shared'] as const;
export const TREESEED_CONFIG_STARTUP_PROFILES = ['core', 'optional', 'advanced'] as const;

export type TreeseedEnvironmentScope = (typeof TREESEED_ENVIRONMENT_SCOPES)[number];
export type TreeseedEnvironmentRequirement = (typeof TREESEED_ENVIRONMENT_REQUIREMENTS)[number];
export type TreeseedEnvironmentTarget = (typeof TREESEED_ENVIRONMENT_TARGETS)[number];
export type TreeseedEnvironmentPurpose = (typeof TREESEED_ENVIRONMENT_PURPOSES)[number];
export type TreeseedEnvironmentSensitivity = (typeof TREESEED_ENVIRONMENT_SENSITIVITY)[number];
export type TreeseedEnvironmentStorage = (typeof TREESEED_ENVIRONMENT_STORAGE)[number];
export type TreeseedConfigStartupProfile = (typeof TREESEED_CONFIG_STARTUP_PROFILES)[number];

export type TreeseedEnvironmentValidation =
	| { kind: 'string' | 'nonempty' | 'url' | 'email'; minLength?: number }
	| { kind: 'boolean' | 'number' }
	| { kind: 'enum'; values: string[] };

export type TreeseedEnvironmentValueResolver =
	| string
	| ((context: TreeseedEnvironmentContext, scope: TreeseedEnvironmentScope, values?: Record<string, string | undefined>) => string | undefined);

export type TreeseedMachineSecretPayload = {
	algorithm: 'aes-256-gcm';
	iv: string;
	tag: string;
	ciphertext: string;
};

export type TreeseedMachineConfig = {
	version: number;
	project: {
		tenantRoot: string;
		tenantId: string;
		slug: string;
		name: string;
		siteUrl: string;
		overlayPath?: string;
	};
	settings: {
		sync: {
			github: boolean;
			cloudflare: boolean;
		};
	};
	shared: {
		values: Record<string, string>;
		secrets: Record<string, TreeseedMachineSecretPayload>;
	};
	environments: Record<
		TreeseedEnvironmentScope,
		{
			values: Record<string, string>;
			secrets: Record<string, TreeseedMachineSecretPayload>;
		}
	>;
};

export type TreeseedEnvironmentContext = {
	deployConfig: TreeseedDeployConfig;
	tenantConfig?: TreeseedTenantConfig;
	plugins: LoadedTreeseedPluginEntry[];
	tenantRoot: string;
};

export type TreeseedEnvironmentEntry = {
	id: string;
	label: string;
	group: string;
	cluster?: string;
	onboardingFeature?: string;
	startupProfile?: TreeseedConfigStartupProfile;
	description: string;
	howToGet: string;
	sensitivity: TreeseedEnvironmentSensitivity;
	targets: TreeseedEnvironmentTarget[];
	scopes: TreeseedEnvironmentScope[];
	requirement: TreeseedEnvironmentRequirement;
	purposes: TreeseedEnvironmentPurpose[];
	storage?: TreeseedEnvironmentStorage;
	validation?: TreeseedEnvironmentValidation;
	sourcePriority?: string[];
	defaultValue?: TreeseedEnvironmentValueResolver;
	localDefaultValue?: TreeseedEnvironmentValueResolver;
	isRelevant?: (context: TreeseedEnvironmentContext, scope: TreeseedEnvironmentScope, purpose?: TreeseedEnvironmentPurpose) => boolean;
	requiredWhen?: (context: TreeseedEnvironmentContext, scope: TreeseedEnvironmentScope, purpose?: TreeseedEnvironmentPurpose) => boolean;
};

export type TreeseedEnvironmentEntryYaml = Omit<
	TreeseedEnvironmentEntry,
	'id' | 'defaultValue' | 'localDefaultValue' | 'isRelevant' | 'requiredWhen'
> & {
	cluster?: string;
	onboardingFeature?: string;
	startupProfile?: TreeseedConfigStartupProfile;
	defaultValueRef?: string;
	localDefaultValueRef?: string;
	relevanceRef?: string;
	requiredWhenRef?: string;
};

export type TreeseedEnvironmentEntryOverride = Partial<
	Omit<TreeseedEnvironmentEntryYaml, 'id'>
> & { id?: string };

export type TreeseedEnvironmentRegistryOverlay = {
	entries?: Record<string, TreeseedEnvironmentEntryOverride>;
};

export type TreeseedResolvedEnvironmentRegistry = {
	context: TreeseedEnvironmentContext;
	entries: TreeseedEnvironmentEntry[];
};

export type TreeseedEnvironmentValidationProblem = {
	id: string;
	label: string;
	reason: 'missing' | 'invalid';
	message: string;
	entry: TreeseedEnvironmentEntry;
};

export type TreeseedEnvironmentValidationResult = {
	ok: boolean;
	entries: TreeseedEnvironmentEntry[];
	required: TreeseedEnvironmentEntry[];
	missing: TreeseedEnvironmentValidationProblem[];
	invalid: TreeseedEnvironmentValidationProblem[];
};

type NamedResolverMap = Record<string, TreeseedEnvironmentValueResolver>;
type NamedPredicateMap = Record<
	string,
	(context: TreeseedEnvironmentContext, scope: TreeseedEnvironmentScope, purpose?: TreeseedEnvironmentPurpose) => boolean
>;

const moduleDir = dirname(fileURLToPath(import.meta.url));
function resolveCoreEnvironmentPath() {
	const candidates = [
		resolve(moduleDir, 'env.yaml'),
		resolve(moduleDir, '../src/platform/env.yaml'),
		resolve(moduleDir, '../dist/platform/env.yaml'),
	];
	return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}
const CORE_ENVIRONMENT_PATH = resolveCoreEnvironmentPath();
const TENANT_ENVIRONMENT_OVERLAY_PATH = 'src/env.yaml';

function loadOptionalTenantConfig() {
	try {
		return loadTreeseedManifest();
	} catch {
		return undefined;
	}
}

function turnstileEnabled(context: TreeseedEnvironmentContext) {
	return context.deployConfig.turnstile?.enabled === true;
}

function smtpEnabled(context: TreeseedEnvironmentContext) {
	return context.deployConfig.smtp?.enabled === true;
}

function platformSurfaceEnabled(context: TreeseedEnvironmentContext, surface: string) {
	return context.deployConfig.surfaces?.[surface]?.enabled !== false;
}

function managedServiceEnabled(context: TreeseedEnvironmentContext, service: string) {
	return context.deployConfig.services?.[service]?.enabled !== false;
}

function webSurfaceEnabled(context: TreeseedEnvironmentContext) {
	return platformSurfaceEnabled(context, 'web');
}

function apiSurfaceEnabled(context: TreeseedEnvironmentContext) {
	return platformSurfaceEnabled(context, 'api') && managedServiceEnabled(context, 'api');
}

function formsEnabled(context: TreeseedEnvironmentContext) {
	return webSurfaceEnabled(context) && (context.deployConfig.providers?.forms ?? 'store_only') !== 'none';
}

function railwayManagedEnabled(context: TreeseedEnvironmentContext) {
	if (context.deployConfig.runtime?.mode === 'treeseed_managed') {
		return true;
	}
	if (context.deployConfig.runtime?.mode && context.deployConfig.runtime.mode !== 'treeseed_managed') {
		return false;
	}
	return Object.values(context.deployConfig.services ?? {}).some((service) =>
		service && service.enabled !== false && (service.provider ?? 'railway') === 'railway',
	);
}

function resolveHubMode(context: TreeseedEnvironmentContext) {
	return context.deployConfig.hub?.mode ?? 'treeseed_hosted';
}

function resolveRuntimeMode(context: TreeseedEnvironmentContext) {
	return context.deployConfig.runtime?.mode ?? 'none';
}

function resolveRuntimeRegistration(context: TreeseedEnvironmentContext) {
	return context.deployConfig.runtime?.registration ?? 'none';
}

function resolveHostingKind(context: TreeseedEnvironmentContext) {
	return context.deployConfig.hosting?.kind ?? 'self_hosted_project';
}

function resolveHostingRegistration(context: TreeseedEnvironmentContext) {
	return context.deployConfig.hosting?.registration ?? 'none';
}

function marketControlPlaneEnabled(context: TreeseedEnvironmentContext) {
	return resolveHostingKind(context) === 'market_control_plane';
}

function hostedProjectEnabled(context: TreeseedEnvironmentContext) {
	return resolveHostingKind(context) === 'hosted_project';
}

function selfHostedProjectEnabled(context: TreeseedEnvironmentContext) {
	return resolveHostingKind(context) === 'self_hosted_project';
}

function projectRegistrationEnabled(context: TreeseedEnvironmentContext) {
	return resolveRuntimeRegistration(context) === 'optional' || resolveRuntimeRegistration(context) === 'required';
}

function generatedSecret(bytes = 24) {
	return randomBytes(bytes).toString('hex');
}

function localTimezoneDefault() {
	return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function localMailpitHostDefault() {
	return '127.0.0.1';
}

function localMailpitPortDefault() {
	return '1025';
}

function contactEmailDefault(context: TreeseedEnvironmentContext) {
	return context.deployConfig.contactEmail?.trim() || 'contact@example.com';
}

function workdayWindowsDefault() {
	return JSON.stringify([{ days: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '17:00' }]);
}

function normalizeUrl(value: string) {
	return value.trim().replace(/\/$/u, '');
}

function primaryHostFromUrl(value: string | undefined) {
	if (!value || value.trim().length === 0) {
		return undefined;
	}

	try {
		return new URL(value).host;
	} catch {
		return undefined;
	}
}

function parseDomainList(value: string | undefined) {
	return String(value ?? '')
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean);
}

function deriveApiDomainFromProjectDomain(domain: string | undefined) {
	if (!domain) {
		return undefined;
	}
	if (domain.startsWith('api.')) {
		return domain;
	}

	const segments = domain.split('.').filter(Boolean);
	if (segments.length <= 2) {
		return `api.${domain}`;
	}
	return `api.${segments.slice(1).join('.')}`;
}

function resolveConfiguredApiBaseUrl(
	context: TreeseedEnvironmentContext,
	scope: TreeseedEnvironmentScope,
	values: Record<string, string | undefined> = {},
) {
	const localBaseUrl = context.deployConfig.services?.api?.environments?.local?.baseUrl
		?? context.deployConfig.surfaces?.api?.localBaseUrl
		?? 'http://127.0.0.1:3000';
	if (scope === 'local') {
		return normalizeUrl(localBaseUrl);
	}

	const scopedBaseUrl = context.deployConfig.services?.api?.environments?.[scope]?.baseUrl
		?? context.deployConfig.services?.api?.publicBaseUrl
		?? context.deployConfig.surfaces?.api?.publicBaseUrl;
	if (scopedBaseUrl) {
		return normalizeUrl(scopedBaseUrl);
	}

	const projectDomains = [
		...parseDomainList(values.TREESEED_PROJECT_DOMAINS),
		primaryHostFromUrl(context.deployConfig.siteUrl),
	].filter(Boolean) as string[];

	for (const domain of projectDomains) {
		const apiDomain = deriveApiDomainFromProjectDomain(domain);
		if (apiDomain) {
			return `https://${apiDomain}`;
		}
	}

	return undefined;
}

function resolveWebServiceId(
	_values: Record<string, string | undefined> = {},
) {
	return 'web';
}

function resolveApiWebServiceId(
	values: Record<string, string | undefined> = {},
) {
	return values.TREESEED_WEB_SERVICE_ID?.trim() || 'web';
}

function resolvePagesProjectName(context: TreeseedEnvironmentContext) {
	return context.deployConfig.slug;
}

function resolvePagesPreviewProjectName(
	context: TreeseedEnvironmentContext,
	_scope: TreeseedEnvironmentScope,
	values: Record<string, string | undefined> = {},
) {
	return values.TREESEED_CLOUDFLARE_PAGES_PROJECT_NAME?.trim()
		|| `${context.deployConfig.slug}-staging`;
}

function resolveContentBucketName(context: TreeseedEnvironmentContext) {
	return `${context.deployConfig.slug}-content`;
}

function resolveContentBucketBinding(context: TreeseedEnvironmentContext) {
	return context.deployConfig.cloudflare.r2?.binding?.trim() || 'TREESEED_CONTENT_BUCKET';
}

function resolveMarketBaseUrl(
	context: TreeseedEnvironmentContext,
	_scope: TreeseedEnvironmentScope,
	values: Record<string, string | undefined> = {},
) {
	return values.TREESEED_API_BASE_URL?.trim()
		|| context.deployConfig.services?.api?.environments?.prod?.baseUrl?.trim()
		|| 'https://api.treeseed.ai';
}

function resolveHostedTeamId(context: TreeseedEnvironmentContext) {
	return context.deployConfig.slug;
}

function resolveHostedProjectId(context: TreeseedEnvironmentContext) {
	return context.deployConfig.slug;
}

function resolveRailwayWorkspaceDefault() {
	return 'knowledge-coop';
}

function parseGitHubRepositorySlugFromRemote(remoteUrl: string | undefined) {
	const normalized = String(remoteUrl ?? '').trim();
	const sshMatch = normalized.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/u);
	if (sshMatch) {
		return { owner: sshMatch[1], name: sshMatch[2] };
	}

	const httpsMatch = normalized.match(/^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/u);
	if (httpsMatch) {
		return { owner: httpsMatch[1], name: httpsMatch[2] };
	}

	return null;
}

function resolveGitHubOriginRepository(context: TreeseedEnvironmentContext) {
	const result = spawnSync('git', ['remote', 'get-url', 'origin'], {
		cwd: context.tenantRoot,
		stdio: 'pipe',
		encoding: 'utf8',
	});
	if (result.status !== 0) {
		return null;
	}
	return parseGitHubRepositorySlugFromRemote(result.stdout);
}

function resolveGitHubOwnerDefault(context: TreeseedEnvironmentContext) {
	return resolveGitHubOriginRepository(context)?.owner;
}

function resolveGitHubRepositoryNameDefault(context: TreeseedEnvironmentContext) {
	return resolveGitHubOriginRepository(context)?.name || context.deployConfig.slug;
}

const VALUE_RESOLVERS: NamedResolverMap = {
	generatedSecret: () => generatedSecret(),
	localFormsBypassDefault: () => 'true',
	localMailpitHostDefault: () => localMailpitHostDefault(),
	localMailpitPortDefault: () => localMailpitPortDefault(),
	contactEmailDefault: (context) => contactEmailDefault(context),
	projectDomainsDefault: (context) => primaryHostFromUrl(context.deployConfig.siteUrl),
	apiBaseUrlDefault: (context, scope, values) => resolveConfiguredApiBaseUrl(context, scope, values),
	webServiceIdDefault: (_context, _scope, values) => resolveWebServiceId(values),
	apiWebServiceIdDefault: (_context, _scope, values) => resolveApiWebServiceId(values),
	pagesProjectNameDefault: (context) => resolvePagesProjectName(context),
	pagesPreviewProjectNameDefault: (context) => resolvePagesPreviewProjectName(context),
	contentBucketNameDefault: (context) => resolveContentBucketName(context),
	contentBucketBindingDefault: (context) => resolveContentBucketBinding(context),
	hostingKindDefault: (context) => resolveHostingKind(context),
	hostingRegistrationDefault: (context) => resolveHostingRegistration(context),
	hubModeDefault: (context) => resolveHubMode(context),
	runtimeModeDefault: (context) => resolveRuntimeMode(context),
	runtimeRegistrationDefault: (context) => resolveRuntimeRegistration(context),
	marketBaseUrlDefault: (context) => resolveMarketBaseUrl(context),
	hostingTeamIdDefault: (context) => resolveHostedTeamId(context),
	hostingProjectIdDefault: (context) => resolveHostedProjectId(context),
	railwayWorkspaceDefault: () => resolveRailwayWorkspaceDefault(),
	githubOwnerDefault: (context) => resolveGitHubOwnerDefault(context),
	githubRepositoryNameDefault: (context) => resolveGitHubRepositoryNameDefault(context),
	githubRepositoryVisibilityDefault: () => 'private',
	agentPoolMinWorkersDefault: () => '0',
	agentPoolMaxWorkersDefault: () => '2',
	agentPoolTargetQueueDepthDefault: () => '1',
	agentPoolCooldownSecondsDefault: () => '60',
	workdayTimezoneDefault: () => localTimezoneDefault(),
	workdayWindowsDefault: () => workdayWindowsDefault(),
	workdayTaskCreditBudgetDefault: () => '20',
	managerMaxQueuedTasksDefault: () => '5',
	managerMaxQueuedCreditsDefault: () => '20',
	managerPriorityModelsDefault: () => 'objective,question,note,page,book,knowledge',
	taskCreditWeightsDefault: () => '[]',
	workerPoolScalerDefault: (context) => railwayManagedEnabled(context) ? 'railway' : 'noop',
};

const PREDICATES: NamedPredicateMap = {
	turnstileEnabled: (context) => turnstileEnabled(context),
	turnstileNonLocal: (context, scope) => turnstileEnabled(context) && scope !== 'local',
	smtpEnabled: (context) => smtpEnabled(context),
	smtpNonLocal: (context, scope) => smtpEnabled(context) && scope !== 'local',
	webSurfaceEnabled: (context) => webSurfaceEnabled(context),
	apiSurfaceEnabled: (context) => apiSurfaceEnabled(context),
	formsEnabled: (context) => formsEnabled(context),
	railwayManagedEnabled: (context) => railwayManagedEnabled(context),
	hubTreeseedHosted: (context) => resolveHubMode(context) === 'treeseed_hosted',
	hubCustomerHosted: (context) => resolveHubMode(context) === 'customer_hosted',
	runtimeNone: (context) => resolveRuntimeMode(context) === 'none',
	runtimeByoAttached: (context) => resolveRuntimeMode(context) === 'byo_attached',
	runtimeTreeseedManaged: (context) => resolveRuntimeMode(context) === 'treeseed_managed',
	marketControlPlaneEnabled: (context) => marketControlPlaneEnabled(context),
	hostedProjectEnabled: (context) => hostedProjectEnabled(context),
	selfHostedProjectEnabled: (context) => selfHostedProjectEnabled(context),
	projectRegistrationEnabled: (context) => projectRegistrationEnabled(context),
};

function deepMerge(left: unknown, right: unknown): unknown {
	if (Array.isArray(left) && Array.isArray(right)) {
		return [...right];
	}
	if (
		left
		&& typeof left === 'object'
		&& !Array.isArray(left)
		&& right
		&& typeof right === 'object'
		&& !Array.isArray(right)
	) {
		const result = { ...(left as Record<string, unknown>) };
		for (const [key, value] of Object.entries(right as Record<string, unknown>)) {
			result[key] = key in result ? deepMerge(result[key], value) : value;
		}
		return result;
	}
	return right;
}

function normalizeOverlay(raw: unknown, label: string): TreeseedEnvironmentRegistryOverlay {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		throw new Error(`Invalid Treeseed environment registry overlay from ${label}.`);
	}

	const overlay = raw as TreeseedEnvironmentRegistryOverlay;
	if (overlay.entries === undefined) {
		return { entries: {} };
	}
	if (!overlay.entries || typeof overlay.entries !== 'object' || Array.isArray(overlay.entries)) {
		throw new Error(`Invalid Treeseed environment registry overlay entries in ${label}.`);
	}

	return overlay;
}

function readYamlOverlayIfPresent(filePath: string) {
	if (!existsSync(filePath)) {
		return null;
	}
	return normalizeOverlay(parseYaml(readFileSync(filePath, 'utf8')), filePath);
}

function pluginEnvironmentCandidates(baseDir: string) {
	const dir = resolve(baseDir);
	return [
		resolve(dir, 'env.yaml'),
		resolve(dir, 'src/env.yaml'),
		resolve(dir, '../env.yaml'),
		resolve(dir, '../src/env.yaml'),
		resolve(dir, '../../env.yaml'),
		resolve(dir, '../../src/env.yaml'),
	];
}

function readPluginEnvironmentOverlay(baseDir: string) {
	for (const candidate of pluginEnvironmentCandidates(baseDir)) {
		const overlay = readYamlOverlayIfPresent(candidate);
		if (overlay) {
			return { path: candidate, overlay };
		}
	}
	return null;
}

export function loadTreeseedEnvironmentOverlay(tenantRoot: string) {
	const overlayPath = resolve(tenantRoot, TENANT_ENVIRONMENT_OVERLAY_PATH);
	return {
		path: overlayPath,
		overlay: readYamlOverlayIfPresent(overlayPath) ?? ({ entries: {} } satisfies TreeseedEnvironmentRegistryOverlay),
	};
}

function resolveNamedValueResolver(ref: string | undefined) {
	if (!ref) return undefined;
	const resolver = VALUE_RESOLVERS[ref];
	if (!resolver) {
		throw new Error(`Unknown Treeseed environment value resolver "${ref}".`);
	}
	return resolver;
}

function resolveNamedPredicate(ref: string | undefined) {
	if (!ref) return undefined;
	const predicate = PREDICATES[ref];
	if (!predicate) {
		throw new Error(`Unknown Treeseed environment predicate "${ref}".`);
	}
	return predicate;
}

function materializeEntry(id: string, entry: TreeseedEnvironmentEntryYaml): TreeseedEnvironmentEntry {
	return {
		...entry,
		id,
		cluster: entry.cluster ?? `${entry.group}:${id}`,
		onboardingFeature: entry.onboardingFeature,
		startupProfile: entry.startupProfile
			?? (entry.onboardingFeature ? 'optional' : (
				entry.group === 'auth'
				|| entry.id === 'TREESEED_FORM_TOKEN_SECRET'
				|| entry.group === 'local-development'
					? 'core'
					: 'advanced'
			)),
		storage: entry.storage ?? 'scoped',
		defaultValue: resolveNamedValueResolver(entry.defaultValueRef),
		localDefaultValue: resolveNamedValueResolver(entry.localDefaultValueRef),
		isRelevant: resolveNamedPredicate(entry.relevanceRef),
		requiredWhen: resolveNamedPredicate(entry.requiredWhenRef),
	};
}

function mergeEntryYaml(
	baseEntry: TreeseedEnvironmentEntryYaml | undefined,
	id: string,
	override: TreeseedEnvironmentEntryOverride,
) {
	const merged = (baseEntry ? deepMerge(baseEntry, override) : override) as TreeseedEnvironmentEntryYaml;

	if (
		typeof merged.label !== 'string'
		|| typeof merged.group !== 'string'
		|| (merged.cluster !== undefined && typeof merged.cluster !== 'string')
		|| (merged.onboardingFeature !== undefined && typeof merged.onboardingFeature !== 'string')
		|| (merged.startupProfile !== undefined && !TREESEED_CONFIG_STARTUP_PROFILES.includes(merged.startupProfile))
		|| typeof merged.description !== 'string'
		|| typeof merged.howToGet !== 'string'
		|| !Array.isArray(merged.targets)
		|| !Array.isArray(merged.scopes)
		|| typeof merged.requirement !== 'string'
		|| !Array.isArray(merged.purposes)
		|| typeof merged.sensitivity !== 'string'
	) {
		throw new Error(`Treeseed environment registry entry "${id}" is missing required metadata after merge.`);
	}

	return merged;
}

function collectOverlaySources(context: TreeseedEnvironmentContext) {
	const sources: Array<{ label: string; overlay: TreeseedEnvironmentRegistryOverlay }> = [];

	const coreOverlay = readYamlOverlayIfPresent(CORE_ENVIRONMENT_PATH);
	if (!coreOverlay) {
		throw new Error(`Treeseed core environment registry file was not found at ${CORE_ENVIRONMENT_PATH}.`);
	}
	sources.push({ label: CORE_ENVIRONMENT_PATH, overlay: coreOverlay });

	for (const pluginEntry of context.plugins) {
		const fileOverlay = readPluginEnvironmentOverlay(pluginEntry.baseDir);
		if (fileOverlay) {
			sources.push({ label: fileOverlay.path, overlay: fileOverlay.overlay });
		}

		const overlaySource = pluginEntry.plugin.environmentRegistry;
		if (!overlaySource) {
			continue;
		}

		const pluginContext = {
			projectRoot: context.tenantRoot,
			tenantConfig: context.tenantConfig,
			deployConfig: context.deployConfig,
			pluginConfig: pluginEntry.config,
		};
		const overlay = typeof overlaySource === 'function' ? overlaySource(pluginContext) : overlaySource;
		if (overlay) {
			sources.push({
				label: `plugin ${pluginEntry.package}`,
				overlay: normalizeOverlay(overlay, `plugin ${pluginEntry.package}`),
			});
		}
	}

	const tenantOverlay = loadTreeseedEnvironmentOverlay(context.tenantRoot);
	sources.push({ label: tenantOverlay.path, overlay: tenantOverlay.overlay });
	return sources;
}

export function resolveTreeseedEnvironmentContext(options: {
	deployConfig?: TreeseedDeployConfig;
	tenantConfig?: TreeseedTenantConfig;
	plugins?: LoadedTreeseedPluginEntry[];
} = {}): TreeseedEnvironmentContext {
	const deployConfig = options.deployConfig ?? loadTreeseedDeployConfig();
	const tenantConfig = options.tenantConfig ?? loadOptionalTenantConfig();
	const plugins = options.plugins ?? loadTreeseedPlugins(deployConfig);
	const tenantRoot =
		(deployConfig as TreeseedDeployConfig & { __tenantRoot?: string }).__tenantRoot
		?? (tenantConfig as TreeseedTenantConfig & { __tenantRoot?: string } | undefined)?.__tenantRoot
		?? process.cwd();

	return {
		deployConfig,
		tenantConfig,
		plugins,
		tenantRoot,
	};
}

export function resolveTreeseedEnvironmentRegistry(options: {
	deployConfig?: TreeseedDeployConfig;
	tenantConfig?: TreeseedTenantConfig;
	plugins?: LoadedTreeseedPluginEntry[];
} = {}): TreeseedResolvedEnvironmentRegistry {
	const context = resolveTreeseedEnvironmentContext(options);
	const entriesById = new Map<string, TreeseedEnvironmentEntryYaml>();
	const order: string[] = [];

	for (const source of collectOverlaySources(context)) {
		for (const [id, override] of Object.entries(source.overlay.entries ?? {})) {
			const current = entriesById.get(id);
			entriesById.set(id, mergeEntryYaml(current, id, override ?? {}));
			if (!current) {
				order.push(id);
			}
		}
	}

	return {
		context,
		entries: order.map((id) => materializeEntry(id, entriesById.get(id)!)),
	};
}

export function isTreeseedEnvironmentEntryRelevant(
	entry: TreeseedEnvironmentEntry,
	context: TreeseedEnvironmentContext,
	scope: TreeseedEnvironmentScope,
	purpose?: TreeseedEnvironmentPurpose,
) {
	if (!entry.scopes.includes(scope)) {
		return false;
	}
	if (purpose && !entry.purposes.includes(purpose)) {
		return false;
	}
	if (entry.isRelevant) {
		return entry.isRelevant(context, scope, purpose);
	}
	return true;
}

function isEntryRequired(
	entry: TreeseedEnvironmentEntry,
	context: TreeseedEnvironmentContext,
	scope: TreeseedEnvironmentScope,
	purpose?: TreeseedEnvironmentPurpose,
) {
	if (entry.requirement === 'required') {
		return true;
	}
	if (entry.requirement === 'conditional') {
		return entry.requiredWhen ? entry.requiredWhen(context, scope, purpose) : true;
	}
	return false;
}

function materializeDefaultValue(
	entry: TreeseedEnvironmentEntry,
	context: TreeseedEnvironmentContext,
	scope: TreeseedEnvironmentScope,
	values: Record<string, string | undefined> = {},
) {
	const source = scope === 'local' && entry.localDefaultValue !== undefined ? entry.localDefaultValue : entry.defaultValue;
	if (source === undefined) {
		return undefined;
	}
	return typeof source === 'function' ? source(context, scope, values) : source;
}

export function getTreeseedEnvironmentSuggestedValues(options: {
	scope: TreeseedEnvironmentScope;
	purpose?: TreeseedEnvironmentPurpose;
	deployConfig?: TreeseedDeployConfig;
	tenantConfig?: TreeseedTenantConfig;
	plugins?: LoadedTreeseedPluginEntry[];
	values?: Record<string, string | undefined>;
}) {
	const registry = resolveTreeseedEnvironmentRegistry(options);
	const suggestedValues: Record<string, string> = {};
	const seedValues = { ...(options.values ?? {}) };

	for (const entry of registry.entries.filter((candidate) =>
		isTreeseedEnvironmentEntryRelevant(candidate, registry.context, options.scope, options.purpose),
	)) {
		const value = materializeDefaultValue(entry, registry.context, options.scope, { ...suggestedValues, ...seedValues });
		if (value === undefined) {
			continue;
		}
		suggestedValues[entry.id] = value;
	}

	return suggestedValues;
}

export function isTreeseedEnvironmentEntryRequired(
	entry: TreeseedEnvironmentEntry,
	context: TreeseedEnvironmentContext,
	scope: TreeseedEnvironmentScope,
	purpose?: TreeseedEnvironmentPurpose,
) {
	return isEntryRequired(entry, context, scope, purpose);
}

function valuePresent(value: unknown) {
	return typeof value === 'string' && value.trim().length > 0;
}

function validateValue(entry: TreeseedEnvironmentEntry, value: string) {
	if (!entry.validation) {
		return null;
	}

	switch (entry.validation.kind) {
		case 'string':
		case 'nonempty': {
			if (!valuePresent(value)) {
				return `${entry.id} must be a non-empty string.`;
			}
			if (
				typeof entry.validation.minLength === 'number'
				&& value.trim().length < entry.validation.minLength
			) {
				return `${entry.id} must be at least ${entry.validation.minLength} characters.`;
			}
			return null;
		}
		case 'boolean':
			return /^(true|false|1|0)$/i.test(value) ? null : `${entry.id} must be true or false.`;
		case 'number':
			return Number.isFinite(Number(value)) ? null : `${entry.id} must be a number.`;
		case 'url':
			try {
				new URL(value);
				return null;
			} catch {
				return `${entry.id} must be a valid URL.`;
			}
		case 'email':
			return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? null : `${entry.id} must be a valid email address.`;
		case 'enum':
			return entry.validation.values.includes(value)
				? null
				: `${entry.id} must be one of: ${entry.validation.values.join(', ')}.`;
		default:
			return null;
	}
}

export function validateTreeseedEnvironmentValues(options: {
	values: Record<string, string | undefined>;
	scope: TreeseedEnvironmentScope;
	purpose: TreeseedEnvironmentPurpose;
	deployConfig?: TreeseedDeployConfig;
	tenantConfig?: TreeseedTenantConfig;
	plugins?: LoadedTreeseedPluginEntry[];
}): TreeseedEnvironmentValidationResult {
	const registry = resolveTreeseedEnvironmentRegistry(options);
	const relevantEntries = registry.entries.filter((entry) =>
		isTreeseedEnvironmentEntryRelevant(entry, registry.context, options.scope, options.purpose),
	);
	const requiredEntries = relevantEntries.filter((entry) =>
		isEntryRequired(entry, registry.context, options.scope, options.purpose),
	);
	const missing: TreeseedEnvironmentValidationProblem[] = [];
	const invalid: TreeseedEnvironmentValidationProblem[] = [];

	for (const entry of requiredEntries) {
		const value = options.values[entry.id];
		if (!valuePresent(value)) {
			missing.push({
				id: entry.id,
				label: entry.label,
				reason: 'missing',
				message: `${entry.id} is required for ${options.purpose} (${options.scope}). ${entry.howToGet}`,
				entry,
			});
			continue;
		}

		const validationMessage = validateValue(entry, value);
		if (validationMessage) {
			invalid.push({
				id: entry.id,
				label: entry.label,
				reason: 'invalid',
				message: validationMessage,
				entry,
			});
		}
	}

	return {
		ok: missing.length === 0 && invalid.length === 0,
		entries: relevantEntries,
		required: requiredEntries,
		missing,
		invalid,
	};
}
