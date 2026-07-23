import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { runTreeseedGit } from '../../operations/services/git-runner.ts';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { discoverTreeseedApplications } from '../../hosting/apps.ts';
import { githubRepositoryCredentialEnvName } from '../../operations/services/github-credentials.ts';
import { discoverTreeseedPackageAdapters } from '../../operations/services/package-adapters.ts';
import type { TreeseedDeployConfig, TreeseedTenantConfig } from '../contracts.ts';
import { loadTreeseedDeployConfig } from '../deploy-config.ts';
import { loadTreeseedPlugins, type LoadedTreeseedPluginEntry } from '../plugins.ts';
import { loadTreeseedManifest } from '../tenant-config.ts';


export const TREESEED_ENVIRONMENT_SCOPES = ['local', 'staging', 'prod'] as const;

export const TREESEED_ENVIRONMENT_REQUIREMENTS = ['required', 'conditional', 'optional', 'generated'] as const;

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

export const TREESEED_ENVIRONMENT_VISIBILITY = ['user', 'system'] as const;

export type TreeseedEnvironmentScope = (typeof TREESEED_ENVIRONMENT_SCOPES)[number];

export type TreeseedEnvironmentRequirement = (typeof TREESEED_ENVIRONMENT_REQUIREMENTS)[number];

export type TreeseedEnvironmentTarget = (typeof TREESEED_ENVIRONMENT_TARGETS)[number];

export type TreeseedEnvironmentPurpose = (typeof TREESEED_ENVIRONMENT_PURPOSES)[number];

export type TreeseedEnvironmentSensitivity = (typeof TREESEED_ENVIRONMENT_SENSITIVITY)[number];

export type TreeseedEnvironmentStorage = (typeof TREESEED_ENVIRONMENT_STORAGE)[number];

export type TreeseedConfigStartupProfile = (typeof TREESEED_CONFIG_STARTUP_PROFILES)[number];

export type TreeseedEnvironmentVisibility = (typeof TREESEED_ENVIRONMENT_VISIBILITY)[number];

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
	visibility?: TreeseedEnvironmentVisibility;
	description: string;
	howToGet: string;
	sensitivity: TreeseedEnvironmentSensitivity;
	targets: TreeseedEnvironmentTarget[];
	appTargets?: string[];
	serviceTargets?: string[];
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
	sourceRequirement?: string;
	sourceHostType?: string | null;
	sourceProvider?: string | null;
};

export type TreeseedEnvironmentEntryYaml = Omit<
	TreeseedEnvironmentEntry,
	'id' | 'defaultValue' | 'localDefaultValue' | 'isRelevant' | 'requiredWhen'
> & {
	cluster?: string;
	onboardingFeature?: string;
	startupProfile?: TreeseedConfigStartupProfile;
	visibility?: TreeseedEnvironmentVisibility;
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

export type NamedResolverMap = Record<string, TreeseedEnvironmentValueResolver>;

export type NamedPredicateMap = Record<
	string,
	(context: TreeseedEnvironmentContext, scope: TreeseedEnvironmentScope, purpose?: TreeseedEnvironmentPurpose) => boolean
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

export const DEFAULT_TREESEED_MARKET_BASE_URL = 'https://api.treeseed.dev';

export function loadOptionalTenantConfig() {
	try {
		return loadTreeseedManifest();
	} catch {
		return undefined;
	}
}

export function turnstileEnabled(context: TreeseedEnvironmentContext) {
	return context.deployConfig.turnstile?.enabled === true;
}

export function smtpEnabled(context: TreeseedEnvironmentContext) {
	return context.deployConfig.smtp?.enabled === true;
}

export function platformSurfaceEnabled(context: TreeseedEnvironmentContext, surface: string) {
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

export function managedServiceEnabled(context: TreeseedEnvironmentContext, service: string) {
	return context.deployConfig.services?.[service]?.enabled !== false;
}

export function webSurfaceEnabled(context: TreeseedEnvironmentContext) {
	if (!workflowPlaneAllows('web')) {
		return false;
	}
	return platformSurfaceEnabled(context, 'web');
}
