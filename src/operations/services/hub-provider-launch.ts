import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { collectTreeseedReconcileStatus, reconcileTreeseedTarget } from '../../reconcile/index.ts';
import { checkTreeseedProviderConnections, collectTreeseedConfigSeedValues, syncTreeseedGitHubEnvironment } from './config-runtime.ts';
import { createPersistentDeployTarget, runRemoteD1Migrations, finalizeDeploymentState } from './deploy.ts';
import {
	createGitHubRepository,
	ensureGitHubDeployAutomation,
	initializeGitHubRepositoryWorkingTree,
	resolveDefaultGitHubOwner,
} from './github-automation.ts';
import { configuredRailwayServices, deployRailwayService, ensureRailwayScheduledJobs, validateRailwayDeployPrerequisites, verifyRailwayScheduledJobs } from './railway-deploy.ts';
import { loadCliDeployConfig } from './runtime-tools.ts';
import { templateCatalogRoot } from './runtime-paths.ts';
import { scaffoldTemplateProject } from './template-registry.ts';
import { buildKnowledgePackMarketPackage, buildTemplateMarketPackage, importKnowledgePack } from './market-packaging.ts';
import { resolveTreeseedToolBinary } from '../../managed-dependencies.ts';

export type KnowledgeHubProviderLaunchFailurePhase =
	| 'repo_provision_failed'
	| 'content_bootstrap_failed'
	| 'workflow_bootstrap_failed'
	| 'hosting_registration_failed'
	| 'runtime_connection_failed';

export interface KnowledgeHubProviderLaunchInput {
	projectId: string;
	teamId: string;
	teamSlug?: string | null;
	projectSlug: string;
	projectName: string;
	summary?: string | null;
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
	processingHost?: KnowledgeHubProcessingHostLaunchInput | null;
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

export interface KnowledgeHubProcessingHostConfig {
	RAILWAY_API_TOKEN?: string;
	TREESEED_RAILWAY_WORKSPACE?: string;
	TREESEED_RAILWAY_API_URL?: string;
	TREESEED_WORKER_POOL_SCALER?: string;
	environments?: Partial<Record<'staging' | 'prod', Record<string, unknown>>>;
	[key: string]: unknown;
}

export interface KnowledgeHubProcessingHostLaunchInput {
	mode: 'team_owned' | 'treeseed_managed';
	hostId?: string | null;
	targetEnvironments?: Array<'local' | 'staging' | 'prod'>;
	config?: KnowledgeHubProcessingHostConfig | null;
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
		environmentSync?: Array<Awaited<ReturnType<typeof syncTreeseedGitHubEnvironment>>>;
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
	providerChecks: ReturnType<typeof checkTreeseedProviderConnections>;
	commands: {
		git: boolean;
		gh: boolean;
		wrangler: boolean;
		railway: boolean;
	};
}

export type KnowledgeHubProviderLaunchPhaseReporter = (phase: KnowledgeHubProviderLaunchPhaseRecord) => void | Promise<void>;

class KnowledgeHubProviderLaunchError extends Error {
	readonly phase: KnowledgeHubProviderLaunchFailurePhase;
	readonly phases: KnowledgeHubProviderLaunchPhaseRecord[];

