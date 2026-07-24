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
import { BaseOperation, failureResult, operationEnv, operationResult, prepareContentPublishRoot } from './run-git.ts';
import { arrayOfStrings, plainObject, stringValue, workspaceAttachPlan, writeJsonFile } from './hub-resume-launch-operation.ts';

export class ContentPublishOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, context: OperationContext) {
		const tenantRoot = typeof input.tenantRoot === 'string' ? input.tenantRoot : context.cwd;
		const contentRepositoryRoot = typeof input.contentRepositoryRoot === 'string'
			? input.contentRepositoryRoot
			: typeof input.contentRoot === 'string'
				? input.contentRoot
				: null;
		const scope = input.scope === 'staging' || input.scope === 'prod' || input.scope === 'local'
			? input.scope
			: 'prod';
		if (input.planOnly === true) {
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
					bucketName: context.env?.CONTENT_BUCKET_NAME ?? process.env.CONTENT_BUCKET_NAME ?? null,
					publicBaseUrl: context.env?.TREESEED_CONTENT_PUBLIC_BASE_URL ?? process.env.TREESEED_CONTENT_PUBLIC_BASE_URL ?? null,
				},
			});
		} finally {
			preparedRoot.cleanup();
		}
	}
}

export class WorkspacePlanAttachParentOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, context: OperationContext) {
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

export class WorkspaceAttachParentOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, context: OperationContext) {
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

export class WorkspaceUpdateSubmodulePointersOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, context: OperationContext) {
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

export class DoctorOperation extends BaseOperation {
	async execute(_input: Record<string, unknown>, context: OperationContext) {
		const state = resolveWorkflowState(context.cwd);
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

export class InstallOperation extends BaseOperation<{ force?: boolean }> {
	async execute(input: { force?: boolean }, context: OperationContext) {
		const result = await installDependencies({
			tenantRoot: context.cwd,
			force: input.force === true,
			env: context.env,
			write: context.outputFormat === 'json' ? undefined : context.write,
		});
		const stdout = [formatDependencyReport(result)];
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

export class ToolsOperation extends BaseOperation {
	async execute(_input: Record<string, unknown>, context: OperationContext) {
		const result = collectToolStatus({
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

export class AuthLoginOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, context: OperationContext) {
		const tenantRoot = context.cwd;
		const remoteConfig = resolveRemoteConfig(tenantRoot, context.env);
		const hostId = typeof input.host === 'string' ? input.host : remoteConfig.activeHostId;
		const client = new RemoteAuthClient(new RemoteClient({
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
				setRemoteSession(tenantRoot, {
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

export class AuthLogoutOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, context: OperationContext) {
		const remoteConfig = resolveRemoteConfig(context.cwd, context.env);
		const hostId = typeof input.host === 'string' ? input.host : remoteConfig.activeHostId;
		clearRemoteSession(context.cwd, hostId);
		return operationResult(this.metadata, { hostId });
	}
}
