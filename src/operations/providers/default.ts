import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { RemoteTreeseedAuthClient, RemoteTreeseedClient } from '../../remote.ts';
import { classifyTreeseedGitMode, runTreeseedGitText } from '../../operations/services/git-runner.ts';
import {
	findTreeseedOperation,
	TRESEED_OPERATION_SPECS,
} from '../../operations-registry.ts';
import type {
	TreeseedOperationContext,
	TreeseedOperationImplementation,
	TreeseedOperationMetadata,
	TreeseedOperationProvider,
	TreeseedOperationResult,
} from '../../operations-types.ts';
import {
	clearTreeseedRemoteSession,
	inspectTreeseedKeyAgentStatus,
	lockTreeseedSecretSession,
	migrateTreeseedMachineKeyToWrapped,
	resolveTreeseedLaunchEnvironment,
	resolveTreeseedRemoteConfig,
	rotateTreeseedMachineKey,
	rotateTreeseedMachineKeyPassphrase,
	setTreeseedRemoteSession,
	TREESEED_MACHINE_KEY_PASSPHRASE_ENV,
	TreeseedKeyAgentError,
	unlockTreeseedSecretSessionFromEnv,
} from '../../operations/services/config-runtime.ts';
import {
	createPersistentDeployTarget,
	deployTargetLabel,
	ensureGeneratedWranglerConfig,
	finalizeDeploymentState,
	loadDeployState,
} from '../../operations/services/deploy.ts';
import {
	PRODUCTION_BRANCH,
	STAGING_BRANCH,
} from '../../operations/services/git-workflow.ts';
import {
	dockerIsAvailable,
	findRunningMailpitContainer,
	stopKnownMailpitContainers,
} from '../../operations/services/mailpit-runtime.ts';
import {
	loadCliDeployConfig,
	packageScriptPath,
	resolveWranglerBin,
} from '../../operations/services/runtime-tools.ts';
import {
	scaffoldTemplateProject,
	listTemplateProducts,
	recordTemplateHostBindingState,
	resolveTemplateDefinition,
	resolveTemplateProduct,
	serializeTemplateRegistryEntry,
	syncTemplateProject,
	validateTemplateProduct,
} from '../../operations/services/template-registry.ts';
import { applyProjectLaunchHostBindingConfig } from '../../operations/services/template-host-bindings.ts';
import { validateKnowledgeHubProviderLaunchPrerequisites } from '../../operations/services/hub-provider-launch.ts';
import { publishProjectContent } from '../../operations/services/project-platform.ts';
import {
	createKnowledgeHubRepositories,
	executeKnowledgeHubLaunch,
	planKnowledgeHubLaunch,
	validateRepositoryHost,
	type KnowledgeHubLaunchIntent,
	type KnowledgeHubRepositoryPlan,
	type RepositoryHost,
} from '../../operations/services/hub-launch.ts';
import {
	collectCliPreflight,
	formatCliPreflightReport,
} from '../../operations/services/workspace-preflight.ts';
import { repoRoot } from '../../operations/services/workspace-save.ts';
import { TREESEED_DEFAULT_STARTER_TEMPLATE_ID } from '../../sdk-types.ts';
import {
	parseProjectLaunchHostBindingSpecs,
	resolveProjectLaunchHostBindings,
} from '../../template-launch-requirements.ts';
import { run } from '../../operations/services/workspace-tools.ts';
import { resolveTreeseedWorkflowState } from '../../workflow-state.ts';
import { TreeseedWorkflowError, TreeseedWorkflowSdk } from '../../workflow.ts';
import {
	collectTreeseedToolStatus,
	formatTreeseedDependencyReport,
	installTreeseedDependencies,
} from '../../managed-dependencies.ts';

function runGit(args: string[], options: { cwd: string; capture?: boolean; timeoutMs?: number; maxBuffer?: number }) {
	return runTreeseedGitText(args, {
		cwd: options.cwd,
		mode: classifyTreeseedGitMode(args),
		timeoutMs: options.timeoutMs,
		maxBuffer: options.maxBuffer,
	});
}

function operationResult<TPayload>(
	metadata: TreeseedOperationMetadata,
	payload: TPayload,
	options: Partial<TreeseedOperationResult<TPayload>> = {},
): TreeseedOperationResult<TPayload> {
	return {
		operation: metadata.id,
		ok: options.ok ?? true,
		payload,
		meta: options.meta,
		nextSteps: options.nextSteps,
		exitCode: options.exitCode ?? (options.ok === false ? 1 : 0),
		stdout: options.stdout,
		stderr: options.stderr,
		report: options.report,
	};
}

function failureResult(
	metadata: TreeseedOperationMetadata,
	message: string,
	options: Partial<TreeseedOperationResult> = {},
): TreeseedOperationResult {
	return operationResult(metadata, null, {
		ok: false,
		exitCode: options.exitCode ?? 1,
		stderr: [message],
		meta: options.meta,
	});
}

function contextEnv(context: TreeseedOperationContext) {
	return { ...process.env, ...(context.env ?? {}) };
}

