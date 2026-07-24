import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { collectReconcileStatus, reconcileTarget } from '../../../reconcile/index.ts';
import { checkProviderConnections, collectConfigSeedValues, syncGitHubEnvironment } from '../configuration/config-runtime.ts';
import { createPersistentDeployTarget, runRemoteD1Migrations, finalizeDeploymentState } from '../hosting/deployment/deploy.ts';
import {
	createGitHubRepository,
	ensureGitHubDeployAutomation,
	initializeGitHubRepositoryWorkingTree,
	resolveGitHubRemoteUrls,
	resolveDefaultGitHubOwner,
} from '../repositories/github-automation.ts';
import { configuredRailwayServices, deployRailwayService, ensureRailwayScheduledJobs, validateRailwayDeployPrerequisites, verifyRailwayScheduledJobs } from '../hosting/railway/railway-deploy.ts';
import { loadCliDeployConfig } from '../agents/runtime-tools.ts';
import { templateCatalogRoot } from '../runtime/runtime-paths.ts';
import { scaffoldTemplateProject } from '../support/template-registry.ts';
import { applyProjectLaunchHostBindingConfig } from '../hosting/deployment/template-host-bindings.ts';
import { runRepositoryGit } from '../operations/git-runner.ts';
import {
	ProjectLaunchSecretSyncError,
	syncProjectLaunchHostBindingSecrets,
	type ProjectLaunchSecretSyncResult,
} from '../configuration/template-secret-sync.ts';
import { buildKnowledgePackMarketPackage, buildTemplateMarketPackage, importKnowledgePack } from '../support/market-packaging.ts';
import { resolveToolBinary } from '../../../entrypoints/runtime/managed-dependencies.ts';
import { DEFAULT_STARTER_TEMPLATE_ID } from '../../../entrypoints/models/sdk-types.ts';
import type {
	ProjectLaunchConfigWritePlanItem,
	ProjectLaunchResolvedHostBinding,
	ProjectLaunchSecretDeploymentPlanItem,
} from '../../../entrypoints/templates/template-launch-requirements.ts';


export type KnowledgeHubProviderLaunchFailurePhase =
	| 'repo_provision_failed'
	| 'content_bootstrap_failed'
	| 'workflow_bootstrap_failed'
	| 'hosting_registration_failed'
	| 'host_binding_secret_sync_failed'
	| 'runtime_connection_failed';

export interface KnowledgeHubProviderLaunchInput {
	projectId: string;
	teamId: string;
	teamSlug?: string | null;
	projectSlug: string;
	projectName: string;
	summary?: string | null;
	coreObjective?: string | null;
	sourceKind: 'blank' | 'template' | 'knowledge_pack';
	sourceRef?: string | null;
	hostingMode?: 'managed' | 'hybrid' | 'self_hosted';
	publicSite?: boolean;
	repoOwner?: string | null;
	repoName?: string | null;
	repoVisibility?: 'private' | 'public' | 'internal';
	existingRepository?: {
		owner: string;
		name: string;
		url: string;
		defaultBranch?: string | null;
		stagingBranch?: string | null;
		visibility?: 'private' | 'public' | 'internal';
	} | null;
	contentRepository?: {
		owner?: string | null;
		name: string;
		url?: string | null;
		visibility?: 'private' | 'public' | 'internal';
		defaultBranch?: string | null;
		stagingBranch?: string | null;
	} | null;
	marketBaseUrl?: string | null;
	projectApiBaseUrl?: string | null;
	contactEmail?: string | null;
	enableDefaultAgents?: boolean;
	preserveWorkingTree?: boolean;
	cloudflareHost?: KnowledgeHubCloudflareHostLaunchInput | null;
	domains?: {
		productionDomain?: string | null;
		stagingDomain?: string | null;
		zoneName?: string | null;
		zoneId?: string | null;
		manageDns?: boolean;
		provider?: string | null;
	} | null;
	hostBindings?: Record<string, ProjectLaunchResolvedHostBinding>;
	hostBindingPlans?: {
		configWrites?: ProjectLaunchConfigWritePlanItem[];
		secretDeployment?: {
			items?: ProjectLaunchSecretDeploymentPlanItem[];
		};
	};
}

