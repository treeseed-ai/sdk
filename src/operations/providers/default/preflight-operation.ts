import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, relative, resolve } from 'node:path';
import { RemoteAuthClient, RemoteClient } from '../../../entrypoints/clients/remote.ts';
import { classifyGitMode, runGitText } from '../../services/operations/git-runner.ts';
import {
	findOperation,
	TRESEED_OPERATION_SPECS,
} from '../../operations-registry.ts';
import type {
	OperationContext,
	OperationImplementation,
	OperationMetadata,
	OperationProvider,
	OperationResult,
} from '../../operations-types.ts';
import {
	clearRemoteSession,
	inspectKeyAgentStatus,
	lockSecretSession,
	migrateMachineKeyToWrapped,
	resolveLaunchEnvironment,
	resolveRemoteConfig,
	rotateMachineKey,
	rotateMachineKeyPassphrase,
	setRemoteSession,
	MACHINE_KEY_PASSPHRASE_ENV,
	KeyAgentError,
	unlockSecretSessionFromEnv,
} from '../../services/configuration/config-runtime.ts';
import {
	createPersistentDeployTarget,
	deployTargetLabel,
	ensureGeneratedWranglerConfig,
	finalizeDeploymentState,
	loadDeployState,
} from '../../services/hosting/deployment/deploy.ts';
import {
	PRODUCTION_BRANCH,
	STAGING_BRANCH,
} from '../../services/operations/git-workflow.ts';
import {
	loadCliDeployConfig,
	packageScriptPath,
	resolveWranglerBin,
} from '../../services/agents/runtime-tools.ts';
import {
	scaffoldTemplateProject,
	listTemplateProducts,
	recordTemplateHostBindingState,
	resolveTemplateDefinition,
	resolveTemplateProduct,
	serializeTemplateRegistryEntry,
	syncTemplateProject,
	validateTemplateProduct,
} from '../../services/support/template-registry.ts';
import { applyProjectLaunchHostBindingConfig } from '../../services/hosting/deployment/template-host-bindings.ts';
import { validateKnowledgeHubProviderLaunchPrerequisites } from '../../services/capacity/providers/hub-provider-launch.ts';
import { publishProjectContent } from '../../services/projects/projects-core/project-platform.ts';
import {
	createKnowledgeHubRepositories,
	executeKnowledgeHubLaunch,
	planKnowledgeHubLaunch,
	validateRepositoryHost,
	type KnowledgeHubLaunchIntent,
	type KnowledgeHubRepositoryPlan,
	type RepositoryHost,
} from '../../services/support/hub-launch.ts';
import {
	collectCliPreflight,
	formatCliPreflightReport,
} from '../../services/treedx/workspaces/workspace-preflight.ts';
import { repoRoot } from '../../services/treedx/workspaces/workspace-save.ts';
import { DEFAULT_STARTER_TEMPLATE_ID } from '../../../entrypoints/models/sdk-types.ts';
import {
	parseProjectLaunchHostBindingSpecs,
	resolveProjectLaunchHostBindings,
} from '../../../entrypoints/templates/template-launch-requirements.ts';
import { run } from '../../services/treedx/workspaces/workspace-tools.ts';
import { resolveWorkflowState } from '../../workflow-state.ts';
import { WorkflowError, WorkflowSdk } from '../../workflow.ts';
import {
	collectToolStatus,
	formatDependencyReport,
	installDependencies,
} from '../../../entrypoints/runtime/managed-dependencies.ts';
import { BaseOperation, contextEnv, failureResult, operationResult, withTemporaryProcessEnv } from './run-git.ts';

export class PreflightOperation extends BaseOperation<{ requireAuth?: boolean }> {
	constructor(name: string, private readonly requireAuth = false) {
		super(name);
	}

