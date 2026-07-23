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
import { KnowledgeHubProviderLaunchInput, KnowledgeHubProviderLaunchPhaseRecord, KnowledgeHubProviderLaunchPhaseReporter, KnowledgeHubProviderLaunchPreflightReport, nowIso, resolveManagedWebUrl, slugify } from './knowledge-hub-provider-launch-failure-phase.ts';
import { currentTemplateCatalogUrl, seedLaunchContent } from './current-template-catalog-url.ts';

export function loadProjectMetadata(projectId: string, input: KnowledgeHubProviderLaunchInput, seed: ReturnType<typeof seedLaunchContent>, workstream: Record<string, unknown>, siteUrl: string, projectApiBaseUrl: string, repository: { slug: string; url: string }) {
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

export function commandAvailable(command: string) {
	if (command === 'gh' || command === 'wrangler' || command === 'railway') {
		return Boolean(resolveTreeseedToolBinary(command));
	}
	return spawnSync('bash', ['-lc', `command -v ${command}`], { stdio: 'ignore' }).status === 0;
}

export async function appendPhase(
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

export function stringValue(value: unknown) {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';
}

export function overlayValue(target: Record<string, string>, key: string, value: unknown) {
	const next = stringValue(value);
	if (next) {
		target[key] = next;
	}
}

export function buildCloudflareHostEnvironmentOverlay(input: KnowledgeHubProviderLaunchInput, scope: 'staging' | 'prod') {
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
	overlayValue(overlay, 'TREESEED_CLOUDFLARE_PAGES_PREVIEW_PROJECT_NAME', overlay.TREESEED_CLOUDFLARE_PAGES_PREVIEW_PROJECT_NAME || overlay.TREESEED_CLOUDFLARE_PAGES_PROJECT_NAME || projectSlug);
	overlayValue(overlay, 'TREESEED_CONTENT_BUCKET_NAME', overlay.TREESEED_CONTENT_BUCKET_NAME || `${projectSlug}-content`);
	overlayValue(overlay, 'TREESEED_CONTENT_BUCKET_BINDING', overlay.TREESEED_CONTENT_BUCKET_BINDING || 'TREESEED_CONTENT_BUCKET');

	return overlay;
}

export function scaffoldLaunchSource(projectRoot: string, input: KnowledgeHubProviderLaunchInput) {
	const repositoryName = slugify(input.repoName ?? input.projectSlug, 'project');
	const templateId = input.sourceKind === 'template'
		? slugify(input.sourceRef ?? TREESEED_DEFAULT_STARTER_TEMPLATE_ID, TREESEED_DEFAULT_STARTER_TEMPLATE_ID)
		: TREESEED_DEFAULT_STARTER_TEMPLATE_ID;
	const templateCatalogEnv = { TREESEED_TEMPLATE_CATALOG_URL: currentTemplateCatalogUrl() };
	if (input.sourceKind === 'knowledge_pack') {
		return scaffoldTemplateProject(TREESEED_DEFAULT_STARTER_TEMPLATE_ID, projectRoot, {
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

export function repositoryHostGitHubEnvOverlay() {
	const token = process.env.TREESEED_GITHUB_TOKEN || process.env.TREESEED_HOSTED_HUBS_GITHUB_TOKEN || '';
	return token
		? { ...process.env, GH_TOKEN: token, GITHUB_TOKEN: token }
		: process.env;
}

export function prepareKnowledgeHubContentRepositoryRoot(sourceRoot: string, contentRoot: string, input: KnowledgeHubProviderLaunchInput) {
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

export function stripSoftwareContentOverlay(sourceRoot: string, input: KnowledgeHubProviderLaunchInput) {
	const contentRoot = resolve(sourceRoot, 'src', 'content');
	const coreObjectiveSource = resolve(contentRoot, 'objectives', 'core.md');
	const coreObjective = existsSync(coreObjectiveSource) ? readFileSync(coreObjectiveSource, 'utf8') : null;
	rmSync(contentRoot, { recursive: true, force: true });
	mkdirSync(contentRoot, { recursive: true });
	writeFileSync(resolve(contentRoot, '.gitkeep'), '', 'utf8');
	writeFileSync(
		resolve(contentRoot, 'README.md'),
		`# Preview content overlay\n\nThis software repository does not own ordinary Knowledge Hub content. Production content is published from the content repository to R2 artifacts. Checked-out files under \`src/content\` are for local, staging, or preview overlays only.\n\nHub: ${input.projectName}\nContent source: ${input.contentRepository?.name ?? `${slugify(input.projectSlug, 'project')}-content`}\n`,
		'utf8',
	);
	if (coreObjective) {
		mkdirSync(resolve(contentRoot, 'objectives'), { recursive: true });
		writeFileSync(resolve(contentRoot, 'objectives', 'core.md'), coreObjective, 'utf8');
	}
}

export async function validateKnowledgeHubProviderLaunchPrerequisites(
	tenantRoot = process.cwd(),
	{ valuesOverlay = {} }: { valuesOverlay?: Record<string, string | undefined> } = {},
): Promise<KnowledgeHubProviderLaunchPreflightReport> {
	const values = collectTreeseedConfigSeedValues(tenantRoot, 'prod', process.env, valuesOverlay);
	const requiredConfig = [
		['TREESEED_BETTER_AUTH_SECRET'],
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