async function withTemporaryProcessEnv<T>(env: Record<string, string | undefined>, action: () => Promise<T>) {
	const previous = new Map<string, string | undefined>();
	for (const [key, value] of Object.entries(env)) {
		previous.set(key, process.env[key]);
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
	try {
		return await action();
	} finally {
		for (const [key, value] of previous) {
			if (value === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}
	}
}

function operationEnv(context: TreeseedOperationContext) {
	const tenantConfigPath = resolve(context.cwd, 'treeseed.site.yaml');
	return existsSync(tenantConfigPath)
		? resolveTreeseedLaunchEnvironment({ tenantRoot: context.cwd, scope: 'local', baseEnv: contextEnv(context) })
		: contextEnv(context);
}

function runNodeScript(
	metadata: TreeseedOperationMetadata,
	scriptName: string,
	args: string[],
	context: TreeseedOperationContext,
) {
	if (context.spawn) {
		const result = context.spawn(process.execPath, [packageScriptPath(scriptName), ...args], {
			cwd: context.cwd,
			env: operationEnv(context),
			stdio: 'inherit',
		});
		return operationResult(metadata, {
			script: scriptName,
			args,
		}, {
			ok: (result.status ?? 1) === 0,
			exitCode: result.status ?? 1,
		});
	}
	const result = spawnSync(process.execPath, [packageScriptPath(scriptName), ...args], {
		cwd: context.cwd,
		env: operationEnv(context),
		encoding: 'utf8',
		stdio: 'pipe',
	});
	const stdout = (result.stdout ?? '').split(/\r?\n/).filter(Boolean);
	const stderr = (result.stderr ?? '').split(/\r?\n/).filter(Boolean);
	for (const line of stdout) context.write?.(line, 'stdout');
	for (const line of stderr) context.write?.(line, 'stderr');
	return operationResult(metadata, {
		script: scriptName,
		args,
	}, {
		ok: (result.status ?? 1) === 0,
		exitCode: result.status ?? 1,
		stdout,
		stderr,
	});
}

function copyTreeseedOperationalState(sourceRoot: string, targetRoot: string) {
	const sourceTreeseedRoot = resolve(sourceRoot, '.treeseed');
	if (!existsSync(sourceTreeseedRoot)) {
		return;
	}
	copyDirectory(sourceTreeseedRoot, resolve(targetRoot, '.treeseed'));
}

function copyDirectory(sourceDir: string, targetDir: string) {
	mkdirSync(targetDir, { recursive: true });
	for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
		const sourcePath = resolve(sourceDir, entry.name);
		const targetPath = resolve(targetDir, entry.name);
		if (entry.isDirectory()) {
			copyDirectory(sourcePath, targetPath);
			continue;
		}
		writeFileSync(targetPath, readFileSync(sourcePath));
	}
}

function copyFileIfExists(sourceFile: string, targetFile: string) {
	if (!existsSync(sourceFile)) return;
	mkdirSync(resolve(targetFile, '..'), { recursive: true });
	writeFileSync(targetFile, readFileSync(sourceFile));
}

function prepareContentPublishRoot(tenantRoot: string, contentRepositoryRoot: string | null) {
	if (!contentRepositoryRoot || resolve(contentRepositoryRoot) === resolve(tenantRoot)) {
		return { root: tenantRoot, cleanup: () => {} };
	}
	const tempRoot = mkdtempSync(join(tmpdir(), 'treeseed-content-repo-publish-'));
	copyFileIfExists(resolve(tenantRoot, 'treeseed.site.yaml'), resolve(tempRoot, 'treeseed.site.yaml'));
	copyFileIfExists(resolve(tenantRoot, 'package.json'), resolve(tempRoot, 'package.json'));
	copyFileIfExists(resolve(tenantRoot, 'src', 'manifest.yaml'), resolve(tempRoot, 'src', 'manifest.yaml'));
	copyTreeseedOperationalState(tenantRoot, tempRoot);
	const contentSource = resolve(contentRepositoryRoot, 'src', 'content');
	if (existsSync(contentSource)) {
		copyDirectory(contentSource, resolve(tempRoot, 'src', 'content'));
	}
	const publicSource = resolve(contentRepositoryRoot, 'public');
	if (existsSync(publicSource)) {
		copyDirectory(publicSource, resolve(tempRoot, 'public'));
	}
	return {
		root: tempRoot,
		cleanup: () => rmSync(tempRoot, { recursive: true, force: true }),
	};
}

function workflowInputForOperation(name: string, input: Record<string, unknown>) {
	switch (name) {
		case 'status':
		case 'tasks':
			return {};
		default:
			return input;
	}
}

abstract class BaseOperation<TInput extends Record<string, unknown> = Record<string, unknown>> implements TreeseedOperationImplementation<TInput> {
	readonly metadata: TreeseedOperationMetadata;

	constructor(name: string) {
		const metadata = findTreeseedOperation(name);
		if (!metadata) {
			throw new Error(`Unknown operation metadata for "${name}".`);
		}
		this.metadata = metadata;
	}

	abstract execute(input: TInput, context: TreeseedOperationContext): Promise<TreeseedOperationResult>;
}

class WorkflowOperation extends BaseOperation {
	private readonly workflowName: Parameters<TreeseedWorkflowSdk['execute']>[0];

	constructor(name: string, workflowName?: Parameters<TreeseedWorkflowSdk['execute']>[0]) {
		super(name);
		this.workflowName = workflowName ?? (name === 'switch' ? 'switch' : name as Parameters<TreeseedWorkflowSdk['execute']>[0]);
	}

	async execute(input: Record<string, unknown>, context: TreeseedOperationContext) {
		try {
			const workflow = new TreeseedWorkflowSdk({
				cwd: context.cwd,
				env: context.env,
				write: context.write,
				prompt: context.prompt,
				confirm: context.confirm,
				transport: context.transport ?? 'sdk',
			});
			return await workflow.execute(this.workflowName, workflowInputForOperation(this.metadata.name, input));
		} catch (error) {
			if (error instanceof TreeseedWorkflowError) {
				return failureResult(this.metadata, error.message, {
					exitCode: error.exitCode ?? 1,
					meta: {
						code: error.code,
						details: error.details ?? null,
					},
				});
			}
			throw error;
		}
	}
}

class ScriptOperation extends BaseOperation {
	constructor(name: string, private readonly scriptName: string, private readonly extraArgs: string[] = []) {
		super(name);
	}

	async execute(input: Record<string, unknown>, context: TreeseedOperationContext) {
		const args = Array.isArray(input.args) ? input.args.map(String) : [];
		return runNodeScript(this.metadata, this.scriptName, [...this.extraArgs, ...args], context);
	}
}

class PreflightOperation extends BaseOperation<{ requireAuth?: boolean }> {
	constructor(name: string, private readonly requireAuth = false) {
		super(name);
	}

	async execute(input: { requireAuth?: boolean; launch?: boolean; managedLaunch?: boolean }, context: TreeseedOperationContext) {
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

class InitOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, context: TreeseedOperationContext) {
		const directory = String(input.directory ?? input.target ?? '').trim();
		if (!directory) {
			return failureResult(this.metadata, 'Init requires a target directory.');
		}
		const templateId = String(input.template ?? TREESEED_DEFAULT_STARTER_TEMPLATE_ID);
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

class TemplateOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, context: TreeseedOperationContext) {
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

class SyncTemplateOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, context: TreeseedOperationContext) {
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

class HubPlanLaunchOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, _context: TreeseedOperationContext) {
		const intent = (input.intent && typeof input.intent === 'object' ? input.intent : input) as KnowledgeHubLaunchIntent;
		return operationResult(this.metadata, planKnowledgeHubLaunch(intent));
	}
}

class HubValidateLaunchOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, _context: TreeseedOperationContext) {
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

class HubExecuteLaunchOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, context: TreeseedOperationContext) {
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

class HubResumeLaunchOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, context: TreeseedOperationContext) {
		const intent = (input.intent && typeof input.intent === 'object' ? input.intent : input) as KnowledgeHubLaunchIntent;
		const result = await withTemporaryProcessEnv(contextEnv(context), () => executeKnowledgeHubLaunch(intent, {
			onPhase: async (phase) => {
				await context.onProgress?.({
					kind: 'hub_launch_phase',
					resumed: true,
					...phase,
				});
			},
		}));
		return operationResult(this.metadata, {
			resumed: true,
			...result,
		});
	}
}

