import { readFileSync, existsSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { parse as parseYaml } from 'yaml';

const require = createRequire(import.meta.url);
const scriptRoot = dirname(fileURLToPath(import.meta.url));
function resolveSdkPackageRoot(startDir: string) {
	let currentDir = startDir;
	while (true) {
		const packageJsonPath = resolve(currentDir, 'package.json');
		if (existsSync(packageJsonPath)) {
			try {
				const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
				if (packageJson?.name === '@treeseed/sdk') {
					return currentDir;
				}
			} catch {
				// Ignore unreadable package manifests while walking upward.
			}
		}

		const parentDir = dirname(currentDir);
		if (parentDir === currentDir) {
			return resolve(startDir, '..', '..', '..');
		}
		currentDir = parentDir;
	}
}

const packageRootFromSource = resolveSdkPackageRoot(scriptRoot);
const treeseedRuntimeRoot = resolve(packageRootFromSource, 'src', 'treeseed');
const TREESEED_DEFAULT_PLUGIN_REFERENCES = [
	{
		package: '@treeseed/sdk/plugin-default',
		enabled: true,
	},
];
const TREESEED_DEFAULT_PROVIDER_SELECTIONS = {
	forms: 'store_only',
	agents: {
		execution: 'copilot',
		mutation: 'local_branch',
		repository: 'git',
		verification: 'local',
		notification: 'sdk_message',
		research: 'project_graph',
	},
	deploy: 'cloudflare',
		content: {
			runtime: 'team_scoped_r2_overlay',
			publish: 'team_scoped_r2_overlay',
			docs: 'default',
		},
	site: 'default',
};
const TRESEED_MANAGED_SERVICE_KEYS = ['api', 'manager', 'worker', 'workdayStart', 'workdayReport'];
const TRESEED_WORKSPACE_PACKAGE_DIRS = ['sdk', 'core', 'cli'];
const CLOUDFLARE_ACCOUNT_ID_PLACEHOLDER = 'replace-with-cloudflare-account-id';

function normalizePlanesFromLegacyHosting(hosting) {
	if (!hosting || Object.keys(hosting).length === 0) {
		return {
			hub: { mode: 'treeseed_hosted' },
			runtime: { mode: 'none', registration: 'none' },
		};
	}

	if (hosting.kind === 'market_control_plane' || hosting.kind === 'hosted_project') {
		return {
			hub: { mode: 'treeseed_hosted' },
			runtime: {
				mode: 'treeseed_managed',
				registration: hosting.kind === 'market_control_plane' ? 'none' : (hosting.registration ?? 'none'),
				marketBaseUrl: hosting.marketBaseUrl,
				teamId: hosting.teamId,
				projectId: hosting.projectId,
			},
		};
	}

	return {
		hub: { mode: 'customer_hosted' },
		runtime: {
			mode: 'byo_attached',
			registration: hosting.registration ?? 'none',
			marketBaseUrl: hosting.marketBaseUrl,
			teamId: hosting.teamId,
			projectId: hosting.projectId,
		},
	};
}

function normalizeLegacyHostingFromPlanes(hub, runtime) {
	if (runtime.mode === 'treeseed_managed' && hub.mode === 'treeseed_hosted') {
		return {
			kind: 'hosted_project',
			registration: runtime.registration === 'required' ? 'optional' : (runtime.registration ?? 'none'),
			marketBaseUrl: runtime.marketBaseUrl,
			teamId: runtime.teamId,
			projectId: runtime.projectId,
		};
	}

	return {
		kind: 'self_hosted_project',
		registration: runtime.registration === 'required' ? 'optional' : (runtime.registration ?? 'none'),
		marketBaseUrl: runtime.marketBaseUrl,
		teamId: runtime.teamId,
		projectId: runtime.projectId,
	};
}

function parseServiceEnvironmentConfig(value) {
	const record = optionalRecord(value, 'service environment') ?? {};
	return {
		baseUrl: optionalString(record.baseUrl),
		domain: optionalString(record.domain),
		railwayEnvironment: optionalString(record.railwayEnvironment),
	};
}

function parseManagedServiceConfig(value, label) {
	const record = optionalRecord(value, label);
	if (!record) {
		return undefined;
	}
	const railway = optionalRecord(record.railway, `${label}.railway`) ?? {};
	const cloudflare = optionalRecord(record.cloudflare, `${label}.cloudflare`) ?? {};
	const environments = optionalRecord(record.environments, `${label}.environments`) ?? {};
	return {
		enabled: record.enabled === undefined ? undefined : optionalBoolean(record.enabled, `${label}.enabled`),
		provider: optionalString(record.provider),
		rootDir: optionalString(record.rootDir),
		publicBaseUrl: optionalString(record.publicBaseUrl),
		cloudflare: {
			workerName: optionalString(cloudflare.workerName),
		},
		railway: {
			projectId: optionalString(railway.projectId),
			projectName: optionalString(railway.projectName),
			serviceId: optionalString(railway.serviceId),
			serviceName: optionalString(railway.serviceName),
			rootDir: optionalString(railway.rootDir),
			buildCommand: optionalString(railway.buildCommand),
			startCommand: optionalString(railway.startCommand),
			schedule: Array.isArray(railway.schedule)
				? railway.schedule.map((entry) => optionalString(entry)).filter(Boolean)
				: optionalString(railway.schedule),
		},
		environments: {
			local: parseServiceEnvironmentConfig(environments.local),
			staging: parseServiceEnvironmentConfig(environments.staging),
			prod: parseServiceEnvironmentConfig(environments.prod),
		},
	};
}

function parseManagedServicesConfig(value) {
	const record = optionalRecord(value, 'services');
	if (!record) {
		return undefined;
	}
	return Object.fromEntries(
		TRESEED_MANAGED_SERVICE_KEYS.map((serviceKey) => [
			serviceKey,
			parseManagedServiceConfig(record[serviceKey], `services.${serviceKey}`),
		]),
	);
}

function parseWebSurfaceCacheConfig(value, label) {
	const record = optionalRecord(value, label) ?? {};
	if (Object.keys(record).length === 0) {
		return undefined;
	}

	return {
		sourcePages: parseWebCachePolicyRecord(record.sourcePages ?? record.source_pages, `${label}.sourcePages`, {
			paths: ['/', '/contact', '/404'],
		}),
		contentPages: parseWebCachePolicyRecord(record.contentPages ?? record.content_pages, `${label}.contentPages`),
		r2PublishedObjects: parseWebCachePolicyRecord(
			record.r2PublishedObjects ?? record.r2_published_objects,
			`${label}.r2PublishedObjects`,
		),
	};
}

function parseWebCachePolicyRecord(value, label, options = {}) {
	const record = optionalRecord(value, label) ?? {};
	if (Object.keys(record).length === 0) {
		return options.paths ? { paths: [...options.paths] } : undefined;
	}

	const parsed = {
		browserTtlSeconds: optionalNonNegativeNumber(
			record.browserTtlSeconds ?? record.browser_ttl_seconds,
			`${label}.browserTtlSeconds`,
		),
		edgeTtlSeconds: optionalNonNegativeNumber(
			record.edgeTtlSeconds ?? record.edge_ttl_seconds,
			`${label}.edgeTtlSeconds`,
		),
		staleWhileRevalidateSeconds: optionalNonNegativeNumber(
			record.staleWhileRevalidateSeconds ?? record.stale_while_revalidate_seconds,
			`${label}.staleWhileRevalidateSeconds`,
		),
		staleIfErrorSeconds: optionalNonNegativeNumber(
			record.staleIfErrorSeconds ?? record.stale_if_error_seconds,
			`${label}.staleIfErrorSeconds`,
		),
	};

	if (options.paths) {
		parsed.paths = [...new Set((Array.isArray(record.paths) ? record.paths.map((entry) => optionalString(entry)).filter(Boolean) : options.paths))];
	}

	return parsed;
}

function parseSurfaceConfig(value, label) {
	const record = optionalRecord(value, label);
	if (!record) {
		return undefined;
	}

	return {
		enabled: record.enabled === undefined ? undefined : optionalBoolean(record.enabled, `${label}.enabled`),
		provider: optionalString(record.provider),
		rootDir: optionalString(record.rootDir),
		publicBaseUrl: optionalString(record.publicBaseUrl),
		localBaseUrl: optionalString(record.localBaseUrl),
		cache: parseWebSurfaceCacheConfig(record.cache, `${label}.cache`),
	};
}

function parsePlatformSurfacesConfig(value) {
	const record = optionalRecord(value, 'surfaces');
	if (!record) {
		return undefined;
	}

	return Object.fromEntries(
		Object.entries(record).map(([surfaceKey, surfaceValue]) => [
			surfaceKey,
			parseSurfaceConfig(surfaceValue, `surfaces.${surfaceKey}`),
		]),
	);
}

function inferManagedRuntimeFromServices(services) {
	return Object.values(services ?? {}).some((service) =>
		service && service.enabled !== false && (service.provider ?? 'railway') === 'railway',
	);
}

export const packageRoot = packageRootFromSource;
export const packageScriptRoot = resolve(packageRoot, 'scripts');
export const packageDistScriptRoot = resolve(packageRoot, 'dist', 'scripts');
export const runtimeRoot = treeseedRuntimeRoot;

function resolvePackageBinary(packageName, binName = packageName) {
	const packageJsonPath = require.resolve(`${packageName}/package.json`);
	const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
	const binField = packageJson.bin;
	const relativePath = typeof binField === 'string' ? binField : binField?.[binName];

	if (!relativePath) {
		throw new Error(`Unable to resolve binary "${binName}" from package "${packageName}".`);
	}

	return resolve(dirname(packageJsonPath), relativePath);
}

export function treeseedWorkspacePackageCheckoutState(root = resolve(packageRoot, '..')) {
	const packages = TRESEED_WORKSPACE_PACKAGE_DIRS.map((dirName) => {
		const dir = resolve(root, dirName);
		return {
			dirName,
			dir,
			present: existsSync(resolve(dir, 'package.json')),
		};
	});
	const present = packages.filter((entry) => entry.present);
	return {
		mode: present.length === 0
			? 'registry'
			: present.length === packages.length
				? 'workspace'
				: 'partial',
		packages,
		missing: packages.filter((entry) => !entry.present),
	};
}

function assertUsableTreeseedPackageCheckout(fallbackDirName?: string) {
	if (!fallbackDirName) {
		return;
	}
	const state = treeseedWorkspacePackageCheckoutState();
	const rootHasTreeseedSubmodules = existsSync(resolve(packageRoot, '..', '..', '.gitmodules'));
	if (state.mode !== 'partial' || !rootHasTreeseedSubmodules) {
		return;
	}
	const missing = state.missing.map((entry) => `packages/${entry.dirName}`).join(', ');
	throw new Error(
		`Partial Treeseed package checkout detected. Missing package manifests: ${missing}. `
		+ 'Run `git submodule update --init --recursive` to use workspace mode, or remove the partial checkout to use registry mode.',
	);
}

function resolveTreeseedPackageRoot(packageName, exportPath?: string, fallbackDirName?: string) {
	assertUsableTreeseedPackageCheckout(fallbackDirName);
	if (fallbackDirName) {
		const localRoot = resolve(packageRoot, '..', fallbackDirName);
		if (existsSync(resolve(localRoot, 'package.json'))) {
			return localRoot;
		}
	}

	try {
		const resolvedEntry = require.resolve(exportPath ?? packageName);
		if ((exportPath ?? packageName).endsWith('/package.json')) {
			return dirname(resolvedEntry);
		}
		return resolve(dirname(resolvedEntry), '..');
	} catch {
		if (!fallbackDirName) {
			throw new Error(`Unable to resolve package root for "${packageName}".`);
		}
		return resolve(packageRoot, '..', fallbackDirName);
	}
}

export function resolveAstroBin() {
	return resolvePackageBinary('astro', 'astro');
}

export function resolveWranglerBin() {
	return resolvePackageBinary('wrangler', 'wrangler');
}
export const corePackageRoot = resolveTreeseedPackageRoot('@treeseed/core', '@treeseed/core/config', 'core');
export const sdkPackageRoot = resolveTreeseedPackageRoot('@treeseed/sdk', '@treeseed/sdk', 'sdk');

export function loadPackageJson(root = process.cwd()) {
	const packageJsonPath = resolve(root, 'package.json');
	if (!existsSync(packageJsonPath)) {
		return null;
	}
	return JSON.parse(readFileSync(packageJsonPath, 'utf8'));
}

export function isWorkspaceRoot(root = process.cwd()) {
	const packageJson = loadPackageJson(root);
	const workspaces = Array.isArray(packageJson?.workspaces)
		? packageJson.workspaces
		: Array.isArray(packageJson?.workspaces?.packages)
			? packageJson.workspaces.packages
			: [];
	return workspaces.length > 0;
}

export function createProductionBuildEnv(extraEnv = {}) {
	return {
		TREESEED_LOCAL_DEV_MODE: 'cloudflare',
		TREESEED_PUBLIC_FORMS_LOCAL_BYPASS_TURNSTILE: '',
		TREESEED_FORMS_LOCAL_BYPASS_TURNSTILE: '',
		TREESEED_FORMS_LOCAL_BYPASS_CLOUDFLARE_GUARDS: '',
		TREESEED_PUBLIC_DEV_WATCH_RELOAD: '',
		...extraEnv,
	};
}

export function packageScriptPath(scriptName) {
	if (extname(scriptName)) {
		const directScriptPath = resolve(packageScriptRoot, scriptName);
		if (existsSync(directScriptPath)) {
			return directScriptPath;
		}

		const distScriptPath = resolve(packageDistScriptRoot, scriptName.replace(/\.(ts|mjs)$/u, '.js'));
		if (existsSync(distScriptPath)) {
			return distScriptPath;
		}

		return directScriptPath;
	}

	for (const extension of ['.js', '.ts', '.mjs']) {
		const candidate = resolve(packageScriptRoot, `${scriptName}${extension}`);
		if (existsSync(candidate)) {
			return candidate;
		}
	}

	for (const extension of ['.js', '.mjs']) {
		const candidate = resolve(packageDistScriptRoot, `${scriptName}${extension}`);
		if (existsSync(candidate)) {
			return candidate;
		}
	}

	throw new Error(`Unable to resolve package script "${scriptName}".`);
}

export function withProcessCwd(cwd, action) {
	const previous = process.cwd();
	if (previous === cwd) {
		return action();
	}

	process.chdir(cwd);
	try {
		return action();
	} finally {
		process.chdir(previous);
	}
}

function expectString(value, label) {
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new Error(`Invalid deploy config: expected ${label} to be a non-empty string.`);
	}
	return value.trim();
}

