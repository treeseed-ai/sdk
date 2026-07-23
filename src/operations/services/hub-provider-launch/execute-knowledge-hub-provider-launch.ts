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
import { KnowledgeHubProviderLaunchError, KnowledgeHubProviderLaunchInput, KnowledgeHubProviderLaunchPhaseRecord, KnowledgeHubProviderLaunchPhaseReporter, KnowledgeHubProviderLaunchResult, resolveManagedWebUrl, slugify } from './knowledge-hub-provider-launch-failure-phase.ts';
import { appendPhase, buildCloudflareHostEnvironmentOverlay, loadProjectMetadata, prepareKnowledgeHubContentRepositoryRoot, repositoryHostGitHubEnvOverlay, scaffoldLaunchSource, stripSoftwareContentOverlay, validateKnowledgeHubProviderLaunchPrerequisites } from './load-project-metadata.ts';
import { ensureHostedProjectFiles, seedLaunchContent } from './current-template-catalog-url.ts';
import { applyManagedProjectDefaults, commitAndPushLaunchRepository, createDefaultWorkstream, pushDefaultWorkstreamBranch } from './apply-managed-project-defaults.ts';

export async function executeKnowledgeHubProviderLaunch(
	input: KnowledgeHubProviderLaunchInput,
	options: { onPhase?: KnowledgeHubProviderLaunchPhaseReporter } = {},
): Promise<KnowledgeHubProviderLaunchResult> {
	const phases: KnowledgeHubProviderLaunchPhaseRecord[] = [];
	const reportPhase = options.onPhase;
const prodEnvOverlay = {
		...buildCloudflareHostEnvironmentOverlay(input, 'prod'),
	};
	const stagingEnvOverlay = {
		...buildCloudflareHostEnvironmentOverlay(input, 'staging'),
	};
	const preflight = await validateKnowledgeHubProviderLaunchPrerequisites(process.cwd(), { valuesOverlay: prodEnvOverlay });
	if (!preflight.ok) {
		throw new KnowledgeHubProviderLaunchError(
			'runtime_connection_failed',
			`Knowledge Hub launch preflight failed: ${[...preflight.missingConfig, ...preflight.providerChecks.issues].join('; ') || 'provider checks failed.'}`,
			[],
		);
	}

	const launchTempBase = resolve(process.cwd(), '.treeseed', 'tmp', 'hub-provider-launch');
	mkdirSync(launchTempBase, { recursive: true });
	const workingRoot = mkdtempSync(join(launchTempBase, `hub-provider-launch-${slugify(input.projectSlug, 'project')}-`));
	const repoOwner = slugify(input.repoOwner ?? resolveDefaultGitHubOwner(), 'treeseed-ai');
	const repoName = slugify(input.repoName ?? input.projectSlug, 'project');
	const githubEnv = repositoryHostGitHubEnvOverlay();
	let packageSourceRoot: string | null = null;

	try {
		await appendPhase(phases, 'repo_provision', 'running', 'Creating or connecting GitHub software repository.', reportPhase);
		const repository = input.existingRepository?.url
			? {
				...resolveGitHubRemoteUrls(input.existingRepository.owner, input.existingRepository.name),
				slug: `${input.existingRepository.owner}/${input.existingRepository.name}`,
				owner: input.existingRepository.owner,
				name: input.existingRepository.name,
				url: input.existingRepository.url,
				visibility: input.existingRepository.visibility ?? input.repoVisibility ?? 'private',
				defaultBranch: input.existingRepository.defaultBranch ?? 'main',
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
		const hostBindingConfig = applyProjectLaunchHostBindingConfig({
			projectRoot: workingRoot,
			hostBindings: input.hostBindings,
			hostBindingPlans: input.hostBindingPlans,
			launchInput: input,
			derived: {
				projectSlug: slugify(input.projectSlug, 'project'),
				projectName: input.projectName,
				repositoryName: repoName,
			},
		});
		if (hostBindingConfig.configWrites.length > 0 || hostBindingConfig.environmentWrites.length > 0) {
			await appendPhase(
				phases,
				'host_binding_config',
				'completed',
				`Applied ${hostBindingConfig.configWrites.length} host config write${hostBindingConfig.configWrites.length === 1 ? '' : 's'} and ${hostBindingConfig.environmentWrites.length} environment overlay entr${hostBindingConfig.environmentWrites.length === 1 ? 'y' : 'ies'}.`,
				reportPhase,
			);
		}
		const seed = seedLaunchContent(workingRoot, input);
		packageSourceRoot = mkdtempSync(join(launchTempBase, `market-package-${slugify(input.projectSlug, 'project')}-`));
		cpSync(workingRoot, packageSourceRoot, { recursive: true });
		await appendPhase(phases, 'content_bootstrap', 'completed', 'Scaffolded the repo and seeded Direct content.', reportPhase);

		let contentRepository: KnowledgeHubProviderLaunchResult['contentRepository'] = null;
		let contentRepositoryWorkingRoot: string | null = null;
		if (input.contentRepository?.name) {
			await appendPhase(phases, 'content_repository', 'running', 'Creating content repository.', reportPhase);
			contentRepositoryWorkingRoot = mkdtempSync(join(launchTempBase, `market-content-${slugify(input.projectSlug, 'project')}-`));
			prepareKnowledgeHubContentRepositoryRoot(workingRoot, contentRepositoryWorkingRoot, input);
			const createdContentRepository = input.contentRepository.url
				? {
					...resolveGitHubRemoteUrls(input.contentRepository.owner ?? repoOwner, input.contentRepository.name),
					slug: `${slugify(input.contentRepository.owner ?? repoOwner, 'treeseed-ai')}/${slugify(input.contentRepository.name, `${repoName}-content`)}`,
					owner: slugify(input.contentRepository.owner ?? repoOwner, 'treeseed-ai'),
					name: slugify(input.contentRepository.name, `${repoName}-content`),
					url: input.contentRepository.url,
					visibility: input.contentRepository.visibility ?? input.repoVisibility ?? 'private',
					defaultBranch: input.contentRepository.defaultBranch ?? 'main',
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
				forcePush: !input.contentRepository.url,
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
			push: false,
		});
		const workflows = await ensureGitHubDeployAutomation(workingRoot, { valuesOverlay: prodEnvOverlay });
		commitAndPushLaunchRepository(workingRoot, `Configure ${input.projectName} deployment`, { forcePush: !input.existingRepository?.url });
		pushDefaultWorkstreamBranch(workingRoot);
		let workflowSummary = {
			...workflows,
			environmentSync: [] as Array<Awaited<ReturnType<typeof syncTreeseedGitHubEnvironment>>>,
			hostBindingSecretSync: null as ProjectLaunchSecretSyncResult | null,
		};
		await appendPhase(phases, 'workflow_bootstrap', 'completed', 'Configured GitHub workflows.', reportPhase);

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
		const turnstileOverlay = (state: Record<string, any>, base: Record<string, string | undefined>) => {
			const widget = state?.turnstileWidgets?.formGuard ?? {};
			return {
				...base,
				...(typeof widget.sitekey === 'string' && widget.sitekey.length > 0
					? { TREESEED_PUBLIC_TURNSTILE_SITE_KEY: widget.sitekey }
					: {}),
				...(typeof widget.secret === 'string' && widget.secret.length > 0
					? { TREESEED_TURNSTILE_SECRET_KEY: widget.secret }
					: {}),
			};
		};
		const scopedEnvironmentOverlays = [
			['staging', turnstileOverlay(staging.state as Record<string, any>, stagingEnvOverlay)],
			['prod', turnstileOverlay(prod.state as Record<string, any>, prodEnvOverlay)],
		] as const;
		const hostBindingSecretPlanItems = input.hostBindingPlans?.secretDeployment?.items ?? [];
		if (hostBindingSecretPlanItems.length > 0) {
			await appendPhase(
				phases,
				'host_binding_secret_sync',
				'running',
				`Syncing ${hostBindingSecretPlanItems.length} host-bound environment entr${hostBindingSecretPlanItems.length === 1 ? 'y' : 'ies'}.`,
				reportPhase,
			);
			try {
				const hostBindingSecretSync = await syncProjectLaunchHostBindingSecrets({
					projectRoot: workingRoot,
					repository: repository.slug,
					hostBindings: input.hostBindings,
					secretDeploymentPlan: input.hostBindingPlans?.secretDeployment,
					valuesByScope: Object.fromEntries(scopedEnvironmentOverlays),
					onProgress: async (event) => {
						await appendPhase(
							phases,
							`host_binding_secret_sync_${event.provider}_${event.scope}`,
							event.status === 'running' ? 'running' : event.status,
							event.message,
							reportPhase,
						);
					},
				});
				workflowSummary = { ...workflowSummary, hostBindingSecretSync };
				await appendPhase(phases, 'host_binding_secret_sync', 'completed', 'Synced host-bound environment entries.', reportPhase);
			} catch (error) {
				const result = error instanceof ProjectLaunchSecretSyncError ? error.result : null;
				workflowSummary = { ...workflowSummary, hostBindingSecretSync: result };
				await appendPhase(phases, 'host_binding_secret_sync', 'failed', error instanceof Error ? error.message : String(error), reportPhase);
				throw new KnowledgeHubProviderLaunchError(
					'host_binding_secret_sync_failed',
					error instanceof Error ? error.message : String(error),
					phases,
				);
			}
		}
		const githubEnvironmentSync = [];
		for (const [scope, valuesOverlay] of scopedEnvironmentOverlays) {
			githubEnvironmentSync.push(await syncTreeseedGitHubEnvironment({
				tenantRoot: workingRoot,
				scope,
				repository: repository.slug,
				valuesOverlay,
				execution: 'sequential',
			}));
		}
		workflowSummary = { ...workflowSummary, environmentSync: githubEnvironmentSync };
		runRemoteD1Migrations(workingRoot, { scope: 'staging' });
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
				: phases.some((entry) => entry.phase === 'host_binding_secret_sync' && entry.status === 'running')
					? 'host_binding_secret_sync_failed'
					: phases.some((entry) => entry.phase === 'hosting_registration' && entry.status === 'running')
						? 'hosting_registration_failed'
						: phases.some((entry) => entry.phase === 'workflow_bootstrap' && entry.status === 'running')
							? 'workflow_bootstrap_failed'
							: phases.some((entry) => entry.phase === 'content_bootstrap' && entry.status === 'running')
								? 'content_bootstrap_failed'
								: 'repo_provision_failed'
		);
		const failedPhase = phase.replace(/_failed$/u, '');
		if (!phases.some((entry) => entry.phase === failedPhase && entry.status === 'failed')) {
			await appendPhase(phases, failedPhase, 'failed', message, reportPhase);
		}
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