export interface KnowledgeHubCloudflareHostConfig {
	CLOUDFLARE_API_TOKEN?: string;
	CLOUDFLARE_ACCOUNT_ID?: string;
	TREESEED_CLOUDFLARE_PAGES_PROJECT_NAME?: string;
	TREESEED_CLOUDFLARE_PAGES_PREVIEW_PROJECT_NAME?: string;
	TREESEED_CONTENT_BUCKET_NAME?: string;
	TREESEED_CONTENT_BUCKET_BINDING?: string;
	TREESEED_PUBLIC_TURNSTILE_SITE_KEY?: string;
	TREESEED_TURNSTILE_SECRET_KEY?: string;
	environments?: Partial<Record<'staging' | 'prod', Record<string, unknown>>>;
	[key: string]: unknown;
}

export interface KnowledgeHubCloudflareHostLaunchInput {
	mode: 'team_owned' | 'treeseed_managed';
	hostId?: string | null;
	targetEnvironments?: Array<'local' | 'staging' | 'prod'>;
	config?: KnowledgeHubCloudflareHostConfig | null;
}

export interface KnowledgeHubProviderLaunchPhaseRecord {
	phase: string;
	status: 'running' | 'completed' | 'failed';
	detail: string;
	timestamp: string;
}

export interface KnowledgeHubProviderLaunchResult {
	workingRoot: string;
	repository: {
		slug: string;
		owner: string;
		name: string;
		url: string;
		defaultBranch: string;
		stagingBranch: string | null;
		visibility: 'private' | 'public' | 'internal';
	};
	contentRepository?: {
		slug: string;
		owner: string;
		name: string;
		url: string;
		defaultBranch: string;
		stagingBranch: string | null;
		visibility: 'private' | 'public' | 'internal';
	} | null;
	contentRepositoryWorkingRoot?: string | null;
	workflows: {
		repository: string | null;
		workflows: Array<{ workflowPath: string; changed: boolean; workingDirectory?: string; mode?: string }>;
		secrets: { existing: string[]; created: string[] };
		variables: { existing: string[]; created: string[] };
		environmentSync?: Array<Awaited<ReturnType<typeof syncGitHubEnvironment>>>;
		hostBindingSecretSync?: ProjectLaunchSecretSyncResult | null;
	};
	cloudflare: {
		staging: ReturnType<typeof provisionCloudflareResources>;
		prod: ReturnType<typeof provisionCloudflareResources>;
		verification: ReturnType<typeof verifyProvisionedCloudflareResources>;
	};
	railway: {
		services: ReturnType<typeof configuredRailwayServices>;
		deployments: Awaited<ReturnType<typeof deployRailwayService>>[];
		schedules: Awaited<ReturnType<typeof ensureRailwayScheduledJobs>>;
		verification: Awaited<ReturnType<typeof verifyRailwayScheduledJobs>>;
	};
	projectApiBaseUrl: string;
	projectSiteUrl: string;
	projectMetadata: Record<string, unknown>;
	defaultWorkstream: Record<string, unknown>;
	phases: KnowledgeHubProviderLaunchPhaseRecord[];
	templatePackage: ReturnType<typeof buildTemplateMarketPackage>;
	knowledgePackPackage: ReturnType<typeof buildKnowledgePackMarketPackage>;
}

export interface KnowledgeHubProviderLaunchPreflightReport {
	ok: boolean;
	missingConfig: string[];
	providerChecks: ReturnType<typeof checkProviderConnections>;
	commands: {
		git: boolean;
		gh: boolean;
		wrangler: boolean;
		railway: boolean;
	};
}

export type KnowledgeHubProviderLaunchPhaseReporter = (phase: KnowledgeHubProviderLaunchPhaseRecord) => void | Promise<void>;

