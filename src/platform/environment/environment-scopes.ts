import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { runRepositoryGit } from '../../operations/services/operations/git-runner.ts';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { discoverApplications } from '../../hosting/apps.ts';
import { githubRepositoryCredentialEnvName } from '../../operations/services/configuration/github-credentials.ts';
import { discoverPackageAdapters } from '../../operations/services/reconciliation/package-adapters.ts';
import type { DeployConfig, TenantConfig } from '../support/contracts.ts';
import { loadDeployConfig } from '../hosting/deploy-config.ts';
import { loadPlugins, type LoadedPluginRegistration } from '../support/plugins.ts';
import { loadManifest } from '../configuration/tenant-config.ts';


export const ENVIRONMENT_SCOPES = ['local', 'staging', 'prod'] as const;

export const ENVIRONMENT_REQUIREMENTS = ['required', 'conditional', 'optional', 'generated'] as const;

export const ENVIRONMENT_TARGETS = [
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

export const ENVIRONMENT_PURPOSES = ['dev', 'save', 'deploy', 'destroy', 'config'] as const;

export const ENVIRONMENT_SENSITIVITY = ['secret', 'plain', 'derived'] as const;

export const ENVIRONMENT_STORAGE = ['scoped', 'shared'] as const;

export const CONFIG_STARTUP_PROFILES = ['core', 'optional', 'advanced'] as const;

export const ENVIRONMENT_VISIBILITY = ['user', 'system'] as const;

export type EnvironmentScope = (typeof ENVIRONMENT_SCOPES)[number];

export type EnvironmentRequirement = (typeof ENVIRONMENT_REQUIREMENTS)[number];

export type EnvironmentTarget = (typeof ENVIRONMENT_TARGETS)[number];

export type EnvironmentPurpose = (typeof ENVIRONMENT_PURPOSES)[number];

export type EnvironmentSensitivity = (typeof ENVIRONMENT_SENSITIVITY)[number];

export type EnvironmentStorage = (typeof ENVIRONMENT_STORAGE)[number];

export type ConfigStartupProfile = (typeof CONFIG_STARTUP_PROFILES)[number];

export type EnvironmentVisibility = (typeof ENVIRONMENT_VISIBILITY)[number];

export type EnvironmentValidation =
	| { kind: 'string' | 'nonempty' | 'url' | 'email'; minLength?: number }
	| { kind: 'boolean' | 'number' }
	| { kind: 'enum'; values: string[] };

export type EnvironmentValueResolver =
	| string
	| ((context: EnvironmentContext, scope: EnvironmentScope, values?: Record<string, string | undefined>) => string | undefined);

export type MachineSecretPayload = {
	algorithm: 'aes-256-gcm';
	iv: string;
	tag: string;
	ciphertext: string;
};

export type MachineConfig = {
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
		secrets: Record<string, MachineSecretPayload>;
	};
	environments: Record<
		EnvironmentScope,
		{
			values: Record<string, string>;
			secrets: Record<string, MachineSecretPayload>;
		}
	>;
};

export type EnvironmentContext = {
	deployConfig: DeployConfig;
	tenantConfig?: TenantConfig;
	plugins: LoadedPluginRegistration[];
	tenantRoot: string;
};

export type EnvironmentEntry = {
	id: string;
	label: string;
	group: string;
	cluster?: string;
	onboardingFeature?: string;
	startupProfile?: ConfigStartupProfile;
	visibility?: EnvironmentVisibility;
	description: string;
	howToGet: string;
	sensitivity: EnvironmentSensitivity;
	targets: EnvironmentTarget[];
	appTargets?: string[];
	serviceTargets?: string[];
	scopes: EnvironmentScope[];
	requirement: EnvironmentRequirement;
	purposes: EnvironmentPurpose[];
	storage?: EnvironmentStorage;
	validation?: EnvironmentValidation;
	sourcePriority?: string[];
	defaultValue?: EnvironmentValueResolver;
	localDefaultValue?: EnvironmentValueResolver;
	isRelevant?: (context: EnvironmentContext, scope: EnvironmentScope, purpose?: EnvironmentPurpose) => boolean;
	requiredWhen?: (context: EnvironmentContext, scope: EnvironmentScope, purpose?: EnvironmentPurpose) => boolean;
	sourceRequirement?: string;
	sourceHostType?: string | null;
	sourceProvider?: string | null;
};

