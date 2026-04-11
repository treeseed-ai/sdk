import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import type { TreeseedDeployConfig, TreeseedTenantConfig } from './contracts.ts';
import { loadTreeseedDeployConfig } from './deploy/config.ts';
import { loadTreeseedPlugins, type LoadedTreeseedPluginEntry } from './plugins/runtime.ts';
import { loadTreeseedManifest } from './tenant/config.ts';

export const TREESEED_ENVIRONMENT_SCOPES = ['local', 'staging', 'prod'] as const;
export const TREESEED_ENVIRONMENT_REQUIREMENTS = ['required', 'conditional', 'optional'] as const;
export const TREESEED_ENVIRONMENT_TARGETS = [
	'local-file',
	'wrangler-dev-vars',
	'github-secret',
	'github-variable',
	'cloudflare-secret',
	'cloudflare-var',
	'railway-secret',
	'config-file',
] as const;
export const TREESEED_ENVIRONMENT_PURPOSES = ['dev', 'save', 'deploy', 'destroy', 'config'] as const;
export const TREESEED_ENVIRONMENT_SENSITIVITY = ['secret', 'plain', 'derived'] as const;

export type TreeseedEnvironmentScope = (typeof TREESEED_ENVIRONMENT_SCOPES)[number];
export type TreeseedEnvironmentRequirement = (typeof TREESEED_ENVIRONMENT_REQUIREMENTS)[number];
export type TreeseedEnvironmentTarget = (typeof TREESEED_ENVIRONMENT_TARGETS)[number];
export type TreeseedEnvironmentPurpose = (typeof TREESEED_ENVIRONMENT_PURPOSES)[number];
export type TreeseedEnvironmentSensitivity = (typeof TREESEED_ENVIRONMENT_SENSITIVITY)[number];

export type TreeseedEnvironmentValidation =
	| { kind: 'string' | 'nonempty' | 'boolean' | 'number' | 'url' | 'email' }
	| { kind: 'enum'; values: string[] };

export type TreeseedEnvironmentValueResolver =
	| string
	| ((context: TreeseedEnvironmentContext, scope: TreeseedEnvironmentScope) => string);

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
	description: string;
	howToGet: string;
	sensitivity: TreeseedEnvironmentSensitivity;
	targets: TreeseedEnvironmentTarget[];
	scopes: TreeseedEnvironmentScope[];
	requirement: TreeseedEnvironmentRequirement;
	purposes: TreeseedEnvironmentPurpose[];
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
const CORE_ENVIRONMENT_PATH = resolve(moduleDir, 'env.yaml');
const TENANT_ENVIRONMENT_OVERLAY_PATH = 'src/env.yaml';

function loadOptionalTenantConfig() {
	try {
		return loadTreeseedManifest();
	} catch {
		return undefined;
	}
}

function turnstileEnabled(context: TreeseedEnvironmentContext) {
	return context.deployConfig.turnstile?.enabled !== false;
}

function smtpEnabled(context: TreeseedEnvironmentContext) {
	return context.deployConfig.smtp?.enabled === true;
}

function railwayManagedEnabled(context: TreeseedEnvironmentContext) {
	return Object.values(context.deployConfig.services ?? {}).some((service) =>
		service && service.enabled !== false && (service.provider ?? 'railway') === 'railway',
	);
}

function generatedSecret(bytes = 24) {
	return randomBytes(bytes).toString('hex');
}

const VALUE_RESOLVERS: NamedResolverMap = {
	generatedSecret: () => generatedSecret(),
	localFormsBypassDefault: () => 'true',
};

const PREDICATES: NamedPredicateMap = {
	turnstileEnabled: (context) => turnstileEnabled(context),
	turnstileNonLocal: (context, scope) => turnstileEnabled(context) && scope !== 'local',
	smtpEnabled: (context) => smtpEnabled(context),
	smtpNonLocal: (context, scope) => smtpEnabled(context) && scope !== 'local',
	railwayManagedEnabled: (context) => railwayManagedEnabled(context),
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
) {
	const source = scope === 'local' && entry.localDefaultValue !== undefined ? entry.localDefaultValue : entry.defaultValue;
	if (source === undefined) {
		return undefined;
	}
	return typeof source === 'function' ? source(context, scope) : source;
}

export function getTreeseedEnvironmentSuggestedValues(options: {
	scope: TreeseedEnvironmentScope;
	purpose?: TreeseedEnvironmentPurpose;
	deployConfig?: TreeseedDeployConfig;
	tenantConfig?: TreeseedTenantConfig;
	plugins?: LoadedTreeseedPluginEntry[];
}) {
	const registry = resolveTreeseedEnvironmentRegistry(options);
	return Object.fromEntries(
		registry.entries
			.filter((entry) => isTreeseedEnvironmentEntryRelevant(entry, registry.context, options.scope, options.purpose))
			.map((entry) => [entry.id, materializeDefaultValue(entry, registry.context, options.scope)])
			.filter(([, value]) => value !== undefined),
	) as Record<string, string>;
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
		case 'nonempty':
			return valuePresent(value) ? null : `${entry.id} must be a non-empty string.`;
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
