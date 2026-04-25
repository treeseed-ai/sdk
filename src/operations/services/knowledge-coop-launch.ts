import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { collectTreeseedReconcileStatus, reconcileTreeseedTarget } from '../../reconcile/index.ts';
import { checkTreeseedProviderConnections, collectTreeseedConfigSeedValues } from './config-runtime.ts';
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
import { buildKnowledgeCoopKnowledgePackPackage, buildKnowledgeCoopTemplatePackage, importKnowledgeCoopKnowledgePack } from './knowledge-coop-packaging.ts';

export type KnowledgeCoopLaunchFailurePhase =
	| 'repo_provision_failed'
	| 'content_bootstrap_failed'
	| 'workflow_bootstrap_failed'
	| 'hosting_registration_failed'
	| 'runtime_connection_failed';

export interface KnowledgeCoopManagedLaunchInput {
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
	repoVisibility?: 'private' | 'public' | 'internal';
	marketBaseUrl?: string | null;
	projectApiBaseUrl?: string | null;
	contactEmail?: string | null;
	enableDefaultAgents?: boolean;
	preserveWorkingTree?: boolean;
}

export interface KnowledgeCoopLaunchPhaseRecord {
	phase: string;
	status: 'running' | 'completed' | 'failed';
	detail: string;
	timestamp: string;
}

export interface KnowledgeCoopManagedLaunchResult {
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
	workflows: {
		repository: string | null;
		workflows: Array<{ workflowPath: string; changed: boolean; workingDirectory?: string; mode?: string }>;
		secrets: { existing: string[]; created: string[] };
		variables: { existing: string[]; created: string[] };
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
	phases: KnowledgeCoopLaunchPhaseRecord[];
	templatePackage: ReturnType<typeof buildKnowledgeCoopTemplatePackage>;
	knowledgePackPackage: ReturnType<typeof buildKnowledgeCoopKnowledgePackPackage>;
}

export interface KnowledgeCoopLaunchPreflightReport {
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

class KnowledgeCoopLaunchError extends Error {
	readonly phase: KnowledgeCoopLaunchFailurePhase;
	readonly phases: KnowledgeCoopLaunchPhaseRecord[];