function optionalString(value) {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function optionalCloudflareAccountId(value) {
	const accountId = optionalString(value);
	return accountId === CLOUDFLARE_ACCOUNT_ID_PLACEHOLDER ? undefined : accountId;
}

function optionalBoolean(value, label) {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== 'boolean') {
		throw new Error(`Invalid deploy config: expected ${label} to be a boolean when provided.`);
	}
	return value;
}

function optionalPositiveNumber(value, label) {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
		throw new Error(`Invalid deploy config: expected ${label} to be a positive number when provided.`);
	}
	return value;
}

function optionalNonNegativeNumber(value, label) {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		throw new Error(`Invalid deploy config: expected ${label} to be a non-negative number when provided.`);
	}
	return value;
}

function optionalEnum(value, label, allowed) {
	const normalized = optionalString(value);
	if (!normalized) {
		return undefined;
	}
	if (!allowed.includes(normalized)) {
		throw new Error(`Invalid deploy config: expected ${label} to be one of ${allowed.join(', ')}.`);
	}
	return normalized;
}

function optionalRecord(value, label) {
	if (value === undefined || value === null) {
		return undefined;
	}
	if (typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`Invalid deploy config: expected ${label} to be an object when provided.`);
	}
	return value;
}

function parsePluginReferences(value) {
	if (value === undefined) {
		return [...TREESEED_DEFAULT_PLUGIN_REFERENCES];
	}
	if (!Array.isArray(value)) {
		throw new Error('Invalid deploy config: expected plugins to be an array.');
	}
	return value.map((entry, index) => {
		const record = optionalRecord(entry, `plugins[${index}]`) ?? {};
		return {
			package: expectString(record.package, `plugins[${index}].package`),
			enabled: record.enabled === undefined ? true : optionalBoolean(record.enabled, `plugins[${index}].enabled`),
			config: record.config === undefined ? {} : optionalRecord(record.config, `plugins[${index}].config`),
		};
	});
}

