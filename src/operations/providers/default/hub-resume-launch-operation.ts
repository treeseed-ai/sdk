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

export class HubResumeLaunchOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, context: OperationContext) {
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

export function plainObject(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function stringValue(value: unknown, fallback = '') {
	return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

export function arrayOfStrings(value: unknown) {
	return Array.isArray(value) ? value.map((entry) => String(entry)).filter(Boolean) : [];
}

export function normalizeUpdatePlan(input: Record<string, unknown>, cwd: string) {
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

export function writeJsonFile(path: string, value: unknown) {
	mkdirSync(resolve(path, '..'), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function workspaceAttachPlan(input: Record<string, unknown>, cwd: string) {
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

export class HubPlanUpdateOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, context: OperationContext) {
		return operationResult(this.metadata, normalizeUpdatePlan(input, context.cwd));
	}
}

export class HubValidateUpdateOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, _context: OperationContext) {
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

export class HubExecuteUpdateOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, context: OperationContext) {
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

export class HubResumeUpdateOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, context: OperationContext) {
		const executor = new HubExecuteUpdateOperation(this.metadata.name);
		return executor.execute({ ...input, resumed: true }, context);
	}
}

export class RepositoryHostValidateOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, _context: OperationContext) {
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

export class RepositoryHostCreateRepositoriesOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, _context: OperationContext) {
		const plan = input.plan as KnowledgeHubRepositoryPlan | undefined;
		if (!plan) {
			return failureResult(this.metadata, 'repository_host.create_repositories requires a repository plan.');
		}
		return operationResult(this.metadata, await createKnowledgeHubRepositories({
			plan,
			planOnly: input.planOnly === true,
			description: typeof input.description === 'string' ? input.description : null,
			homepageUrl: typeof input.homepageUrl === 'string' ? input.homepageUrl : null,
		}));
	}
}

export class ContentVerifyPackageOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, context: OperationContext) {
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