function plainObject(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown, fallback = '') {
	return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function arrayOfStrings(value: unknown) {
	return Array.isArray(value) ? value.map((entry) => String(entry)).filter(Boolean) : [];
}

function normalizeUpdatePlan(input: Record<string, unknown>, cwd: string) {
	const source = plainObject(input.source);
	const sourceKind = stringValue(input.sourceKind ?? source.kind, 'template');
	const sourceRef = stringValue(input.sourceRef ?? source.ref, '');
	const sourceVersion = stringValue(input.sourceVersion ?? source.version, '');
	const requestedChanges = Array.isArray(input.changes) ? input.changes : [];
	const changedPaths = requestedChanges.length > 0
		? requestedChanges.flatMap((change) => {
			const entry = plainObject(change);
			return stringValue(entry.path) ? [String(entry.path)] : arrayOfStrings(entry.paths);
		})
		: arrayOfStrings(input.changedPaths);
	const safeConfigOnly = input.safeConfigOnly === true || input.updateKind === 'runtime_config';
	const behaviorChanges = arrayOfStrings(input.behaviorChanges);
	const contentChanges = changedPaths.filter((path) => path.startsWith('src/content/') || path.startsWith('content/'));
	const requiresDecision = input.requiresDecision === true
		|| (!safeConfigOnly && (contentChanges.length > 0 || behaviorChanges.length > 0 || ['template', 'knowledge_pack', 'market_listing'].includes(sourceKind)));
	const conflicts = arrayOfStrings(input.conflicts).map((path) => ({
		path,
		reason: 'caller_reported_conflict',
	}));
	return {
		state: 'planned',
		hubId: stringValue(input.hubId ?? input.projectId, ''),
		sourceKind,
		sourceRef: sourceRef || null,
		sourceVersion: sourceVersion || null,
		changedPaths,
		conflicts,
		requiredDecisions: requiresDecision
			? [{
				kind: 'binding_update',
				reason: safeConfigOnly ? 'approval_policy' : 'template_or_content_change',
				decisionId: stringValue(input.decisionId, '') || null,
			}]
			: [],
		requiresDecision,
		repositoryTargets: plainObject(input.repositoryTargets),
		provenance: {
			sourceKind,
			sourceRef: sourceRef || null,
			sourceVersion: sourceVersion || null,
			plannedAt: new Date().toISOString(),
		},
		workspace: plainObject(input.workspace),
		tenantRoot: stringValue(input.tenantRoot, cwd),
	};
}

function writeJsonFile(path: string, value: unknown) {
	mkdirSync(resolve(path, '..'), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function workspaceAttachPlan(input: Record<string, unknown>, cwd: string) {
	const parent = plainObject(input.parent ?? input.parentRepository);
	const software = plainObject(input.softwareRepository);
	const content = plainObject(input.contentRepository);
	const hubMountPath = stringValue(input.hubMountPath, 'docs');
	const softwareSubmodulePath = stringValue(input.softwareSubmodulePath, `${hubMountPath}/hub-site`);
	const contentSubmodulePath = stringValue(input.contentSubmodulePath, `${hubMountPath}/hub-content`);
	const issues: string[] = [];
	if (!stringValue(parent.owner) && !stringValue(parent.url)) issues.push('Parent repository owner/url is required.');
	if (!stringValue(parent.name) && !stringValue(parent.url)) issues.push('Parent repository name/url is required.');
	if (!stringValue(software.url) && !stringValue(software.name)) issues.push('Software repository url/name is required.');
	if (!stringValue(content.url) && !stringValue(content.name)) issues.push('Content repository url/name is required.');
	return {
		state: issues.length > 0 ? 'invalid' : 'planned',
		issues,
		hubId: stringValue(input.hubId ?? input.projectId, ''),
		tenantRoot: stringValue(input.tenantRoot, cwd),
		parentRepository: parent,
		softwareRepository: software,
		contentRepository: content,
		hubMountPath,
		softwareSubmodulePath,
		contentSubmodulePath,
		updateSubmodulePointersEnabled: input.updateSubmodulePointersEnabled === true,
		allowedWriteTargets: arrayOfStrings(input.allowedWriteTargets).length > 0 ? arrayOfStrings(input.allowedWriteTargets) : ['content'],
		contentOverlay: stringValue(input.contentOverlay, 'src_content_when_present'),
	};
}

class HubPlanUpdateOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, context: TreeseedOperationContext) {
		return operationResult(this.metadata, normalizeUpdatePlan(input, context.cwd));
	}
}

class HubValidateUpdateOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, _context: TreeseedOperationContext) {
		const issues: string[] = [];
		if (!input.hubId && !input.projectId) issues.push('hubId or projectId is required.');
		if (!input.sourceKind) issues.push('sourceKind is required.');
		return operationResult(this.metadata, {
			ok: issues.length === 0,
			issues,
		}, {
			ok: issues.length === 0,
			exitCode: issues.length === 0 ? 0 : 1,
		});
	}
}

class HubExecuteUpdateOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, context: TreeseedOperationContext) {
		const plan = normalizeUpdatePlan(plainObject(input.plan).state ? plainObject(input.plan) : input, context.cwd);
		const decisionApproved = input.decisionApproved === true || typeof input.decisionId === 'string' || typeof input.approvedDecisionId === 'string';
		if (plan.requiresDecision && !decisionApproved) {
			const proposal = {
				kind: 'treeseed_update_proposal',
				plan,
				createdAt: new Date().toISOString(),
				reason: 'Decision required before binding template, pack, content, or behavior changes.',
			};
			const proposalPath = resolve(plan.tenantRoot, '.treeseed', 'proposals', `update-${Date.now()}.json`);
			writeJsonFile(proposalPath, proposal);
			return operationResult(this.metadata, {
				state: 'waiting_for_decision',
				applied: false,
				requiresDecision: true,
				proposalPath: relative(plan.tenantRoot, proposalPath),
				plan,
			});
		}
		const appliedPath = resolve(plan.tenantRoot, '.treeseed', 'updates', `applied-${Date.now()}.json`);
		writeJsonFile(appliedPath, {
			kind: 'treeseed_safe_update_application',
			plan,
			decisionApproved,
			appliedAt: new Date().toISOString(),
		});
		return operationResult(this.metadata, {
			state: 'applied',
			applied: true,
			requiresDecision: plan.requiresDecision,
			appliedPath: relative(plan.tenantRoot, appliedPath),
			plan,
		});
	}
}

class HubResumeUpdateOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, context: TreeseedOperationContext) {
		const executor = new HubExecuteUpdateOperation(this.metadata.name);
		return executor.execute({ ...input, resumed: true }, context);
	}
}

class RepositoryHostValidateOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, _context: TreeseedOperationContext) {
		const host = (input.host && typeof input.host === 'object' ? input.host : input) as RepositoryHost;
		const result = validateRepositoryHost(host);
		return operationResult(this.metadata, {
			...result,
			validatedAt: new Date().toISOString(),
		}, {
			ok: result.ok,
			exitCode: result.ok ? 0 : 1,
		});
	}
}

class RepositoryHostCreateRepositoriesOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, _context: TreeseedOperationContext) {
		const plan = input.plan as KnowledgeHubRepositoryPlan | undefined;
		if (!plan) {
			return failureResult(this.metadata, 'repository_host.create_repositories requires a repository plan.');
		}
		return operationResult(this.metadata, await createKnowledgeHubRepositories({
			plan,
			dryRun: input.dryRun === true,
			description: typeof input.description === 'string' ? input.description : null,
			homepageUrl: typeof input.homepageUrl === 'string' ? input.homepageUrl : null,
		}));
	}
}

class ContentVerifyPackageOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, context: TreeseedOperationContext) {
		const tenantRoot = typeof input.tenantRoot === 'string' ? input.tenantRoot : context.cwd;
		const contentRoot = resolve(tenantRoot, 'src', 'content');
		return operationResult(this.metadata, {
			ok: existsSync(contentRoot),
			packageRef: typeof input.packageRef === 'string' ? input.packageRef : null,
			contentRoot,
			issues: existsSync(contentRoot) ? [] : [`Missing content root: ${contentRoot}`],
		});
	}
}

class ContentPublishOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, context: TreeseedOperationContext) {
		const tenantRoot = typeof input.tenantRoot === 'string' ? input.tenantRoot : context.cwd;
		const contentRepositoryRoot = typeof input.contentRepositoryRoot === 'string'
			? input.contentRepositoryRoot
			: typeof input.contentRoot === 'string'
				? input.contentRoot
				: null;
		const scope = input.scope === 'staging' || input.scope === 'prod' || input.scope === 'local'
			? input.scope
			: 'prod';
		if (input.dryRun === true) {
			return operationResult(this.metadata, {
				status: 'planned',
				tenantRoot,
				contentRepositoryRoot,
				scope,
				publishTarget: typeof input.publishTarget === 'string' ? input.publishTarget : 'r2_published_artifacts',
			});
		}
		const preparedRoot = prepareContentPublishRoot(tenantRoot, contentRepositoryRoot);
		try {
			const result = await publishProjectContent({
				tenantRoot: preparedRoot.root,
				scope,
				projectId: typeof input.projectId === 'string' ? input.projectId : null,
				previewId: typeof input.previewId === 'string' ? input.previewId : null,
				env: context.env,
			});
			return operationResult(this.metadata, {
				status: 'published',
				scope,
				tenantRoot,
				contentRepositoryRoot,
				result,
				publishTarget: 'r2_published_artifacts',
				contentSource: contentRepositoryRoot ? 'content_repository' : 'tenant_root',
				r2: {
					bucketName: context.env?.TREESEED_CONTENT_BUCKET_NAME ?? process.env.TREESEED_CONTENT_BUCKET_NAME ?? null,
					publicBaseUrl: context.env?.TREESEED_CONTENT_PUBLIC_BASE_URL ?? process.env.TREESEED_CONTENT_PUBLIC_BASE_URL ?? null,
				},
			});
		} finally {
			preparedRoot.cleanup();
		}
	}
}

class WorkspacePlanAttachParentOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, context: TreeseedOperationContext) {
		const plan = workspaceAttachPlan(input, context.cwd);
		return operationResult(this.metadata, {
			...plan,
			requiresTechnicalStewardApproval: true,
		}, {
			ok: plan.issues.length === 0,
			exitCode: plan.issues.length === 0 ? 0 : 1,
		});
	}
}

class WorkspaceAttachParentOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, context: TreeseedOperationContext) {
		const plan = workspaceAttachPlan(plainObject(input.plan).state ? plainObject(input.plan) : input, context.cwd);
		if (plan.issues.length > 0) {
			return operationResult(this.metadata, {
				state: 'invalid',
				attached: false,
				issues: plan.issues,
				plan,
			}, {
				ok: false,
				exitCode: 1,
			});
		}
		const manifest = {
			schemaVersion: 1,
			kind: 'treeseed_composed_workspace',
			hubId: plan.hubId,
			parentRepository: plan.parentRepository,
			softwareRepository: plan.softwareRepository,
			contentRepository: plan.contentRepository,
			mounts: {
				hub: plan.hubMountPath,
				software: plan.softwareSubmodulePath,
				content: plan.contentSubmodulePath,
			},
			updateSubmodulePointersEnabled: plan.updateSubmodulePointersEnabled,
			allowedWriteTargets: plan.allowedWriteTargets,
			credentialScopes: {
				software: ['repository:software'],
				content: ['repository:content'],
				parentWorkspace: plan.updateSubmodulePointersEnabled ? ['repository:parent_workspace'] : [],
			},
			contentOverlay: plan.contentOverlay,
			attachedAt: new Date().toISOString(),
		};
		const manifestPath = resolve(plan.tenantRoot, '.treeseed', 'workspace.json');
		writeJsonFile(manifestPath, manifest);
		return operationResult(this.metadata, {
			state: 'attached',
			attached: true,
			manifestPath: relative(plan.tenantRoot, manifestPath),
			manifest,
			plan,
		});
	}
}

class WorkspaceUpdateSubmodulePointersOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, context: TreeseedOperationContext) {
		const plan = workspaceAttachPlan(plainObject(input.workspace).state ? plainObject(input.workspace) : input, context.cwd);
		const hasCapability = input.hasParentWorkspaceCapability === true
			|| arrayOfStrings(input.capabilities).includes('parent_workspace:update_submodule_pointers');
		if (!plan.updateSubmodulePointersEnabled || !hasCapability) {
			return operationResult(this.metadata, {
				state: 'blocked',
				updated: false,
				reason: !plan.updateSubmodulePointersEnabled
					? 'Workspace link does not allow TreeSeed to update submodule pointers.'
					: 'Caller does not have parent workspace capability.',
				softwareRef: stringValue(input.softwareRef) || null,
				contentRef: stringValue(input.contentRef) || null,
			}, {
				ok: false,
				exitCode: 1,
			});
		}
		const pointerPlan = {
			kind: 'treeseed_workspace_submodule_pointer_update',
			hubId: plan.hubId,
			softwareSubmodulePath: plan.softwareSubmodulePath,
			contentSubmodulePath: plan.contentSubmodulePath,
			softwareRef: stringValue(input.softwareRef) || null,
			contentRef: stringValue(input.contentRef) || null,
			updatedAt: new Date().toISOString(),
		};
		const pointerPath = resolve(plan.tenantRoot, '.treeseed', 'workspace-submodule-pointers.json');
		writeJsonFile(pointerPath, pointerPlan);
		return operationResult(this.metadata, {
			state: 'updated',
			updated: true,
			pointerPath: relative(plan.tenantRoot, pointerPath),
			...pointerPlan,
		});
	}
}

class DoctorOperation extends BaseOperation {
	async execute(_input: Record<string, unknown>, context: TreeseedOperationContext) {
		const state = resolveTreeseedWorkflowState(context.cwd);
		const preflight = collectCliPreflight({ cwd: context.cwd, requireAuth: false });
		return operationResult(this.metadata, {
			state,
			preflight,
		}, {
			ok: preflight.ok,
			exitCode: preflight.ok ? 0 : 1,
		});
	}
}

class InstallOperation extends BaseOperation<{ force?: boolean }> {
	async execute(input: { force?: boolean }, context: TreeseedOperationContext) {
		const result = await installTreeseedDependencies({
			tenantRoot: context.cwd,
			force: input.force === true,
			env: context.env,
			write: context.outputFormat === 'json' ? undefined : context.write,
		});
		const stdout = [formatTreeseedDependencyReport(result)];
		return operationResult(this.metadata, result, {
			ok: result.ok,
			exitCode: result.ok ? 0 : 1,
			stdout,
			report: {
				ok: result.ok,
				toolsHome: result.toolsHome,
				ghConfigDir: result.ghConfigDir,
				npmInstalls: result.npmInstalls,
				tools: result.reports,
			},
		});
	}
}

