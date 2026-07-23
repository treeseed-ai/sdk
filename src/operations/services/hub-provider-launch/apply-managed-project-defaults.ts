import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { collectTreeseedReconcileStatus, reconcileTreeseedTarget } from '../../../reconcile/index.ts';
import { checkTreeseedProviderConnections, collectTreeseedConfigSeedValues, syncTreeseedGitHubEnvironment } from '../config-runtime.ts';
import { createPersistentDeployTarget, runRemoteD1Migrations, finalizeDeploymentState } from '../deploy.ts';
import {
	createGitHubRepository,
	ensureGitHubDeployAutomation,
	initializeGitHubRepositoryWorkingTree,
	resolveGitHubRemoteUrls,
	resolveDefaultGitHubOwner,
} from '../github-automation.ts';
import { configuredRailwayServices, deployRailwayService, ensureRailwayScheduledJobs, validateRailwayDeployPrerequisites, verifyRailwayScheduledJobs } from '../railway-deploy.ts';
import { loadCliDeployConfig } from '../runtime-tools.ts';
import { templateCatalogRoot } from '../runtime-paths.ts';
import { scaffoldTemplateProject } from '../template-registry.ts';
import { applyProjectLaunchHostBindingConfig } from '../template-host-bindings.ts';
import { runTreeseedGit } from '../git-runner.ts';
import {
	ProjectLaunchSecretSyncError,
	syncProjectLaunchHostBindingSecrets,
	type ProjectLaunchSecretSyncResult,
} from '../template-secret-sync.ts';
import { buildKnowledgePackMarketPackage, buildTemplateMarketPackage, importKnowledgePack } from '../market-packaging.ts';
import { resolveTreeseedToolBinary } from '../../../managed-dependencies.ts';
import { TREESEED_DEFAULT_STARTER_TEMPLATE_ID } from '../../../sdk-types.ts';
import type {
	ProjectLaunchConfigWritePlanItem,
	ProjectLaunchResolvedHostBinding,
	ProjectLaunchSecretDeploymentPlanItem,
} from '../../../template-launch-requirements.ts';
import { KnowledgeHubProviderLaunchInput, domainUrl, envOrNull, gitOutput, normalizeBaseUrl, nowIso, resolveManagedApiUrl, resolveManagedWebUrl, runGit, slugify, updateYamlFile } from './knowledge-hub-provider-launch-failure-phase.ts';
import { seedLaunchContent } from './current-template-catalog-url.ts';