export class KnowledgeHubProviderLaunchError extends Error {
	readonly phase: KnowledgeHubProviderLaunchFailurePhase;
	readonly phases: KnowledgeHubProviderLaunchPhaseRecord[];

	constructor(phase: KnowledgeHubProviderLaunchFailurePhase, message: string, phases: KnowledgeHubProviderLaunchPhaseRecord[] = []) {
		super(message);
		this.name = 'KnowledgeHubProviderLaunchError';
		this.phase = phase;
		this.phases = [...phases];
	}
}

export function nowIso() {
	return new Date().toISOString();
}

export function slugify(value: string, fallback = 'project') {
	return String(value ?? '')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.replace(/-{2,}/g, '-')
		.slice(0, 96) || fallback;
}

export function envOrNull(name: string) {
	const value = process.env[name];
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function normalizeBaseUrl(value: string | null | undefined) {
	return String(value ?? '').trim().replace(/\/+$/u, '');
}

export function domainUrl(domain: string | null | undefined) {
	const value = String(domain ?? '').trim().replace(/^https?:\/\//u, '').replace(/\/+$/u, '');
	return value ? `https://${value}` : null;
}

export function resolveManagedWebUrl(slug: string) {
	const baseDomain = envOrNull('TREESEED_MANAGED_WEB_BASE_DOMAIN');
	if (baseDomain) {
		return `https://${slug}.${baseDomain.replace(/^https?:\/\//u, '').replace(/^\.|\/+$/gu, '')}`;
	}
	return `https://${slug}.pages.dev`;
}

export function resolveManagedApiUrl(slug: string) {
	const baseDomain = envOrNull('TREESEED_MANAGED_API_BASE_DOMAIN');
	if (baseDomain) {
		return `https://${slug}-api.${baseDomain.replace(/^https?:\/\//u, '').replace(/^\.|\/+$/gu, '')}`;
	}
	return `https://${slug}-api.up.railway.app`;
}

export function ensureDir(path: string) {
	mkdirSync(path, { recursive: true });
}

export function runGit(cwd: string, args: string[], capture = true) {
	const mutating = /^(add|commit|checkout|switch|merge|tag|push|fetch|worktree|submodule|reset|clean|restore|branch)$/u.test(args[0] ?? '');
	const result = runRepositoryGit(args, {
		cwd,
		mode: mutating ? 'mutate' : 'read',
		allowFailure: true,
	});
	if (!capture && result.stdout.trim()) process.stdout.write(result.stdout);
	if (!capture && result.stderr.trim()) process.stderr.write(result.stderr);
	if (result.status !== 0) {
		if (args[0] === 'push' && !args.includes('--force')) {
			const retryArgs = ['push', '--force', ...args.slice(1)];
			const retry = runRepositoryGit(retryArgs, {
				cwd,
				mode: 'mutate',
				allowFailure: true,
			});
			if (!capture && retry.stdout.trim()) process.stdout.write(retry.stdout);
			if (!capture && retry.stderr.trim()) process.stderr.write(retry.stderr);
			if (retry.status === 0) return retry;
			const retryDetail = retry.stderr?.trim() || retry.stdout?.trim();
			throw new Error(`git ${retryArgs.join(' ')} failed${retryDetail ? `: ${retryDetail}` : ''}`);
		}
		const detail = result.stderr?.trim() || result.stdout?.trim();
		throw new Error(`git ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
	}
	return result;
}

export function gitOutput(cwd: string, args: string[]) {
	return runGit(cwd, args, true).stdout?.trim() ?? '';
}

export function writeText(path: string, body: string) {
	ensureDir(dirname(path));
	writeFileSync(path, body, 'utf8');
}

export function updateYamlFile(path: string, updater: (value: Record<string, any>) => Record<string, any>) {
	const parsed = parseYaml(readFileSync(path, 'utf8')) as Record<string, any>;
	const next = updater(parsed ?? {});
	writeText(path, stringifyYaml(next));
}
