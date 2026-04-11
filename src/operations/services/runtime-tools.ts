import { readFileSync, existsSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { parse as parseYaml } from 'yaml';

const require = createRequire(import.meta.url);
const scriptRoot = dirname(fileURLToPath(import.meta.url));
const packageRootFromSource = resolve(scriptRoot, '..', '..', '..');
const treeseedRuntimeRoot = resolve(packageRootFromSource, 'src', 'treeseed');
const TREESEED_DEFAULT_PLUGIN_REFERENCES = [
	{
		package: '@treeseed/core/plugin-default',
		enabled: true,
	},
];
const TREESEED_DEFAULT_PROVIDER_SELECTIONS = {
	forms: 'store_only',
	agents: {
		execution: 'stub',
		mutation: 'local_branch',
		repository: 'stub',
		verification: 'stub',
		notification: 'stub',
		research: 'stub',
	},
	deploy: 'cloudflare',
	content: {
		docs: 'default',
	},
	site: 'default',
};
const TRESEED_MANAGED_SERVICE_KEYS = ['api', 'agents', 'gateway', 'manager', 'worker', 'workdayStart', 'workdayReport'];
const TRESEED_WORKSPACE_PACKAGE_DIRS = ['sdk', 'core', 'cli', 'agent', 'api'];
const CLOUDFLARE_ACCOUNT_ID_PLACEHOLDER = 'replace-with-cloudflare-account-id';

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

export const packageRoot = packageRootFromSource;
export const packageScriptRoot = resolve(packageRoot, 'scripts');
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
export const agentPackageRoot = resolveTreeseedPackageRoot('@treeseed/agent', '@treeseed/agent', 'agent');

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
		return resolve(packageScriptRoot, scriptName);
	}

	for (const extension of ['.js', '.ts', '.mjs']) {
		const candidate = resolve(packageScriptRoot, `${scriptName}${extension}`);
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
	const smtp = optionalRecord(record.smtp, 'smtp') ?? {};
	const turnstile = optionalRecord(record.turnstile, 'turnstile') ?? {};
	const agentProviders = optionalRecord(optionalRecord(record.providers, 'providers')?.agents, 'providers.agents') ?? {};
	const contentProviders = optionalRecord(optionalRecord(record.providers, 'providers')?.content, 'providers.content') ?? {};

	const deployConfig = {
		name: expectString(record.name, 'name'),
		slug: expectString(record.slug, 'slug'),
		siteUrl: expectString(record.siteUrl, 'siteUrl'),
		contactEmail: expectString(record.contactEmail, 'contactEmail'),
		cloudflare: {
			accountId:
				optionalCloudflareAccountId(cloudflare.accountId)
				?? optionalCloudflareAccountId(process.env.CLOUDFLARE_ACCOUNT_ID)
				?? CLOUDFLARE_ACCOUNT_ID_PLACEHOLDER,
			workerName: optionalString(cloudflare.workerName),
			gatewayWorkerName: optionalString(cloudflare.gatewayWorkerName),
			queueName: optionalString(cloudflare.queueName),
			dlqName: optionalString(cloudflare.dlqName),
			d1Binding: optionalString(cloudflare.d1Binding),
			queueBinding: optionalString(cloudflare.queueBinding),
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
				docs: expectString(contentProviders.docs ?? TREESEED_DEFAULT_PROVIDER_SELECTIONS.content.docs, 'providers.content.docs'),
			},
			site: expectString(record.providers?.site ?? TREESEED_DEFAULT_PROVIDER_SELECTIONS.site, 'providers.site'),
		},
		services: parseManagedServicesConfig(record.services),
		smtp: {
			enabled: optionalBoolean(smtp.enabled, 'smtp.enabled'),
		},
		turnstile: {
			enabled: optionalBoolean(turnstile.enabled, 'turnstile.enabled') ?? true,
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