	async execute(input: { requireAuth?: boolean; launch?: boolean; managedLaunch?: boolean }, context: OperationContext) {
		const report = collectCliPreflight({
			cwd: context.cwd,
			requireAuth: input.requireAuth ?? this.requireAuth,
		});
		const launch = input.launch === true || input.managedLaunch === true
			? await validateKnowledgeHubProviderLaunchPrerequisites(context.cwd)
			: null;
		const stdout = [formatCliPreflightReport(report)];
		if (launch) {
			stdout.push(
				'',
				'Knowledge Hub launch preflight',
				`- ok: ${launch.ok ? 'yes' : 'no'}`,
				`- commands: git=${launch.commands.git ? 'ok' : 'missing'}, gh=${launch.commands.gh ? 'ok' : 'missing'}, wrangler=${launch.commands.wrangler ? 'ok' : 'missing'}, railway=${launch.commands.railway ? 'ok' : 'missing'}`,
			);
			if (launch.missingConfig.length > 0) {
				stdout.push(...launch.missingConfig.map((item) => `- missing config: ${item}`));
			}
			if (launch.providerChecks.issues.length > 0) {
				stdout.push(...launch.providerChecks.issues.map((item) => `- provider issue: ${item}`));
			}
		}
		for (const line of stdout) context.write?.(line, 'stdout');
		const ok = report.ok && (!launch || launch.ok);
		return operationResult(this.metadata, {
			...report,
			launch,
		}, {
			ok,
			exitCode: ok ? 0 : 1,
			stdout,
			stderr: [],
		});
	}
}

export class InitOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, context: OperationContext) {
		const directory = String(input.directory ?? input.target ?? '').trim();
		if (!directory) {
			return failureResult(this.metadata, 'Init requires a target directory.');
		}
		const templateId = String(input.template ?? DEFAULT_STARTER_TEMPLATE_ID);
		const writeWarning = (message: string) => context.write?.(message, 'stderr');
		const templateOptions = {
			cwd: context.cwd,
			env: contextEnv(context),
			writeWarning,
		};
		const targetRoot = resolve(context.cwd, directory);
		const projectSlug = typeof input.slug === 'string' && input.slug.trim()
			? input.slug.trim()
			: directory.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
		const projectName = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : directory;
		const siteUrl = typeof input.siteUrl === 'string' ? input.siteUrl : null;
		const domains = (() => {
			if (!siteUrl) return null;
			try {
				const hostname = new URL(siteUrl).hostname;
				return hostname ? {
					productionDomain: hostname,
					stagingDomain: `staging.${hostname}`,
				} : null;
			} catch {
				return null;
			}
		})();
		const hostBindingSpecs = [
			...(Array.isArray(input.hostBindingSpecs) ? input.hostBindingSpecs.map(String) : typeof input.hostBindingSpecs === 'string' ? [input.hostBindingSpecs] : []),
			...(Array.isArray(input.host) ? input.host.map(String) : typeof input.host === 'string' ? [input.host] : []),
		];
		const templateDefinition = await resolveTemplateDefinition(templateId, templateOptions);
		const resolvedHostBindingState = hostBindingSpecs.length > 0
			? (() => {
				const parsed = parseProjectLaunchHostBindingSpecs({
					specs: hostBindingSpecs,
					launchRequirements: templateDefinition.manifest.launchRequirements,
				});
				const resolved = resolveProjectLaunchHostBindings({
					hostBindings: parsed.hostBindings,
					launchRequirements: templateDefinition.manifest.launchRequirements,
					repositoryHosts: parsed.repositoryHosts,
					teamHosts: parsed.teamHosts,
					managedHosts: parsed.managedHosts,
					projectSlug,
					projectName,
					domains,
					standardProjectLaunch: true,
				});
				return {
					parsed,
					resolved,
					state: {
						hostBindings: resolved.hostBindings,
						hostBindingPlans: {
							configWrites: resolved.configWritePlan,
							secretDeployment: resolved.secretDeploymentPlan,
						},
						hostBindingSummaries: [...parsed.summaries, ...parsed.omitted],
						hostBindingConfig: null,
					},
				};
			})()
			: null;
		const launchPlan = planKnowledgeHubLaunch({
			team: { id: typeof input.teamId === 'string' ? input.teamId : 'local' },
			hub: {
				name: projectName,
				slug: projectSlug,
				visibility: 'team',
			},
			source: {
				kind: 'template',
				ref: templateId,
			},
			repository: {
				topology: input.repositoryTopology === 'split_software_content' ? 'split_software_content' : 'combined_compatibility',
				provider: 'github',
			},
			hosting: { mode: 'self_hosted' },
		});
		const definition = await scaffoldTemplateProject(
			templateId,
			targetRoot,
			{
				target: directory,
				name: projectName,
				slug: projectSlug,
				siteUrl,
				contactEmail: typeof input.contactEmail === 'string' ? input.contactEmail : null,
				repositoryUrl: typeof input.repositoryUrl === 'string' ? input.repositoryUrl : typeof input.repo === 'string' ? input.repo : null,
				discordUrl: typeof input.discordUrl === 'string' ? input.discordUrl : typeof input.discord === 'string' ? input.discord : undefined,
				hostBindingState: resolvedHostBindingState?.state ?? null,
			},
			templateOptions,
		);
		const hostBindingConfig = resolvedHostBindingState
			? applyProjectLaunchHostBindingConfig({
				projectRoot: targetRoot,
				hostBindings: resolvedHostBindingState.resolved.hostBindings,
				hostBindingPlans: resolvedHostBindingState.state.hostBindingPlans,
				launchInput: {
					projectSlug,
					projectName,
					repoName: projectSlug,
					domains,
				},
				derived: {
					projectSlug,
					projectName,
					repositoryName: projectSlug,
				},
			})
			: null;
		if (resolvedHostBindingState && hostBindingConfig) {
			recordTemplateHostBindingState(targetRoot, {
				...resolvedHostBindingState.state,
				hostBindingConfig,
			});
		}
		return operationResult(this.metadata, {
			directory,
			template: definition.id,
			hostBindings: resolvedHostBindingState?.resolved.hostBindings ?? {},
			hostBindingPlans: resolvedHostBindingState?.state.hostBindingPlans ?? null,
			hostBindingSummaries: resolvedHostBindingState?.state.hostBindingSummaries ?? [],
			hostBindingConfig,
			launchPlan,
		});
	}
}