export type EnvironmentEntryYaml = Omit<
	EnvironmentEntry,
	'id' | 'defaultValue' | 'localDefaultValue' | 'isRelevant' | 'requiredWhen'
> & {
	cluster?: string;
	onboardingFeature?: string;
	startupProfile?: ConfigStartupProfile;
	visibility?: EnvironmentVisibility;
	defaultValueRef?: string;
	localDefaultValueRef?: string;
	relevanceRef?: string;
	requiredWhenRef?: string;
};

export type EnvironmentEntryOverride = Partial<
	Omit<EnvironmentEntryYaml, 'id'>
> & { id?: string };

export type EnvironmentRegistryOverlay = {
	entries?: Record<string, EnvironmentEntryOverride>;
};

export type ResolvedEnvironmentRegistry = {
	context: EnvironmentContext;
	entries: EnvironmentEntry[];
};

export type EnvironmentValidationProblem = {
	id: string;
	label: string;
	reason: 'missing' | 'invalid';
	message: string;
	entry: EnvironmentEntry;
};

export type EnvironmentValidationResult = {
	ok: boolean;
	entries: EnvironmentEntry[];
	required: EnvironmentEntry[];
	missing: EnvironmentValidationProblem[];
	invalid: EnvironmentValidationProblem[];
};

export type NamedResolverMap = Record<string, EnvironmentValueResolver>;

export type NamedPredicateMap = Record<
	string,
	(context: EnvironmentContext, scope: EnvironmentScope, purpose?: EnvironmentPurpose) => boolean
>;

export const moduleDir = dirname(fileURLToPath(import.meta.url));

export function firstExistingPath(candidates: string[]) {
	return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

export function resolveSdkEnvironmentPath() {
	const candidates = [
		resolve(moduleDir, 'env.yaml'),
		resolve(moduleDir, '../env.yaml'),
		resolve(moduleDir, '../../src/platform/env.yaml'),
		resolve(moduleDir, '../../dist/platform/env.yaml'),
		resolve(moduleDir, '../src/platform/env.yaml'),
		resolve(moduleDir, '../dist/platform/env.yaml'),
	];
	return firstExistingPath(candidates);
}

export function resolveSiblingPackageEnvironmentPath(packageDir: string) {
	return firstExistingPath([
		resolve(moduleDir, `../../../${packageDir}/src/env.yaml`),
		resolve(moduleDir, `../../../${packageDir}/dist/env.yaml`),
		resolve(moduleDir, `../../${packageDir}/src/env.yaml`),
		resolve(moduleDir, `../../${packageDir}/dist/env.yaml`),
	]);
}

export const TENANT_ENVIRONMENT_OVERLAY_PATH = 'src/env.yaml';

export const DEFAULT_MARKET_BASE_URL = 'https://api.treeseed.dev';

export function loadOptionalTenantConfig() {
	try {
		return loadManifest();
	} catch {
		return undefined;
	}
}

export function turnstileEnabled(context: EnvironmentContext) {
	return context.deployConfig.turnstile?.enabled === true;
}

export function smtpEnabled(context: EnvironmentContext) {
	return context.deployConfig.smtp?.enabled === true;
}

export function platformSurfaceEnabled(context: EnvironmentContext, surface: string) {
	return context.deployConfig.surfaces?.[surface]?.enabled !== false;
}

export function activeWorkflowPlane() {
	const plane = process.env.TREESEED_WORKFLOW_PLANE;
	if (plane === 'all') {
		return null;
	}
	return plane === 'web' || plane === 'processing' ? plane : null;
}

export function workflowPlaneAllows(plane: 'web' | 'processing') {
	const activePlane = activeWorkflowPlane();
	return activePlane === null || activePlane === plane;
}

export function managedServiceEnabled(context: EnvironmentContext, service: string) {
	return context.deployConfig.services?.[service]?.enabled !== false;
}

export function webSurfaceEnabled(context: EnvironmentContext) {
	if (!workflowPlaneAllows('web')) {
		return false;
	}
	return platformSurfaceEnabled(context, 'web');
}