	constructor(phase: KnowledgeHubProviderLaunchFailurePhase, message: string, phases: KnowledgeHubProviderLaunchPhaseRecord[] = []) {
		super(message);
		this.name = 'KnowledgeHubProviderLaunchError';
		this.phase = phase;
		this.phases = [...phases];
	}
}

function nowIso() {
	return new Date().toISOString();
}

function slugify(value: string, fallback = 'project') {
	return String(value ?? '')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.replace(/-{2,}/g, '-')
		.slice(0, 96) || fallback;
}

function envOrNull(name: string) {
	const value = process.env[name];
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeBaseUrl(value: string | null | undefined) {
	return String(value ?? '').trim().replace(/\/+$/u, '');
}

function resolveManagedWebUrl(slug: string) {
	const baseDomain = envOrNull('TREESEED_MANAGED_WEB_BASE_DOMAIN');
	if (baseDomain) {
		return `https://${slug}.${baseDomain.replace(/^https?:\/\//u, '').replace(/^\.|\/+$/gu, '')}`;
	}
	return `https://${slug}.pages.dev`;
}

function resolveManagedApiUrl(slug: string) {
	const baseDomain = envOrNull('TREESEED_MANAGED_API_BASE_DOMAIN');
	if (baseDomain) {
		return `https://${slug}-api.${baseDomain.replace(/^https?:\/\//u, '').replace(/^\.|\/+$/gu, '')}`;
	}
	return `https://${slug}-api.up.railway.app`;
}

function ensureDir(path: string) {
	mkdirSync(path, { recursive: true });
}

function runGit(cwd: string, args: string[], capture = true) {
	const result = spawnSync('git', args, {
		cwd,
		stdio: capture ? 'pipe' : 'inherit',
		encoding: 'utf8',
	});
	if (result.status !== 0) {
		throw new Error(result.stderr?.trim() || result.stdout?.trim() || `git ${args.join(' ')} failed`);
	}
	return result;
}

function writeText(path: string, body: string) {
	ensureDir(dirname(path));
	writeFileSync(path, body, 'utf8');
}

function updateYamlFile(path: string, updater: (value: Record<string, any>) => Record<string, any>) {
	const parsed = parseYaml(readFileSync(path, 'utf8')) as Record<string, any>;
	const next = updater(parsed ?? {});
	writeText(path, stringifyYaml(next));
}

function currentTemplateCatalogUrl() {
	return `file:${resolve(templateCatalogRoot, 'catalog.fixture.json')}`;
}

function seedLaunchContent(projectRoot: string, input: KnowledgeHubProviderLaunchInput) {
	const objectiveId = `objective:launch-${slugify(input.projectSlug, 'hub')}`;
	const questionId = `question:operating-${slugify(input.projectSlug, 'hub')}`;
	const proposalId = `proposal:operating-${slugify(input.projectSlug, 'hub')}`;
	const decisionId = `decision:launch-${slugify(input.projectSlug, 'hub')}`;
	const stewardSlug = 'launch-steward';
	const noteSlug = `${slugify(input.projectSlug, 'hub')}-operating-model`;
	writeText(resolve(projectRoot, 'src/content/people', `${stewardSlug}.mdx`), `---
name: Launch Steward
role: Team steward
affiliation: ${input.projectName}
status: live
tags:
  - launch
  - stewardship
---

The launch steward keeps the first operating cycle legible while the hub moves from setup into active use.
`);
	writeText(resolve(projectRoot, 'src/content/objectives', 'launch-knowledge-hub.mdx'), `---
id: ${objectiveId}
title: Launch ${input.projectName}
description: Bring the initial knowledge hub online with live managed infrastructure and a clear operating direction.
date: ${new Date().toISOString().slice(0, 10)}
summary: Stand up the hub, connect the runtime, and make the first workstream visible to the team.
status: live
timeHorizon: near-term
motivation: TreeSeed launches should create immediately usable hubs instead of leaving teams in setup limbo.
primaryContributor: ${stewardSlug}
---

Launch ${input.projectName} as a living knowledge hub with real GitHub, Cloudflare, and Railway infrastructure.
`);
	writeText(resolve(projectRoot, 'src/content/questions', 'what-should-the-first-release-cover.mdx'), `---
id: ${questionId}
title: What Should The First Release Cover?
description: Scope the first release around the foundation of the hub and the initial operating routines.
date: ${new Date().toISOString().slice(0, 10)}
summary: Define the first release around setup completion, clear direction, and baseline operating visibility.
status: live
questionType: strategy
motivation: The first release should make the new hub usable without burying the team under setup debt.
primaryContributor: ${stewardSlug}
relatedObjectives:
  - launch-knowledge-hub
---

The first release should verify that the hub is live, the core direction is visible, and the team can move from Direct into Workstreams without setup debt.
`);
	writeText(resolve(projectRoot, 'src/content/notes', `${noteSlug}.mdx`), `---
title: ${input.projectName} Operating Model
description: The initial working agreements for this Knowledge Hub.
date: ${new Date().toISOString().slice(0, 10)}
summary: Managed launch created the default branches, runtime wiring, and first operational checkpoints.
status: live
---

This hub starts with a Knowledge Hub launch, a seeded objective, and a visible first workstream so the team can continue from a known baseline.
`);
	writeText(resolve(projectRoot, 'src/content/proposals', 'establish-initial-operating-routine.mdx'), `---
id: ${proposalId}
title: Establish The Initial Operating Routine
description: Turn the seeded objective and question into a concrete launch proposal for the first team cycle.
date: ${new Date().toISOString().slice(0, 10)}
summary: Make the launch posture explicit so the team can move from setup into a concrete operating loop.
status: live
proposalType: strategy
motivation: Managed launches work better when the first suggested operating pattern is visible in the content model.
primaryContributor: ${stewardSlug}
relatedObjectives:
  - launch-knowledge-hub
relatedQuestions:
  - what-should-the-first-release-cover
relatedNotes:
  - ${noteSlug}
decision: adopt-initial-launch-posture
---

Adopt a simple first operating routine: keep direction visible, keep the first release narrow, and use notes to capture implementation reality as the hub stabilizes.
`);
	writeText(resolve(projectRoot, 'src/content/decisions', 'adopt-initial-launch-posture.mdx'), `---
id: ${decisionId}
title: Adopt The Initial Launch Posture
description: Record the launch decision for the first operating cycle of the hub.
date: ${new Date().toISOString().slice(0, 10)}
summary: The Knowledge Hub launch will begin with a narrow first release and explicit direction artifacts.
status: live
decisionType: approved
rationale: The initial launch should bias toward clarity, setup completion, and a visible first release loop.
authority: Knowledge Hub launch
primaryContributor: ${stewardSlug}
relatedObjectives:
  - launch-knowledge-hub
relatedQuestions:
  - what-should-the-first-release-cover
relatedNotes:
  - ${noteSlug}
relatedProposals:
  - establish-initial-operating-routine
implements:
  - direct
  - workstreams
---

The first cycle will keep direction and execution tightly connected: one seeded objective, one seeded question, one proposal, one recorded launch decision, and a narrow release target.
`);
	writeText(resolve(projectRoot, 'src/content/knowledge', 'handbook', 'index.mdx'), `---
id: knowledge:${slugify(input.projectSlug, 'hub')}-handbook
title: ${input.projectName} Handbook
description: Welcome guide for the first team working in this hub.
type: guide
status: canonical
tags:
  - handbook
  - launch
canonical: true
domain: product
audience:
  - maintainer
  - contributor
---

# ${input.projectName}

This knowledge hub was launched from TreeSeed and is ready for Direct, Workstreams, Releases, and Share workflows.
`);
	writeText(resolve(projectRoot, 'src/content/pages', 'welcome.mdx'), `---
title: Welcome
description: ${input.projectName} is live.
pageLayout: article
stage: live
---

# ${input.projectName}

This hub is live and ready for the first team release cycle.
`);
	return {
		objectiveId,
		questionId,
		proposalId,
		decisionId,
		noteSlug,
	};
}

function ensureHostedProjectFiles(projectRoot: string) {
	const agentApiPackage = ['@treeseed', 'agent/api'].join('/');
	writeText(resolve(projectRoot, 'src/api/server.js'), `import { createRailwayTreeseedApiServer } from '${agentApiPackage}';

const server = await createRailwayTreeseedApiServer();
console.log(\`Treeseed project API listening on \${server.url}\`);
`);
}

function applyManagedProjectDefaults(projectRoot: string, input: KnowledgeHubProviderLaunchInput) {
	const slug = slugify(input.projectSlug, 'project');
	const marketBaseUrl = normalizeBaseUrl(input.marketBaseUrl ?? envOrNull('TREESEED_MARKET_API_BASE_URL') ?? 'https://knowledge.coop');
	const siteUrl = resolveManagedWebUrl(slug);
	const projectApiBaseUrl = normalizeBaseUrl(input.projectApiBaseUrl ?? resolveManagedApiUrl(slug));
	const cloudflareAccountId = envOrNull('CLOUDFLARE_ACCOUNT_ID') ?? 'replace-with-cloudflare-account-id';
	const runtimeMode = input.hostingMode === 'managed'
		? 'treeseed_managed'
		: input.hostingMode === 'hybrid'
			? 'byo_attached'
			: 'none';
	const runtimeRegistration = input.hostingMode === 'managed'
		? 'required'
		: input.hostingMode === 'hybrid'
			? 'optional'
			: 'none';
	const hubMode = input.hostingMode === 'self_hosted' ? 'customer_hosted' : 'treeseed_hosted';
	const managedRuntime = runtimeMode === 'treeseed_managed';

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
			workerName: slug,
			queueName: `${slug}-agent-work`,
			dlqName: `${slug}-agent-work-dlq`,
			pages: {
				projectName: slug,
				previewProjectName: `${slug}-staging`,
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
			},
			api: {
				enabled: managedRuntime,
				provider: managedRuntime ? 'railway' : 'none',
				rootDir: '.',
				localBaseUrl: 'http://127.0.0.1:3000',
				...(config.surfaces?.api ?? {}),
			},
		},
		services: {
			api: {
				enabled: managedRuntime,
				provider: managedRuntime ? 'railway' : 'none',
				rootDir: '.',
				publicBaseUrl: projectApiBaseUrl,
				railway: {
					serviceName: `${slug}-api`,
					buildCommand: 'npm run build:api',
					startCommand: 'npm run build:api && node ./src/api/server.js',
					healthcheckTimeoutSeconds: 120,
				},
				environments: {
					local: {
						baseUrl: 'http://127.0.0.1:3000',
					},
				},
			},
			workdayManager: {
				enabled: managedRuntime,
				provider: managedRuntime ? 'railway' : 'none',
				railway: {
					serviceName: `${slug}-workday-manager`,
					rootDir: '.',
					buildCommand: 'npm run build:api',
					startCommand: 'npm run build:api && node ./packages/agent/dist/services/workday-manager.js',
					schedule: '0 9 * * 1-5',
				},
			},
			workerRunner: {
				enabled: managedRuntime,
				provider: managedRuntime ? 'railway' : 'none',
				railway: {
					rootDir: '.',
					buildCommand: 'npm run build:api',
					startCommand: 'npm run build:api && node ./packages/agent/dist/services/worker.js',
				},
			},
			...(config.services ?? {}),
		},
		plugins: [{ package: '@treeseed/core/plugin-default' }],
		providers: {
			...(config.providers ?? {}),
			forms: config.providers?.forms ?? 'store_only',
			agents: {
				execution: 'copilot',
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

function createDefaultWorkstream(projectId: string, input: KnowledgeHubProviderLaunchInput, seed: ReturnType<typeof seedLaunchContent>) {
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

function pushDefaultWorkstreamBranch(projectRoot: string) {
	runGit(projectRoot, ['checkout', '-B', 'task/initial-launch'], false);
	runGit(projectRoot, ['push', '-u', 'origin', 'task/initial-launch'], false);
	runGit(projectRoot, ['checkout', 'main'], false);
}

function loadProjectMetadata(projectId: string, input: KnowledgeHubProviderLaunchInput, seed: ReturnType<typeof seedLaunchContent>, workstream: Record<string, unknown>, siteUrl: string, projectApiBaseUrl: string, repository: { slug: string; url: string }) {
	return {
		publicSite: input.publicSite !== false,
		sourceKind: input.sourceKind,
		sourceRef: input.sourceRef ?? null,
		enableDefaultAgents: input.enableDefaultAgents !== false,
		objectiveCount: 1,
		questionCount: 1,
		noteCount: 1,
		proposalCount: 1,
		decisionCount: 1,
		directViews: ['Now', 'Blocked', 'Ready for research', 'Ready for build', 'Release-linked'],
		directItems: [
			{
				model: 'objective',
				id: seed.objectiveId,
				title: `Launch ${input.projectName}`,
				status: 'live',
				updatedAt: nowIso(),
				linkedWorkstreamIds: [workstream.id],
				linkedReleaseIds: [],
			},
			{
				model: 'question',
				id: seed.questionId,
				title: 'What Should The First Release Cover?',
				status: 'live',
				updatedAt: nowIso(),
				linkedWorkstreamIds: [workstream.id],
				linkedReleaseIds: [],
			},
			{
				model: 'note',
				id: seed.noteSlug,
				title: `${input.projectName} Operating Model`,
				status: 'live',
				updatedAt: nowIso(),
				linkedWorkstreamIds: [workstream.id],
				linkedReleaseIds: [],
			},
			{
				model: 'proposal',
				id: seed.proposalId,
				title: 'Establish The Initial Operating Routine',
				status: 'live',
				updatedAt: nowIso(),
				linkedWorkstreamIds: [workstream.id],
				linkedReleaseIds: [],
			},
			{
				model: 'decision',
				id: seed.decisionId,
				title: 'Adopt The Initial Launch Posture',
				status: 'live',
				updatedAt: nowIso(),
				linkedWorkstreamIds: [workstream.id],
				linkedReleaseIds: [],
			},
		],
		workstreams: [workstream],
		siteUrl,
		projectApiBaseUrl,
		repository,
		launchPhase: 'completed',
		lastSuccessfulPhase: 'runtime_connection',
	};
}

function commandAvailable(command: string) {
	if (command === 'gh' || command === 'wrangler' || command === 'railway') {
		return Boolean(resolveTreeseedToolBinary(command));
	}
	return spawnSync('bash', ['-lc', `command -v ${command}`], { stdio: 'ignore' }).status === 0;
}

async function appendPhase(
	phases: KnowledgeHubProviderLaunchPhaseRecord[],
	phase: string,
	status: KnowledgeHubProviderLaunchPhaseRecord['status'],
	detail: string,
	reporter?: KnowledgeHubProviderLaunchPhaseReporter,
) {
	const record: KnowledgeHubProviderLaunchPhaseRecord = {
		phase,
		status,
		detail,
		timestamp: nowIso(),
	};
	phases.push(record);
	await reporter?.(record);
}

function stringValue(value: unknown) {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';
}

function overlayValue(target: Record<string, string>, key: string, value: unknown) {
	const next = stringValue(value);
	if (next) {
		target[key] = next;
	}
}

function buildCloudflareHostEnvironmentOverlay(input: KnowledgeHubProviderLaunchInput, scope: 'staging' | 'prod') {
	const config = input.cloudflareHost?.config ?? {};
	const environmentConfig = config.environments?.[scope] ?? {};
	const projectSlug = slugify(input.projectSlug, 'project');
	const overlay: Record<string, string> = {};

	for (const [key, value] of Object.entries(config)) {
		if (key === 'environments') continue;
		overlayValue(overlay, key, value);
	}
	for (const [key, value] of Object.entries(environmentConfig)) {
		overlayValue(overlay, key, value);
	}

	overlay.CLOUDFLARE_ACCOUNT_ID = overlay.CLOUDFLARE_ACCOUNT_ID || '';
	overlayValue(overlay, 'TREESEED_CLOUDFLARE_PAGES_PROJECT_NAME', overlay.TREESEED_CLOUDFLARE_PAGES_PROJECT_NAME || projectSlug);
	overlayValue(overlay, 'TREESEED_CLOUDFLARE_PAGES_PREVIEW_PROJECT_NAME', overlay.TREESEED_CLOUDFLARE_PAGES_PREVIEW_PROJECT_NAME || `${projectSlug}-staging`);
	overlayValue(overlay, 'TREESEED_CONTENT_BUCKET_NAME', overlay.TREESEED_CONTENT_BUCKET_NAME || `${projectSlug}-content`);
	overlayValue(overlay, 'TREESEED_CONTENT_BUCKET_BINDING', overlay.TREESEED_CONTENT_BUCKET_BINDING || 'TREESEED_CONTENT_BUCKET');

	return overlay;
}

function buildProcessingHostEnvironmentOverlay(input: KnowledgeHubProviderLaunchInput, scope: 'staging' | 'prod') {
	const config = input.processingHost?.config ?? {};
	const environmentConfig = config.environments?.[scope] ?? {};
	const overlay: Record<string, string> = {};

	for (const [key, value] of Object.entries(config)) {
		if (key === 'environments') continue;
		overlayValue(overlay, key, value);
	}
	for (const [key, value] of Object.entries(environmentConfig)) {
		overlayValue(overlay, key, value);
	}

	overlayValue(overlay, 'TREESEED_WORKER_POOL_SCALER', overlay.TREESEED_WORKER_POOL_SCALER || 'railway');

	return overlay;
}

function scaffoldLaunchSource(projectRoot: string, input: KnowledgeHubProviderLaunchInput) {
	const repositoryName = slugify(input.repoName ?? input.projectSlug, 'project');
	const templateId = input.sourceKind === 'template'
		? slugify(input.sourceRef ?? 'starter-basic', 'starter-basic')
		: 'starter-basic';
	const templateCatalogEnv = { TREESEED_TEMPLATE_CATALOG_URL: currentTemplateCatalogUrl() };
	if (input.sourceKind === 'knowledge_pack') {
		return scaffoldTemplateProject('starter-basic', projectRoot, {
			target: input.projectSlug,
			name: input.projectName,
			slug: input.projectSlug,
			siteUrl: resolveManagedWebUrl(slugify(input.projectSlug, 'project')),
			contactEmail: input.contactEmail ?? `hello+${slugify(input.projectSlug, 'project')}@knowledge.coop`,
		}, {
			cwd: projectRoot,
			env: templateCatalogEnv,
		}).then(() => {
			if (!input.sourceRef) {
				throw new Error('Knowledge pack launch requires sourceRef to point to a package manifest or directory.');
			}
			return importKnowledgePack(projectRoot, input.sourceRef);
		});
	}
	return scaffoldTemplateProject(templateId, projectRoot, {
		target: input.projectSlug,
		name: input.projectName,
		slug: input.projectSlug,
		siteUrl: resolveManagedWebUrl(slugify(input.projectSlug, 'project')),
		contactEmail: input.contactEmail ?? `hello+${slugify(input.projectSlug, 'project')}@knowledge.coop`,
		repositoryUrl: `https://github.com/${slugify(input.repoOwner ?? resolveDefaultGitHubOwner(), 'treeseed-ai')}/${repositoryName}`,
	}, {
		cwd: projectRoot,
		env: templateCatalogEnv,
	});
}

function repositoryHostGitHubEnvOverlay() {
	const token = process.env.TREESEED_HOSTED_HUBS_GITHUB_TOKEN || '';
	return token
		? { ...process.env, GH_TOKEN: token, GITHUB_TOKEN: token }
		: process.env;
}

function prepareKnowledgeHubContentRepositoryRoot(sourceRoot: string, contentRoot: string, input: KnowledgeHubProviderLaunchInput) {
	mkdirSync(contentRoot, { recursive: true });
	const contentSource = resolve(sourceRoot, 'src', 'content');
	if (existsSync(contentSource)) {
		cpSync(contentSource, resolve(contentRoot, 'src', 'content'), { recursive: true });
	}
	const publicSource = resolve(sourceRoot, 'public');
	if (existsSync(publicSource)) {
		cpSync(publicSource, resolve(contentRoot, 'public'), { recursive: true });
	}
	writeFileSync(resolve(contentRoot, 'README.md'), `# ${input.projectName} Content\n\nContent source for the ${input.projectName} TreeSeed Knowledge Hub.\n`, 'utf8');
	writeFileSync(resolve(contentRoot, 'treeseed.content.json'), `${JSON.stringify({
		schemaVersion: 1,
		kind: 'treeseed_hub_content',
		projectId: input.projectId,
		projectSlug: input.projectSlug,
		contentRoot: 'src/content',
		productionSource: 'r2_published_artifacts',
		overlayPolicy: 'src_content_when_present',
	}, null, 2)}\n`, 'utf8');
}

function stripSoftwareContentOverlay(sourceRoot: string, input: KnowledgeHubProviderLaunchInput) {
	const contentRoot = resolve(sourceRoot, 'src', 'content');
	rmSync(contentRoot, { recursive: true, force: true });
	mkdirSync(contentRoot, { recursive: true });
	writeFileSync(resolve(contentRoot, '.gitkeep'), '', 'utf8');
	writeFileSync(
		resolve(contentRoot, 'README.md'),
		`# Preview content overlay\n\nThis software repository does not own ordinary Knowledge Hub content. Production content is published from the content repository to R2 artifacts. Checked-out files under \`src/content\` are for local, staging, or preview overlays only.\n\nHub: ${input.projectName}\nContent source: ${input.contentRepository?.name ?? `${slugify(input.projectSlug, 'project')}-content`}\n`,
		'utf8',
	);
}

export async function validateKnowledgeHubProviderLaunchPrerequisites(
	tenantRoot = process.cwd(),
	{ valuesOverlay = {} }: { valuesOverlay?: Record<string, string | undefined> } = {},
): Promise<KnowledgeHubProviderLaunchPreflightReport> {
	const values = collectTreeseedConfigSeedValues(tenantRoot, 'prod', process.env, valuesOverlay);
	const requiredConfig = [
		['TREESEED_BETTER_AUTH_SECRET'],
		['TREESEED_AGENT_POOL_MIN_WORKERS'],
		['TREESEED_AGENT_POOL_MAX_WORKERS'],
		['TREESEED_AGENT_POOL_TARGET_QUEUE_DEPTH'],
		['TREESEED_AGENT_POOL_COOLDOWN_SECONDS'],
		['TREESEED_API_WEB_SERVICE_ID'],
		['TREESEED_API_WEB_SERVICE_SECRET'],
		['TREESEED_API_WEB_ASSERTION_SECRET'],
		['CLOUDFLARE_ACCOUNT_ID'],
	];
	const missingConfig = requiredConfig
		.filter((group) => !group.some((name) => {
			const value = values[name];
			return typeof value === 'string' && value.trim().length > 0;
		}))
		.map((group) => group.join(' or '));
	const providerChecks = await checkTreeseedProviderConnections({ tenantRoot, scope: 'prod', env: process.env, valuesOverlay });
	const commands = {
		git: commandAvailable('git'),
		gh: commandAvailable('gh'),
		wrangler: commandAvailable('wrangler'),
		railway: commandAvailable('railway'),
	};
	const ok = missingConfig.length === 0 && providerChecks.ok === true && Object.values(commands).every(Boolean);
	return {
		ok,
		missingConfig,
		providerChecks,
		commands,
	};
}

export async function executeKnowledgeHubProviderLaunch(
	input: KnowledgeHubProviderLaunchInput,
	options: { onPhase?: KnowledgeHubProviderLaunchPhaseReporter } = {},
): Promise<KnowledgeHubProviderLaunchResult> {
	const phases: KnowledgeHubProviderLaunchPhaseRecord[] = [];
	const reportPhase = options.onPhase;
	const prodEnvOverlay = {
		...buildCloudflareHostEnvironmentOverlay(input, 'prod'),
		...buildProcessingHostEnvironmentOverlay(input, 'prod'),
	};
	const stagingEnvOverlay = {
		...buildCloudflareHostEnvironmentOverlay(input, 'staging'),
		...buildProcessingHostEnvironmentOverlay(input, 'staging'),
	};
	const preflight = await validateKnowledgeHubProviderLaunchPrerequisites(process.cwd(), { valuesOverlay: prodEnvOverlay });
	if (!preflight.ok) {
		throw new KnowledgeHubProviderLaunchError(
			'runtime_connection_failed',
			`Knowledge Hub launch preflight failed: ${[...preflight.missingConfig, ...preflight.providerChecks.issues].join('; ') || 'provider checks failed.'}`,
			[],
		);
	}

	const workingRoot = mkdtempSync(join(tmpdir(), `hub-provider-launch-${slugify(input.projectSlug, 'project')}-`));
	const repoOwner = slugify(input.repoOwner ?? resolveDefaultGitHubOwner(), 'treeseed-ai');
	const repoName = slugify(input.repoName ?? input.projectSlug, 'project');
	const githubEnv = repositoryHostGitHubEnvOverlay();
	let packageSourceRoot: string | null = null;

	try {
		await appendPhase(phases, 'repo_provision', 'running', 'Creating or connecting GitHub software repository.', reportPhase);
		const repository = input.existingRepository?.url
			? {
				slug: `${input.existingRepository.owner}/${input.existingRepository.name}`,
				owner: input.existingRepository.owner,
				name: input.existingRepository.name,
				url: input.existingRepository.url,
				visibility: input.existingRepository.visibility ?? input.repoVisibility ?? 'private',
			}
			: await createGitHubRepository({
				owner: repoOwner,
				name: repoName,
				description: input.summary ?? `Knowledge Hub for ${input.projectName}`,
				visibility: input.repoVisibility ?? 'private',
				homepageUrl: resolveManagedWebUrl(repoName),
				topics: ['treeseed', 'knowledge-hub', 'market'],
			}, { env: githubEnv });
		await appendPhase(phases, 'repo_provision', 'completed', `${input.existingRepository?.url ? 'Connected' : 'Created'} ${repository.slug}.`, reportPhase);

		await appendPhase(phases, 'content_bootstrap', 'running', 'Scaffolding the project and seeding initial content.', reportPhase);
		await scaffoldLaunchSource(workingRoot, input);
		ensureHostedProjectFiles(workingRoot);
		const managedDefaults = applyManagedProjectDefaults(workingRoot, input);
		const seed = seedLaunchContent(workingRoot, input);
		packageSourceRoot = mkdtempSync(join(tmpdir(), `market-package-${slugify(input.projectSlug, 'project')}-`));
		cpSync(workingRoot, packageSourceRoot, { recursive: true });
		await appendPhase(phases, 'content_bootstrap', 'completed', 'Scaffolded the repo and seeded Direct content.', reportPhase);

		let contentRepository: KnowledgeHubProviderLaunchResult['contentRepository'] = null;
		let contentRepositoryWorkingRoot: string | null = null;
		if (input.contentRepository?.name) {
			await appendPhase(phases, 'content_repository', 'running', 'Creating content repository.', reportPhase);
			contentRepositoryWorkingRoot = mkdtempSync(join(tmpdir(), `market-content-${slugify(input.projectSlug, 'project')}-`));
			prepareKnowledgeHubContentRepositoryRoot(workingRoot, contentRepositoryWorkingRoot, input);
			const createdContentRepository = input.contentRepository.url
				? {
					slug: `${slugify(input.contentRepository.owner ?? repoOwner, 'treeseed-ai')}/${slugify(input.contentRepository.name, `${repoName}-content`)}`,
					owner: slugify(input.contentRepository.owner ?? repoOwner, 'treeseed-ai'),
					name: slugify(input.contentRepository.name, `${repoName}-content`),
					url: input.contentRepository.url,
					visibility: input.contentRepository.visibility ?? input.repoVisibility ?? 'private',
				}
				: await createGitHubRepository({
					owner: slugify(input.contentRepository.owner ?? repoOwner, 'treeseed-ai'),
					name: slugify(input.contentRepository.name, `${repoName}-content`),
					description: input.summary ?? `Content source for ${input.projectName}`,
					visibility: input.contentRepository.visibility ?? input.repoVisibility ?? 'private',
					homepageUrl: resolveManagedWebUrl(repoName),
					topics: ['treeseed', 'knowledge-hub', 'content'],
				}, { env: githubEnv });
			const contentInitResult = initializeGitHubRepositoryWorkingTree(contentRepositoryWorkingRoot, createdContentRepository, {
				defaultBranch: input.contentRepository.defaultBranch ?? 'main',
				createStaging: true,
				commitMessage: `Initialize ${input.projectName} content`,
			});
			contentRepository = {
				slug: createdContentRepository.slug,
				owner: createdContentRepository.owner,
				name: createdContentRepository.name,
				url: createdContentRepository.url,
				defaultBranch: contentInitResult.defaultBranch,
				stagingBranch: contentInitResult.stagingBranch,
				visibility: createdContentRepository.visibility,
			};
			await appendPhase(phases, 'content_repository', 'completed', `${input.contentRepository.url ? 'Connected' : 'Created'} ${contentRepository.slug}.`, reportPhase);
			stripSoftwareContentOverlay(workingRoot, input);
		}

		await appendPhase(phases, 'workflow_bootstrap', 'running', 'Initializing git branches and GitHub workflows.', reportPhase);
		const initResult = initializeGitHubRepositoryWorkingTree(workingRoot, repository, {
			defaultBranch: 'main',
			createStaging: true,
			commitMessage: `Initialize ${input.projectName}`,
		});
		pushDefaultWorkstreamBranch(workingRoot);
		const workflows = await ensureGitHubDeployAutomation(workingRoot, { valuesOverlay: prodEnvOverlay });
		const githubEnvironmentSync = [];
		for (const [scope, valuesOverlay] of [['staging', stagingEnvOverlay], ['prod', prodEnvOverlay]] as const) {
			githubEnvironmentSync.push(await syncTreeseedGitHubEnvironment({
				tenantRoot: workingRoot,
				scope,
				repository: repository.slug,
				valuesOverlay,
				execution: 'sequential',
			}));
		}
		const workflowSummary = { ...workflows, environmentSync: githubEnvironmentSync };
		await appendPhase(phases, 'workflow_bootstrap', 'completed', 'Configured GitHub workflows, secrets, and variables.', reportPhase);

		await appendPhase(phases, 'hosting_registration', 'running', 'Provisioning Cloudflare resources and deploy state.', reportPhase);
		const staging = await reconcileTreeseedTarget({
			tenantRoot: workingRoot,
			target: createPersistentDeployTarget('staging'),
			env: { ...process.env, ...stagingEnvOverlay },
		});
		const prod = await reconcileTreeseedTarget({
			tenantRoot: workingRoot,
			target: createPersistentDeployTarget('prod'),
			env: { ...process.env, ...prodEnvOverlay },
		});
		runRemoteD1Migrations(workingRoot, { scope: 'prod' });
		const verification = await collectTreeseedReconcileStatus({
			tenantRoot: workingRoot,
			target: createPersistentDeployTarget('prod'),
			env: { ...process.env, ...prodEnvOverlay },
		});
		await appendPhase(phases, 'hosting_registration', 'completed', 'Provisioned Cloudflare resources.', reportPhase);

		const launchConfig = loadCliDeployConfig(workingRoot);
		const managedRuntime = launchConfig.runtime?.mode === 'treeseed_managed';
		let services: ReturnType<typeof configuredRailwayServices> = [];
		let deployments: Awaited<ReturnType<typeof deployRailwayService>>[] = [];
		let schedules: Awaited<ReturnType<typeof ensureRailwayScheduledJobs>> = [];
		let railwayVerification: Awaited<ReturnType<typeof verifyRailwayScheduledJobs>> = [];
		if (managedRuntime) {
			await appendPhase(phases, 'runtime_connection', 'running', 'Deploying Railway services and registering runtime connectivity.', reportPhase);
			const railwayEnv = { ...process.env, ...prodEnvOverlay };
			validateRailwayDeployPrerequisites(workingRoot, 'prod', { env: railwayEnv });
			services = configuredRailwayServices(workingRoot, 'prod');
			deployments = [];
			for (const service of services) {
				deployments.push(await deployRailwayService(workingRoot, service, { env: railwayEnv }));
			}
			schedules = await ensureRailwayScheduledJobs(workingRoot, 'prod', { env: railwayEnv });
			railwayVerification = await verifyRailwayScheduledJobs(workingRoot, 'prod', { env: railwayEnv });
			finalizeDeploymentState(workingRoot, { scope: 'prod', serviceResults: deployments });
			await appendPhase(phases, 'runtime_connection', 'completed', 'Deployed Railway services and recorded runtime readiness.', reportPhase);
		} else {
			await appendPhase(phases, 'runtime_connection', 'completed', 'Skipped managed runtime deployment for hub-only or BYO runtime launch.', reportPhase);
		}

		const defaultWorkstream = createDefaultWorkstream(input.projectId, input, seed);
		const projectMetadata = loadProjectMetadata(
			input.projectId,
			input,
			seed,
			defaultWorkstream,
			managedDefaults.siteUrl,
			managedDefaults.projectApiBaseUrl,
			{ slug: repository.slug, url: repository.url },
		);
		const packageRoot = packageSourceRoot ?? workingRoot;
		const templatePackage = buildTemplateMarketPackage(packageRoot, {
			projectSlug: input.projectSlug,
			title: `${input.projectName} template`,
			summary: input.summary ?? null,
			market: {
				publisherId: input.teamId,
				publisherName: input.teamSlug ?? input.teamId,
				publishMetadata: {
					sourceProjectId: input.projectId,
					sourceKind: input.sourceKind,
				},
			},
		});
		const knowledgePackPackage = buildKnowledgePackMarketPackage(packageRoot, {
			projectSlug: input.projectSlug,
			title: `${input.projectName} knowledge pack`,
			summary: input.summary ?? null,
			market: {
				publisherId: input.teamId,
				publisherName: input.teamSlug ?? input.teamId,
				publishMetadata: {
					sourceProjectId: input.projectId,
					sourceKind: input.sourceKind,
				},
			},
		});

		return {
			workingRoot,
			repository: {
				slug: repository.slug,
				owner: repository.owner,
				name: repository.name,
				url: repository.url,
				defaultBranch: input.existingRepository?.defaultBranch ?? initResult.defaultBranch,
				stagingBranch: input.existingRepository?.stagingBranch ?? initResult.stagingBranch,
				visibility: repository.visibility,
			},
			contentRepository,
			contentRepositoryWorkingRoot,
			workflows: workflowSummary,
			cloudflare: {
				staging,
				prod,
				verification,
			},
			railway: {
				services,
				deployments,
				schedules,
				verification: railwayVerification,
			},
			projectApiBaseUrl: managedDefaults.projectApiBaseUrl,
			projectSiteUrl: managedDefaults.siteUrl,
			projectMetadata,
			defaultWorkstream,
			phases,
			templatePackage,
			knowledgePackPackage,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const phase = error instanceof KnowledgeHubProviderLaunchError ? error.phase : (
			phases.some((entry) => entry.phase === 'runtime_connection' && entry.status === 'running')
				? 'runtime_connection_failed'
				: phases.some((entry) => entry.phase === 'hosting_registration' && entry.status === 'running')
					? 'hosting_registration_failed'
					: phases.some((entry) => entry.phase === 'workflow_bootstrap' && entry.status === 'running')
						? 'workflow_bootstrap_failed'
						: phases.some((entry) => entry.phase === 'content_bootstrap' && entry.status === 'running')
							? 'content_bootstrap_failed'
							: 'repo_provision_failed'
		);
		await appendPhase(phases, phase.replace(/_failed$/u, ''), 'failed', message, reportPhase);
		throw new KnowledgeHubProviderLaunchError(phase, message, phases);
	} finally {
		if (input.preserveWorkingTree === false) {
			rmSync(workingRoot, { recursive: true, force: true });
		}
		if (packageSourceRoot && packageSourceRoot !== workingRoot && input.preserveWorkingTree === false) {
			rmSync(packageSourceRoot, { recursive: true, force: true });
		}
	}
}