export class TemplateOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, context: OperationContext) {
		const action = String(input.action ?? 'list');
		const target = typeof input.id === 'string' ? input.id : typeof input.target === 'string' ? input.target : undefined;
		const writeWarning = (message: string) => context.write?.(message, 'stderr');
		if (action === 'show') {
			if (!target) {
				return failureResult(this.metadata, 'Template show requires an id.');
			}
			return operationResult(this.metadata, {
				action,
				template: serializeTemplateRegistryEntry(await resolveTemplateProduct(target, { writeWarning })),
			});
		}
		if (action === 'validate') {
			const products = target ? [await resolveTemplateProduct(target, { writeWarning })] : await listTemplateProducts({ writeWarning });
			for (const product of products) {
				await validateTemplateProduct(product, { writeWarning });
			}
			return operationResult(this.metadata, {
				action,
				validated: products.map((product) => product.id),
			});
		}
		return operationResult(this.metadata, {
			action: 'list',
			templates: (await listTemplateProducts({ writeWarning })).map((product) => serializeTemplateRegistryEntry(product)),
		});
	}
}

export class SyncTemplateOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, context: OperationContext) {
		const changed = await syncTemplateProject(context.cwd, {
			check: input.check === true,
			writeWarning: (message) => context.write?.(message, 'stderr'),
		});
		return operationResult(this.metadata, {
			check: input.check === true,
			changed,
		}, {
			ok: input.check === true ? changed.length === 0 : true,
			exitCode: input.check === true && changed.length > 0 ? 1 : 0,
		});
	}
}

export class HubPlanLaunchOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, _context: OperationContext) {
		const intent = (input.intent && typeof input.intent === 'object' ? input.intent : input) as KnowledgeHubLaunchIntent;
		return operationResult(this.metadata, planKnowledgeHubLaunch(intent));
	}
}

export class HubValidateLaunchOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, _context: OperationContext) {
		try {
			const intent = (input.intent && typeof input.intent === 'object' ? input.intent : input) as KnowledgeHubLaunchIntent;
			const plan = planKnowledgeHubLaunch(intent);
			return operationResult(this.metadata, {
				ok: true,
				issues: [],
				plan,
			});
		} catch (error) {
			return operationResult(this.metadata, {
				ok: false,
				issues: [error instanceof Error ? error.message : String(error)],
			}, {
				ok: false,
				exitCode: 1,
			});
		}
	}
}

export class HubExecuteLaunchOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, context: OperationContext) {
		const intent = (input.intent && typeof input.intent === 'object' ? input.intent : input) as KnowledgeHubLaunchIntent;
		const result = await withTemporaryProcessEnv(contextEnv(context), () => executeKnowledgeHubLaunch(intent, {
			onPhase: async (phase) => {
				await context.onProgress?.({
					kind: 'hub_launch_phase',
					...phase,
				});
			},
		}));
		return operationResult(this.metadata, result);
	}
}