class ToolsOperation extends BaseOperation {
	async execute(_input: Record<string, unknown>, context: TreeseedOperationContext) {
		const result = collectTreeseedToolStatus({
			tenantRoot: context.cwd,
			env: operationEnv(context),
			spawn: context.spawn as typeof spawnSync | undefined,
		});
		const stdout = [
			'Treeseed managed tools',
			`Tools home: ${result.toolsHome}`,
			`GitHub CLI config: ${result.ghConfigDir}`,
			...result.tools.map((entry) => {
				const invocation = entry.invocation.command
					? `${entry.invocation.command}${entry.invocation.argsPrefix.length > 0 ? ` ${entry.invocation.argsPrefix.join(' ')}` : ''}`
					: '(unavailable)';
				return `- ${entry.name}: ${entry.status} (${entry.binaryPath ?? 'no binary'}; ${entry.invocation.mode}; ${invocation})`;
			}),
			`GitHub auth: ${result.auth.github.authenticated ? 'authenticated' : 'not authenticated'} - ${result.auth.github.detail}`,
		];
		return operationResult(this.metadata, result, {
			ok: true,
			exitCode: 0,
			stdout,
			report: {
				ok: true,
				dependenciesOk: result.ok,
				toolsHome: result.toolsHome,
				ghConfigDir: result.ghConfigDir,
				npmInstalls: result.npmInstalls,
				tools: result.tools,
				auth: result.auth,
			},
		});
	}
}

class AuthLoginOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, context: TreeseedOperationContext) {
		const tenantRoot = context.cwd;
		const remoteConfig = resolveTreeseedRemoteConfig(tenantRoot, context.env);
		const hostId = typeof input.host === 'string' ? input.host : remoteConfig.activeHostId;
		const client = new RemoteTreeseedAuthClient(new RemoteTreeseedClient({
			...remoteConfig,
			activeHostId: hostId,
		}));
		const started = await client.startDeviceFlow({
			clientName: 'treeseed-sdk',
			scopes: ['auth:me', 'sdk', 'operations'],
		});
		const deadline = Date.parse(started.expiresAt);
		while (Date.now() < deadline) {
			const response = await client.pollDeviceFlow({ deviceCode: started.deviceCode });
			if (response.ok && response.status === 'approved') {
				setTreeseedRemoteSession(tenantRoot, {
					hostId,
					accessToken: response.accessToken,
					refreshToken: response.refreshToken,
					expiresAt: response.expiresAt,
					principal: response.principal,
				});
				return operationResult(this.metadata, {
					hostId,
					verificationUriComplete: started.verificationUriComplete,
					userCode: started.userCode,
					principal: response.principal,
				});
			}
			if (!response.ok && response.status !== 'already_used') {
				return failureResult(this.metadata, response.error);
			}
			await new Promise((resolveTimer) => setTimeout(resolveTimer, started.intervalSeconds * 1000));
		}
		return failureResult(this.metadata, 'Treeseed API login expired before approval completed.');
	}
}

class AuthLogoutOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, context: TreeseedOperationContext) {
		const remoteConfig = resolveTreeseedRemoteConfig(context.cwd, context.env);
		const hostId = typeof input.host === 'string' ? input.host : remoteConfig.activeHostId;
		clearTreeseedRemoteSession(context.cwd, hostId);
		return operationResult(this.metadata, { hostId });
	}
}

class AuthWhoAmIOperation extends BaseOperation {
	async execute(_input: Record<string, unknown>, context: TreeseedOperationContext) {
		const remoteConfig = resolveTreeseedRemoteConfig(context.cwd, context.env);
		const client = new RemoteTreeseedAuthClient(new RemoteTreeseedClient(remoteConfig));
		const response = await client.whoAmI();
		return operationResult(this.metadata, {
			hostId: remoteConfig.activeHostId,
			principal: response.payload,
		});
	}
}

class SecretsStatusOperation extends BaseOperation {
	async execute(_input: Record<string, unknown>, context: TreeseedOperationContext) {
		return operationResult(this.metadata, {
			status: inspectTreeseedKeyAgentStatus(context.cwd),
		});
	}
}

class SecretsUnlockOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, context: TreeseedOperationContext) {
		try {
			const status = unlockTreeseedSecretSessionFromEnv(context.cwd, {
				allowMigration: input.allowMigration !== false,
				createIfMissing: input.createIfMissing !== false,
			});
			return operationResult(this.metadata, { status });
		} catch (error) {
			if (error instanceof TreeseedKeyAgentError) {
				return failureResult(this.metadata, error.message, { meta: { code: error.code, details: error.details ?? null } });
			}
			throw error;
		}
	}
}

class SecretsLockOperation extends BaseOperation {
	async execute(_input: Record<string, unknown>, context: TreeseedOperationContext) {
		try {
			return operationResult(this.metadata, {
				status: lockTreeseedSecretSession(context.cwd),
			});
		} catch (error) {
			if (error instanceof TreeseedKeyAgentError) {
				return failureResult(this.metadata, error.message, { meta: { code: error.code, details: error.details ?? null } });
			}
			throw error;
		}
	}
}

class SecretsMigrateKeyOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, context: TreeseedOperationContext) {
		const passphrase = String(input.passphrase ?? context.env?.[TREESEED_MACHINE_KEY_PASSPHRASE_ENV] ?? '').trim();
		if (!passphrase) {
			return failureResult(this.metadata, `Set ${TREESEED_MACHINE_KEY_PASSPHRASE_ENV} or pass { passphrase } when migrating the machine key.`);
		}
		try {
			return operationResult(this.metadata, migrateTreeseedMachineKeyToWrapped(context.cwd, passphrase));
		} catch (error) {
			if (error instanceof TreeseedKeyAgentError) {
				return failureResult(this.metadata, error.message, { meta: { code: error.code, details: error.details ?? null } });
			}
			throw error;
		}
	}
}

class SecretsRotatePassphraseOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, context: TreeseedOperationContext) {
		const passphrase = String(input.passphrase ?? context.env?.[TREESEED_MACHINE_KEY_PASSPHRASE_ENV] ?? '').trim();
		if (!passphrase) {
			return failureResult(this.metadata, `Set ${TREESEED_MACHINE_KEY_PASSPHRASE_ENV} or pass { passphrase } when rotating the wrapped-key passphrase.`);
		}
		try {
			return operationResult(this.metadata, rotateTreeseedMachineKeyPassphrase(context.cwd, passphrase));
		} catch (error) {
			if (error instanceof TreeseedKeyAgentError) {
				return failureResult(this.metadata, error.message, { meta: { code: error.code, details: error.details ?? null } });
			}
			throw error;
		}
	}
}

class SecretsRotateMachineKeyOperation extends BaseOperation {
	async execute(_input: Record<string, unknown>, context: TreeseedOperationContext) {
		try {
			return operationResult(this.metadata, rotateTreeseedMachineKey(context.cwd));
		} catch (error) {
			if (error instanceof TreeseedKeyAgentError) {
				return failureResult(this.metadata, error.message, { meta: { code: error.code, details: error.details ?? null } });
			}
			throw error;
		}
	}
}

class RollbackOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, context: TreeseedOperationContext) {
		const scope = typeof input.environment === 'string' ? input.environment : null;
		if (scope !== 'staging' && scope !== 'prod') {
			return failureResult(this.metadata, 'Rollback requires environment "staging" or "prod".');
		}
		const requestedCommit = typeof input.to === 'string' ? input.to : null;
		const tenantRoot = context.cwd;
		const deployConfig = loadCliDeployConfig(tenantRoot);
		const target = createPersistentDeployTarget(scope);
		const state = loadDeployState(tenantRoot, deployConfig, { target }) as Record<string, unknown>;
		const history = Array.isArray(state.deploymentHistory) ? state.deploymentHistory as Array<Record<string, unknown>> : [];
		const latestCommit = typeof state.lastDeployedCommit === 'string' ? state.lastDeployedCommit : null;
		const rollbackEntry = requestedCommit
			? history.find((entry) => entry.commit === requestedCommit) ?? null
			: [...history].reverse().find((entry) => typeof entry.commit === 'string' && entry.commit !== latestCommit) ?? null;
		const rollbackCommit = requestedCommit
			?? (typeof rollbackEntry?.commit === 'string' ? rollbackEntry.commit : latestCommit);
		if (!rollbackCommit) {
			return failureResult(this.metadata, `No rollback candidate is recorded for ${scope}.`);
		}
		const gitRoot = repoRoot(tenantRoot);
		const tenantRelativePath = relative(gitRoot, tenantRoot);
		const tempRoot = mkdtempSync(join(tmpdir(), 'treeseed-rollback-'));
		const tempTenantRoot = resolve(tempRoot, tenantRelativePath);
		const currentNodeModules = resolve(tenantRoot, 'node_modules');
		let finalizedState: Record<string, unknown> | null = null;
		try {
			runGit(['worktree', 'add', '--detach', tempRoot, rollbackCommit], { cwd: gitRoot, capture: true });
			copyTreeseedOperationalState(tenantRoot, tempTenantRoot);
			if (existsSync(currentNodeModules) && !existsSync(resolve(tempTenantRoot, 'node_modules'))) {
				symlinkSync(currentNodeModules, resolve(tempTenantRoot, 'node_modules'), 'dir');
			}
			const { wranglerPath } = ensureGeneratedWranglerConfig(tempTenantRoot, { target });
			const buildResult = spawnSync(process.execPath, [packageScriptPath('tenant-build')], {
				cwd: tempTenantRoot,
				env: contextEnv(context),
				stdio: 'inherit',
			});
			if ((buildResult.status ?? 1) !== 0) {
				return failureResult(this.metadata, 'Rollback build failed.', { exitCode: buildResult.status ?? 1 });
			}
			const publishResult = spawnSync(process.execPath, [resolveWranglerBin(), 'deploy', '--config', wranglerPath], {
				cwd: tempTenantRoot,
				env: contextEnv(context),
				stdio: 'inherit',
			});
			if ((publishResult.status ?? 1) !== 0) {
				return failureResult(this.metadata, 'Rollback deploy failed.', { exitCode: publishResult.status ?? 1 });
			}
			const previousCommit = process.env.TREESEED_DEPLOY_COMMIT;
			process.env.TREESEED_DEPLOY_COMMIT = rollbackCommit;
			try {
				finalizedState = finalizeDeploymentState(tenantRoot, { target }) as Record<string, unknown>;
			} finally {
				if (previousCommit) process.env.TREESEED_DEPLOY_COMMIT = previousCommit;
				else delete process.env.TREESEED_DEPLOY_COMMIT;
			}
		} finally {
			try {
				runGit(['worktree', 'remove', '--force', tempRoot], { cwd: gitRoot, capture: true });
			} catch {
				// best effort
			}
		}
		return operationResult(this.metadata, {
			scope,
			target: deployTargetLabel(target),
			rollbackCommit,
			rollbackEntry,
			finalizedState,
		});
	}
}