export function applyManagedProjectDefaults(projectRoot: string, input: KnowledgeHubProviderLaunchInput) {
	const slug = slugify(input.projectSlug, 'project');
	const marketBaseUrl = normalizeBaseUrl(input.marketBaseUrl ?? envOrNull('TREESEED_API_BASE_URL') ?? 'https://knowledge.coop');
	const productionDomain = String(input.domains?.productionDomain ?? '').trim() || null;
	const stagingDomain = String(input.domains?.stagingDomain ?? '').trim() || null;
	const productionSiteUrl = domainUrl(productionDomain) ?? resolveManagedWebUrl(slug);
	const stagingSiteUrl = domainUrl(stagingDomain);
	const siteUrl = productionSiteUrl;
	const projectApiBaseUrl = normalizeBaseUrl(input.projectApiBaseUrl ?? resolveManagedApiUrl(slug));
	const cloudflareAccountId = envOrNull('CLOUDFLARE_ACCOUNT_ID') ?? 'replace-with-cloudflare-account-id';
	const runtimeMode = input.hostingMode === 'hybrid' ? 'byo_attached' : 'none';
	const runtimeRegistration = input.hostingMode === 'hybrid' ? 'optional' : 'none';
	const hubMode = input.hostingMode === 'self_hosted' ? 'customer_hosted' : 'treeseed_hosted';
	const managedRuntime = false;

	updateYamlFile(resolve(projectRoot, 'treeseed.site.yaml'), (config) => ({
		...config,
		name: input.projectName,
		slug,
		siteUrl,
		contactEmail: input.contactEmail ?? config.contactEmail ?? `hello+${slug}@knowledge.coop`,
		hub: {
			mode: hubMode,
		},
		runtime: {
			mode: runtimeMode,
			registration: runtimeRegistration,
			marketBaseUrl,
			teamId: input.teamId,
			projectId: input.projectId,
		},
		hosting: {
			kind: managedRuntime ? 'hosted_project' : 'self_hosted_project',
			registration: runtimeRegistration === 'required' ? 'optional' : runtimeRegistration,
			marketBaseUrl,
			teamId: input.teamId,
			projectId: input.projectId,
		},
		cloudflare: {
			...(config.cloudflare ?? {}),
			accountId: cloudflareAccountId,
			...(input.domains?.zoneId ? { zoneId: input.domains.zoneId } : {}),
			workerName: slug,
			pages: {
				projectName: slug,
				previewProjectName: slug,
				productionBranch: 'main',
				stagingBranch: 'staging',
				buildOutputDir: 'dist',
				...((config.cloudflare ?? {}).pages ?? {}),
			},
			r2: {
				binding: 'TREESEED_CONTENT_BUCKET',
				bucketName: `${slug}-content`,
				manifestKeyTemplate: 'teams/{teamId}/published/common.json',
				previewRootTemplate: 'teams/{teamId}/previews',
				previewTtlHours: 168,
				...((config.cloudflare ?? {}).r2 ?? {}),
			},
		},
		surfaces: {
			web: {
				enabled: true,
				provider: 'cloudflare',
				rootDir: '.',
				publicBaseUrl: siteUrl,
				localBaseUrl: 'http://127.0.0.1:4321',
				...(config.surfaces?.web ?? {}),
				environments: {
					...(config.surfaces?.web?.environments ?? {}),
					...(stagingDomain ? { staging: { ...(config.surfaces?.web?.environments?.staging ?? {}), domain: stagingDomain, baseUrl: stagingSiteUrl } } : {}),
					...(productionDomain ? { prod: { ...(config.surfaces?.web?.environments?.prod ?? {}), domain: productionDomain, baseUrl: productionSiteUrl } } : {}),
				},
			},
			api: {
				enabled: managedRuntime,
				provider: 'none',
				rootDir: '.',
				localBaseUrl: 'http://127.0.0.1:3000',
				...(config.surfaces?.api ?? {}),
			},
		},
		services: {
			...(config.services ?? {}),
			api: {
				enabled: managedRuntime,
				provider: 'none',
				rootDir: '.',
				publicBaseUrl: projectApiBaseUrl,
				environments: {
					local: {
						baseUrl: 'http://127.0.0.1:3000',
					},
				},
			},
		},
		plugins: [{ package: '@treeseed/core/plugin-default' }],
		providers: {
			...(config.providers ?? {}),
			forms: config.providers?.forms ?? 'store_only',
			agents: {
				execution: 'codex',
				mutation: 'local_branch',
				repository: 'git',
				verification: 'local',
				notification: 'sdk_message',
				research: 'project_graph',
				...(config.providers?.agents ?? {}),
			},
			deploy: 'cloudflare',
			content: {
				runtime: 'team_scoped_r2_overlay',
				publish: 'team_scoped_r2_overlay',
				docs: 'default',
				...(config.providers?.content ?? {}),
			},
			site: 'default',
		},
	}));

	updateYamlFile(resolve(projectRoot, 'src/manifest.yaml'), (manifest) => ({
		...manifest,
		id: slug,
		content: {
			...(manifest.content ?? {}),
			docs: './src/content/knowledge',
			pages: './src/content/pages',
			notes: './src/content/notes',
			questions: './src/content/questions',
			objectives: './src/content/objectives',
			proposals: './src/content/proposals',
			decisions: './src/content/decisions',
			people: './src/content/people',
			agents: './src/content/agents',
			books: './src/content/books',
			templates: './src/content/templates',
			knowledge_packs: './src/content/knowledge-packs',
			workdays: './src/content/workdays',
		},
		features: {
			docs: true,
			books: false,
			notes: true,
			questions: true,
			objectives: true,
			proposals: true,
			decisions: true,
			agents: input.enableDefaultAgents !== false,
			forms: false,
			...(manifest.features ?? {}),
		},
	}));

	return {
		slug,
		siteUrl,
		projectApiBaseUrl,
		marketBaseUrl,
		cloudflareAccountId,
	};
}

export function createDefaultWorkstream(projectId: string, input: KnowledgeHubProviderLaunchInput, seed: ReturnType<typeof seedLaunchContent>) {
	return {
		id: `${projectId}:initial-launch`,
		projectId,
		title: 'Initial launch',
		summary: 'Managed launch scaffolded the repo, seeded Direct, and prepared the first operating branch.',
		state: 'saved_remote',
		branchName: 'task/initial-launch',
		branchRef: 'refs/heads/task/initial-launch',
		owner: 'TreeSeed',
		linkedItems: [
			{ model: 'objective', id: seed.objectiveId },
			{ model: 'question', id: seed.questionId },
			{ model: 'note', id: seed.noteSlug },
		],
		verificationStatus: null,
		verificationSummary: null,
		lastSaveAt: nowIso(),
		lastStageAt: null,
		archivedAt: null,
		createdAt: nowIso(),
		updatedAt: nowIso(),
		metadata: {
			launchedBy: 'treeseed_market',
		},
	};
}

export function pushDefaultWorkstreamBranch(projectRoot: string) {
	runGit(projectRoot, ['checkout', '-B', 'task/initial-launch'], false);
	runGit(projectRoot, ['push', '--force', '-u', 'origin', 'task/initial-launch'], false);
	runGit(projectRoot, ['checkout', 'main'], false);
}

export function commitAndPushLaunchRepository(projectRoot: string, message: string, { forcePush = false } = {}) {
	runGit(projectRoot, ['checkout', 'main'], false);
	runGit(projectRoot, ['add', '-A'], false);
	if (gitOutput(projectRoot, ['status', '--porcelain'])) {
		runGit(projectRoot, ['commit', '-m', message], false);
	}
	runGit(projectRoot, ['push', ...(forcePush ? ['--force'] : []), '-u', 'origin', 'main'], false);
	runGit(projectRoot, ['checkout', 'staging'], false);
	runGit(projectRoot, ['merge', '--ff-only', 'main'], false);
	runGit(projectRoot, ['push', ...(forcePush ? ['--force'] : []), '-u', 'origin', 'staging'], false);
	runGit(projectRoot, ['checkout', 'main'], false);
}