	constructor(phase: KnowledgeCoopLaunchFailurePhase, message: string, phases: KnowledgeCoopLaunchPhaseRecord[] = []) {
		super(message);
		this.name = 'KnowledgeCoopLaunchError';
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

function seedKnowledgeCoopContent(projectRoot: string, input: KnowledgeCoopManagedLaunchInput) {
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
motivation: Knowledge Coop launches should create immediately usable hubs instead of leaving teams in setup limbo.
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
description: The initial working agreements for this Knowledge Coop hub.
date: ${new Date().toISOString().slice(0, 10)}
summary: Managed launch created the default branches, runtime wiring, and first operational checkpoints.
status: live
---

This hub starts with a managed launch, a seeded objective, and a visible first workstream so the team can continue from a known baseline.
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
summary: The managed launch will begin with a narrow first release and explicit direction artifacts.
status: live
decisionType: approved
rationale: The initial launch should bias toward clarity, setup completion, and a visible first release loop.
authority: Knowledge Coop managed launch
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

This knowledge hub was launched from Knowledge Coop and is ready for Direct, Workstreams, Releases, and Share workflows.
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
	const coreApiPackage = ['@treeseed', 'core/api'].join('/');
	writeText(resolve(projectRoot, 'src/api/server.js'), `import { createRailwayTreeseedApiServer } from '${coreApiPackage}';

const server = await createRailwayTreeseedApiServer();
console.log(\`Treeseed project API listening on \${server.url}\`);
`);
}

function applyManagedProjectDefaults(projectRoot: string, input: KnowledgeCoopManagedLaunchInput) {
	const slug = slugify(input.projectSlug, 'project');
	const marketBaseUrl = normalizeBaseUrl(input.marketBaseUrl ?? envOrNull('TREESEED_MARKET_API_BASE_URL') ?? 'https://knowledge.coop');
	const siteUrl = resolveManagedWebUrl(slug);
	const projectApiBaseUrl = normalizeBaseUrl(input.projectApiBaseUrl ?? resolveManagedApiUrl(slug));
	const cloudflareAccountId = envOrNull('TREESEED_CLOUDFLARE_ACCOUNT_ID') ?? envOrNull('CLOUDFLARE_ACCOUNT_ID') ?? 'replace-with-cloudflare-account-id';
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
					buildCommand: 'npm run build',
					startCommand: 'node ./src/api/server.js',
				},
				environments: {
					local: {
						baseUrl: 'http://127.0.0.1:3000',
					},
				},
			},
			manager: {
				enabled: managedRuntime,
				provider: managedRuntime ? 'railway' : 'none',
				railway: {
					serviceName: `${slug}-manager`,
					rootDir: '.',
					buildCommand: 'npm run build',
					startCommand: 'node ./node_modules/@treeseed/core/dist/services/manager.js',
					schedule: '*/5 * * * *',
				},
			},
			worker: {
				enabled: managedRuntime,
				provider: managedRuntime ? 'railway' : 'none',
				railway: {
					serviceName: `${slug}-worker`,
					rootDir: '.',
					buildCommand: 'npm run build',
					startCommand: 'node ./node_modules/@treeseed/core/dist/services/worker.js',
				},
			},
				workdayStart: {
				enabled: managedRuntime,
				provider: managedRuntime ? 'railway' : 'none',
				railway: {
					serviceName: `${slug}-workday-start`,
					rootDir: '.',
					buildCommand: 'npm run build',
					startCommand: 'node ./node_modules/@treeseed/core/dist/services/workday-start.js',
					schedule: '0 9 * * 1-5',
				},
			},
			workdayReport: {
				enabled: managedRuntime,
				provider: managedRuntime ? 'railway' : 'none',
				railway: {
					serviceName: `${slug}-workday-report`,
					rootDir: '.',
					buildCommand: 'npm run build',
					startCommand: 'node ./node_modules/@treeseed/core/dist/services/workday-report.js',
					schedule: '5 17 * * 1-5',
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

function createDefaultWorkstream(projectId: string, input: KnowledgeCoopManagedLaunchInput, seed: ReturnType<typeof seedKnowledgeCoopContent>) {
	return {
		id: `${projectId}:initial-launch`,
		projectId,
		title: 'Initial launch',
		summary: 'Managed launch scaffolded the repo, seeded Direct, and prepared the first operating branch.',
		state: 'saved_remote',
		branchName: 'task/initial-launch',
		branchRef: 'refs/heads/task/initial-launch',
		owner: 'Knowledge Coop',
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
			launchedBy: 'knowledge_coop_market',
		},
	};
}

function pushDefaultWorkstreamBranch(projectRoot: string) {
	runGit(projectRoot, ['checkout', '-B', 'task/initial-launch'], false);
	runGit(projectRoot, ['push', '-u', 'origin', 'task/initial-launch'], false);
	runGit(projectRoot, ['checkout', 'main'], false);
}

function loadProjectMetadata(projectId: string, input: KnowledgeCoopManagedLaunchInput, seed: ReturnType<typeof seedKnowledgeCoopContent>, workstream: Record<string, unknown>, siteUrl: string, projectApiBaseUrl: string, repository: { slug: string; url: string }) {
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
	return spawnSync('bash', ['-lc', `command -v ${command}`], { stdio: 'ignore' }).status === 0;
}

function appendPhase(phases: KnowledgeCoopLaunchPhaseRecord[], phase: string, status: KnowledgeCoopLaunchPhaseRecord['status'], detail: string) {
	phases.push({
		phase,
		status,
		detail,
		timestamp: nowIso(),
	});
}

function scaffoldKnowledgeCoopSource(projectRoot: string, input: KnowledgeCoopManagedLaunchInput) {
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
			return importKnowledgeCoopKnowledgePack(projectRoot, input.sourceRef);
		});
	}
	return scaffoldTemplateProject(templateId, projectRoot, {
		target: input.projectSlug,
		name: input.projectName,
		slug: input.projectSlug,
		siteUrl: resolveManagedWebUrl(slugify(input.projectSlug, 'project')),
		contactEmail: input.contactEmail ?? `hello+${slugify(input.projectSlug, 'project')}@knowledge.coop`,
		repositoryUrl: `https://github.com/${slugify(input.repoOwner ?? resolveDefaultGitHubOwner(), 'treeseed-ai')}/${slugify(input.projectSlug, 'project')}`,
	}, {
		cwd: projectRoot,
		env: templateCatalogEnv,
	});
}

export async function validateKnowledgeCoopManagedLaunchPrerequisites(tenantRoot = process.cwd()): Promise<KnowledgeCoopLaunchPreflightReport> {
	const values = collectTreeseedConfigSeedValues(tenantRoot, 'prod', process.env);
	const requiredConfig = [
		['TREESEED_BETTER_AUTH_SECRET'],
		['TREESEED_AGENT_POOL_MIN_WORKERS'],
		['TREESEED_AGENT_POOL_MAX_WORKERS'],
		['TREESEED_AGENT_POOL_TARGET_QUEUE_DEPTH'],
		['TREESEED_AGENT_POOL_COOLDOWN_SECONDS'],
		['TREESEED_API_WEB_SERVICE_ID'],
		['TREESEED_API_WEB_SERVICE_SECRET'],
		['TREESEED_API_WEB_ASSERTION_SECRET'],
		['CLOUDFLARE_ACCOUNT_ID', 'TREESEED_CLOUDFLARE_ACCOUNT_ID'],
	];
	const missingConfig = requiredConfig
		.filter((group) => !group.some((name) => {
			const value = values[name];
			return typeof value === 'string' && value.trim().length > 0;
		}))
		.map((group) => group.join(' or '));
	const providerChecks = await checkTreeseedProviderConnections({ tenantRoot, scope: 'prod', env: process.env });
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

export async function executeKnowledgeCoopManagedLaunch(input: KnowledgeCoopManagedLaunchInput): Promise<KnowledgeCoopManagedLaunchResult> {
	const phases: KnowledgeCoopLaunchPhaseRecord[] = [];
	const preflight = await validateKnowledgeCoopManagedLaunchPrerequisites(process.cwd());
	if (!preflight.ok) {
		throw new KnowledgeCoopLaunchError(
			'runtime_connection_failed',
			`Knowledge Coop launch preflight failed: ${[...preflight.missingConfig, ...preflight.providerChecks.issues].join('; ') || 'provider checks failed.'}`,
			[],
		);
	}

	const workingRoot = mkdtempSync(join(tmpdir(), `knowledge-coop-launch-${slugify(input.projectSlug, 'project')}-`));
	const repoOwner = slugify(input.repoOwner ?? resolveDefaultGitHubOwner(), 'treeseed-ai');
	const repoName = slugify(input.projectSlug, 'project');

	try {
		appendPhase(phases, 'repo_provision', 'running', 'Creating GitHub repository.');
		const repository = await createGitHubRepository({
			owner: repoOwner,
			name: repoName,
			description: input.summary ?? `Knowledge Coop hub for ${input.projectName}`,
			visibility: input.repoVisibility ?? 'private',
			homepageUrl: resolveManagedWebUrl(repoName),
			topics: ['knowledge-coop', 'treeseed', 'knowledge-hub'],
		});
		appendPhase(phases, 'repo_provision', 'completed', `Created ${repository.slug}.`);

		appendPhase(phases, 'content_bootstrap', 'running', 'Scaffolding the project and seeding initial content.');
		await scaffoldKnowledgeCoopSource(workingRoot, input);
		ensureHostedProjectFiles(workingRoot);
		const managedDefaults = applyManagedProjectDefaults(workingRoot, input);
		const seed = seedKnowledgeCoopContent(workingRoot, input);
		appendPhase(phases, 'content_bootstrap', 'completed', 'Scaffolded the repo and seeded Direct content.');

		appendPhase(phases, 'workflow_bootstrap', 'running', 'Initializing git branches and GitHub workflows.');
		const initResult = initializeGitHubRepositoryWorkingTree(workingRoot, repository, {
			defaultBranch: 'main',
			createStaging: true,
			commitMessage: `Initialize ${input.projectName}`,
		});
		pushDefaultWorkstreamBranch(workingRoot);
		const workflows = await ensureGitHubDeployAutomation(workingRoot);
		appendPhase(phases, 'workflow_bootstrap', 'completed', 'Configured GitHub workflows, secrets, and variables.');

		appendPhase(phases, 'hosting_registration', 'running', 'Provisioning Cloudflare resources and deploy state.');
		const staging = await reconcileTreeseedTarget({
			tenantRoot: workingRoot,
			target: createPersistentDeployTarget('staging'),
			env: process.env,
		});
		const prod = await reconcileTreeseedTarget({
			tenantRoot: workingRoot,
			target: createPersistentDeployTarget('prod'),
			env: process.env,
		});
		runRemoteD1Migrations(workingRoot, { scope: 'prod' });
		const verification = await collectTreeseedReconcileStatus({
			tenantRoot: workingRoot,
			target: createPersistentDeployTarget('prod'),
			env: process.env,
		});
		appendPhase(phases, 'hosting_registration', 'completed', 'Provisioned Cloudflare resources.');

		const launchConfig = loadCliDeployConfig(workingRoot);
		const managedRuntime = launchConfig.runtime?.mode === 'treeseed_managed';
		let services: ReturnType<typeof configuredRailwayServices> = [];
		let deployments: Awaited<ReturnType<typeof deployRailwayService>>[] = [];
		let schedules: Awaited<ReturnType<typeof ensureRailwayScheduledJobs>> = [];
		let railwayVerification: Awaited<ReturnType<typeof verifyRailwayScheduledJobs>> = [];
		if (managedRuntime) {
			appendPhase(phases, 'runtime_connection', 'running', 'Deploying Railway services and registering runtime connectivity.');
			validateRailwayDeployPrerequisites(workingRoot, 'prod');
			services = configuredRailwayServices(workingRoot, 'prod');
			deployments = [];
			for (const service of services) {
				deployments.push(await deployRailwayService(workingRoot, service));
			}
			schedules = await ensureRailwayScheduledJobs(workingRoot, 'prod');
			railwayVerification = await verifyRailwayScheduledJobs(workingRoot, 'prod');
			finalizeDeploymentState(workingRoot, { scope: 'prod', serviceResults: deployments });
			appendPhase(phases, 'runtime_connection', 'completed', 'Deployed Railway services and recorded runtime readiness.');
		} else {
			appendPhase(phases, 'runtime_connection', 'completed', 'Skipped managed runtime deployment for hub-only or BYO runtime launch.');
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
		const templatePackage = buildKnowledgeCoopTemplatePackage(workingRoot, {
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
		const knowledgePackPackage = buildKnowledgeCoopKnowledgePackPackage(workingRoot, {
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
				defaultBranch: initResult.defaultBranch,
				stagingBranch: initResult.stagingBranch,
				visibility: repository.visibility,
			},
			workflows,
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
		const phase = error instanceof KnowledgeCoopLaunchError ? error.phase : (
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
		appendPhase(phases, phase.replace(/_failed$/u, ''), 'failed', message);
		throw new KnowledgeCoopLaunchError(phase, message, phases);
	} finally {
		if (input.preserveWorkingTree === false) {
			rmSync(workingRoot, { recursive: true, force: true });
		}
	}
}