class MailpitUpOperation extends BaseOperation {
	async execute(_input: Record<string, unknown>, context: TreeseedOperationContext) {
		if (!dockerIsAvailable()) {
			return failureResult(this.metadata, 'Docker is required for Treeseed form email testing.');
		}
		const existing = findRunningMailpitContainer();
		if (existing) {
			return operationResult(this.metadata, { reused: true, container: existing });
		}
		return runNodeScript(this.metadata, 'ensure-mailpit', [], context);
	}
}

class MailpitDownOperation extends BaseOperation {
	async execute(_input: Record<string, unknown>, _context: TreeseedOperationContext) {
		const stopped = stopKnownMailpitContainers();
		return operationResult(this.metadata, { stopped }, { ok: stopped, exitCode: stopped ? 0 : 1 });
	}
}

class MailpitLogsOperation extends BaseOperation {
	async execute(_input: Record<string, unknown>, context: TreeseedOperationContext) {
		return runNodeScript(this.metadata, 'logs-mailpit', [], context);
	}
}

export class DefaultTreeseedOperationsProvider implements TreeseedOperationProvider {
	readonly id = 'default';
	private readonly operations: TreeseedOperationImplementation[];

	constructor() {
		this.operations = [
			new WorkflowOperation('status'),
			new WorkflowOperation('ci'),
			new WorkflowOperation('tasks'),
			new WorkflowOperation('switch', 'switch'),
			new WorkflowOperation('save'),
			new WorkflowOperation('close'),
			new WorkflowOperation('stage'),
			new WorkflowOperation('resume'),
			new WorkflowOperation('recover'),
			new WorkflowOperation('config'),
			new WorkflowOperation('export'),
			new WorkflowOperation('release'),
			new WorkflowOperation('destroy'),
			new WorkflowOperation('dev'),
			new InitOperation('init'),
			new HubPlanLaunchOperation('hub.plan_launch'),
			new HubValidateLaunchOperation('hub.validate_launch'),
			new HubExecuteLaunchOperation('hub.execute_launch'),
			new HubResumeLaunchOperation('hub.resume_launch'),
			new HubPlanUpdateOperation('hub.plan_update'),
			new HubValidateUpdateOperation('hub.validate_update'),
			new HubExecuteUpdateOperation('hub.execute_update'),
			new HubResumeUpdateOperation('hub.resume_update'),
			new RepositoryHostValidateOperation('repository_host.validate'),
			new RepositoryHostCreateRepositoriesOperation('repository_host.create_repositories'),
			new ContentVerifyPackageOperation('content.verify_package'),
			new ContentPublishOperation('content.publish'),
			new WorkspacePlanAttachParentOperation('workspace.plan_attach_parent'),
			new WorkspaceAttachParentOperation('workspace.attach_parent'),
			new WorkspaceUpdateSubmodulePointersOperation('workspace.update_submodule_pointers'),
			new TemplateOperation('template'),
			new SyncTemplateOperation('sync'),
			new DoctorOperation('doctor'),
			new InstallOperation('install'),
			new ToolsOperation('tools'),
			new AuthLoginOperation('auth:login'),
			new AuthLogoutOperation('auth:logout'),
			new AuthWhoAmIOperation('auth:whoami'),
			new SecretsStatusOperation('secrets:status'),
			new SecretsUnlockOperation('secrets:unlock'),
			new SecretsLockOperation('secrets:lock'),
			new SecretsMigrateKeyOperation('secrets:migrate-key'),
			new SecretsRotatePassphraseOperation('secrets:rotate-passphrase'),
			new SecretsRotateMachineKeyOperation('secrets:rotate-machine-key'),
			new RollbackOperation('rollback'),
			new ScriptOperation('build', 'tenant-build'),
			new ScriptOperation('check', 'tenant-check'),
			new ScriptOperation('preview', 'tenant-astro-command'),
			new ScriptOperation('lint', 'workspace-lint'),
			new ScriptOperation('test', 'workspace-test'),
			new ScriptOperation('test:unit', 'workspace-test-unit'),
			new PreflightOperation('preflight', false),
			new PreflightOperation('auth:check', true),
			new ScriptOperation('test:e2e', 'workspace-command-e2e'),
			new ScriptOperation('test:e2e:local', 'workspace-command-e2e', ['--mode=local']),
			new ScriptOperation('test:e2e:staging', 'workspace-command-e2e', ['--mode=staging']),
			new ScriptOperation('test:e2e:full', 'workspace-command-e2e', ['--mode=full']),
			new ScriptOperation('test:release', 'workspace-release-verify'),
			new ScriptOperation('test:release:full', 'workspace-release-verify', ['--full-smoke']),
			new ScriptOperation('release:publish:changed', 'workspace-publish-changed-packages'),
			new ScriptOperation('astro', 'tenant-astro-command'),
			new MailpitUpOperation('mailpit:up'),
			new MailpitDownOperation('mailpit:down'),
			new MailpitLogsOperation('mailpit:logs'),
			new ScriptOperation('d1:migrate:local', 'tenant-d1-migrate-local'),
			new ScriptOperation('cleanup:markdown', 'cleanup-markdown', ['--write']),
			new ScriptOperation('cleanup:markdown:check', 'cleanup-markdown', ['--check']),
			new ScriptOperation('starlight:patch', 'patch-starlight-content-path'),
		];
	}

	listOperations() {
		return [...this.operations];
	}

	findOperation(name: string | null | undefined) {
		if (!name) return null;
		return this.operations.find((operation) => operation.metadata.name === name || operation.metadata.aliases.includes(name)) ?? null;
	}
}

export function createDefaultTreeseedOperationsProvider() {
	return new DefaultTreeseedOperationsProvider();
}

export function listDefaultOperationMetadata() {
	return TRESEED_OPERATION_SPECS;
}