function parseFallbackDeployConfig(configPath) {
	const parsed = (parseYaml(readFileSync(configPath, 'utf8')) ?? {});
	const record = optionalRecord(parsed, 'root') ?? {};
	const cloudflare = optionalRecord(record.cloudflare, 'cloudflare') ?? {};
	const cloudflarePages = optionalRecord(cloudflare.pages, 'cloudflare.pages') ?? {};
	const cloudflareR2 = optionalRecord(cloudflare.r2, 'cloudflare.r2') ?? {};
	const hosting = optionalRecord(record.hosting, 'hosting') ?? {};
	const parsedHosting = Object.keys(hosting).length === 0
			? undefined
			: {
				kind: optionalEnum(hosting.kind, 'hosting.kind', [
					'market_control_plane',
					'hosted_project',
					'self_hosted_project',
				]) ?? 'self_hosted_project',
				registration: optionalEnum(hosting.registration, 'hosting.registration', ['optional', 'none']) ?? 'none',
				marketBaseUrl: optionalString(process.env.TREESEED_MARKET_API_BASE_URL),
				teamId: optionalString(process.env.TREESEED_HOSTING_TEAM_ID),
				projectId: optionalString(process.env.TREESEED_PROJECT_ID),
			};
	const services = parseManagedServicesConfig(record.services);
	const normalizedPlanes = normalizePlanesFromLegacyHosting(parsedHosting);
	const inferredPlanes = !parsedHosting && record.hub === undefined && record.runtime === undefined && inferManagedRuntimeFromServices(services)
		? {
			hub: { mode: 'customer_hosted' },
			runtime: { mode: 'treeseed_managed', registration: 'none' },
		}
		: normalizedPlanes;
	const hubRecord = optionalRecord(record.hub, 'hub') ?? {};
	const runtimeRecord = optionalRecord(record.runtime, 'runtime') ?? {};
	const hub = {
		mode: optionalEnum(hubRecord.mode, 'hub.mode', ['treeseed_hosted', 'customer_hosted']) ?? inferredPlanes.hub.mode,
	};
	const runtime = {
		mode: optionalEnum(runtimeRecord.mode, 'runtime.mode', ['none', 'byo_attached', 'treeseed_managed']) ?? inferredPlanes.runtime.mode,
		registration: optionalEnum(runtimeRecord.registration, 'runtime.registration', ['optional', 'required', 'none'])
			?? inferredPlanes.runtime.registration
			?? 'none',
		marketBaseUrl: optionalString(process.env.TREESEED_MARKET_API_BASE_URL) ?? inferredPlanes.runtime.marketBaseUrl,
		teamId: optionalString(process.env.TREESEED_HOSTING_TEAM_ID) ?? inferredPlanes.runtime.teamId,
		projectId: optionalString(process.env.TREESEED_PROJECT_ID) ?? inferredPlanes.runtime.projectId,
	};
	const smtp = optionalRecord(record.smtp, 'smtp') ?? {};
	const turnstile = optionalRecord(record.turnstile, 'turnstile') ?? {};
	const agentProviders = optionalRecord(optionalRecord(record.providers, 'providers')?.agents, 'providers.agents') ?? {};
	const contentProviders = optionalRecord(optionalRecord(record.providers, 'providers')?.content, 'providers.content') ?? {};

	const deployConfig = {
		name: expectString(record.name, 'name'),
		slug: expectString(record.slug, 'slug'),
		siteUrl: expectString(record.siteUrl, 'siteUrl'),
		contactEmail: expectString(record.contactEmail, 'contactEmail'),
		hosting: parsedHosting && record.hub === undefined && record.runtime === undefined
			? parsedHosting
			: normalizeLegacyHostingFromPlanes(hub, runtime),
		hub,
		runtime,
		cloudflare: {
			accountId:
				optionalCloudflareAccountId(process.env.CLOUDFLARE_ACCOUNT_ID)
				?? CLOUDFLARE_ACCOUNT_ID_PLACEHOLDER,
			zoneId: optionalString(cloudflare.zoneId ?? cloudflare.zone_id),
			workerName: optionalString(cloudflare.workerName),
			queueName: optionalString(cloudflare.queueName),
			dlqName: optionalString(cloudflare.dlqName),
			d1Binding: optionalString(cloudflare.d1Binding),
			queueBinding: optionalString(cloudflare.queueBinding),
			pages: cloudflare.pages === undefined
				? undefined
				: {
					projectName: optionalString(process.env.TREESEED_CLOUDFLARE_PAGES_PROJECT_NAME) ?? optionalString(cloudflarePages.projectName),
					previewProjectName: optionalString(process.env.TREESEED_CLOUDFLARE_PAGES_PREVIEW_PROJECT_NAME) ?? optionalString(cloudflarePages.previewProjectName),
					productionBranch: optionalString(cloudflarePages.productionBranch) ?? 'main',
					stagingBranch: optionalString(cloudflarePages.stagingBranch) ?? 'staging',
					buildOutputDir: optionalString(cloudflarePages.buildOutputDir),
				},
			r2: cloudflare.r2 === undefined
				? undefined
				: {
					binding: optionalString(process.env.TREESEED_CONTENT_BUCKET_BINDING),
					bucketName: optionalString(process.env.TREESEED_CONTENT_BUCKET_NAME),
					publicBaseUrl: optionalString(process.env.TREESEED_CONTENT_PUBLIC_BASE_URL),
					manifestKeyTemplate: optionalString(cloudflareR2.manifestKeyTemplate ?? cloudflareR2.manifestKey) ?? 'teams/{teamId}/published/common.json',
					previewRootTemplate: optionalString(cloudflareR2.previewRootTemplate ?? cloudflareR2.previewRoot) ?? 'teams/{teamId}/previews',
					previewTtlHours: optionalPositiveNumber(cloudflareR2.previewTtlHours, 'cloudflare.r2.previewTtlHours') ?? 168,
				},
		},
		plugins: parsePluginReferences(record.plugins),
		providers: {
			forms: expectString(record.providers?.forms ?? TREESEED_DEFAULT_PROVIDER_SELECTIONS.forms, 'providers.forms'),
			agents: {
				execution: expectString(agentProviders.execution ?? TREESEED_DEFAULT_PROVIDER_SELECTIONS.agents.execution, 'providers.agents.execution'),
				mutation: expectString(agentProviders.mutation ?? TREESEED_DEFAULT_PROVIDER_SELECTIONS.agents.mutation, 'providers.agents.mutation'),
				repository: expectString(agentProviders.repository ?? TREESEED_DEFAULT_PROVIDER_SELECTIONS.agents.repository, 'providers.agents.repository'),
				verification: expectString(agentProviders.verification ?? TREESEED_DEFAULT_PROVIDER_SELECTIONS.agents.verification, 'providers.agents.verification'),
				notification: expectString(agentProviders.notification ?? TREESEED_DEFAULT_PROVIDER_SELECTIONS.agents.notification, 'providers.agents.notification'),
				research: expectString(agentProviders.research ?? TREESEED_DEFAULT_PROVIDER_SELECTIONS.agents.research, 'providers.agents.research'),
			},
			deploy: expectString(record.providers?.deploy ?? TREESEED_DEFAULT_PROVIDER_SELECTIONS.deploy, 'providers.deploy'),
			content: {
				runtime: expectString(
					contentProviders.runtime ?? TREESEED_DEFAULT_PROVIDER_SELECTIONS.content.runtime,
					'providers.content.runtime',
				),
				publish: expectString(
					contentProviders.publish
						?? contentProviders.runtime
						?? TREESEED_DEFAULT_PROVIDER_SELECTIONS.content.publish,
					'providers.content.publish',
				),
				docs: expectString(
					contentProviders.docs
						?? contentProviders.runtime
						?? TREESEED_DEFAULT_PROVIDER_SELECTIONS.content.docs
						?? TREESEED_DEFAULT_PROVIDER_SELECTIONS.content.runtime,
					'providers.content.docs',
				),
				serving: optionalEnum(
					contentProviders.serving,
					'providers.content.serving',
					['local_collections', 'published_runtime'],
				) ?? TREESEED_DEFAULT_PROVIDER_SELECTIONS.content.serving,
			},
			site: expectString(record.providers?.site ?? TREESEED_DEFAULT_PROVIDER_SELECTIONS.site, 'providers.site'),
		},
		surfaces: parsePlatformSurfacesConfig(record.surfaces),
		services,
		smtp: {
			enabled: optionalBoolean(smtp.enabled, 'smtp.enabled'),
		},
		turnstile: {
			enabled: optionalBoolean(turnstile.enabled, 'turnstile.enabled') ?? false,
		},
	};

	Object.defineProperty(deployConfig, '__tenantRoot', {
		value: dirname(configPath),
		enumerable: false,
	});
	Object.defineProperty(deployConfig, '__configPath', {
		value: configPath,
		enumerable: false,
	});
	return deployConfig;
}

export function loadCliDeployConfig(tenantRoot) {
	const configPath = resolve(tenantRoot, 'treeseed.site.yaml');
	if (!existsSync(configPath)) {
		throw new Error(`Unable to resolve Treeseed deploy config at "${configPath}".`);
	}

	return parseFallbackDeployConfig(configPath);
}

export function runNodeBinary(binPath, args, options = {}) {
	const result = spawnSync(process.execPath, [binPath, ...args], {
		stdio: options.stdio ?? 'inherit',
		cwd: options.cwd ?? process.cwd(),
		env: { ...process.env, ...(options.env ?? {}) },
	});

	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

export function runNodeScript(scriptPath, args = [], options = {}) {
	return runNodeBinary(scriptPath, args, options);
}

export function spawnNodeBinary(binPath, args, options = {}) {
	return spawn(process.execPath, [binPath, ...args], {
		stdio: options.stdio ?? 'inherit',
		cwd: options.cwd ?? process.cwd(),
		env: { ...process.env, ...(options.env ?? {}) },
		detached: options.detached ?? false,
	});
}
