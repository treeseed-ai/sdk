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
import { BaseOperation, ScriptOperation, WorkflowOperation, contextEnv, copyOperationalState, failureResult, operationResult, providerTempRoot, runGit } from './run-git.ts';
import { HubExecuteLaunchOperation, HubPlanLaunchOperation, HubValidateLaunchOperation, InitOperation, PreflightOperation, SyncTemplateOperation, TemplateOperation } from './preflight-operation.ts';
import { ContentVerifyPackageOperation, HubExecuteUpdateOperation, HubPlanUpdateOperation, HubResumeLaunchOperation, HubResumeUpdateOperation, HubValidateUpdateOperation, RepositoryHostCreateRepositoriesOperation, RepositoryHostValidateOperation } from './hub-resume-launch-operation.ts';
import { AuthLoginOperation, AuthLogoutOperation, ContentPublishOperation, DoctorOperation, InstallOperation, ToolsOperation, WorkspaceAttachParentOperation, WorkspacePlanAttachParentOperation, WorkspaceUpdateSubmodulePointersOperation } from './content-publish-operation.ts';

export class AuthWhoAmIOperation extends BaseOperation {
	async execute(_input: Record<string, unknown>, context: OperationContext) {
		const remoteConfig = resolveRemoteConfig(context.cwd, context.env);
		const client = new RemoteAuthClient(new RemoteClient(remoteConfig));
		const response = await client.whoAmI();
		return operationResult(this.metadata, {
			hostId: remoteConfig.activeHostId,
			principal: response.payload,
		});
	}
}

export class SecretsStatusOperation extends BaseOperation {
	async execute(_input: Record<string, unknown>, context: OperationContext) {
		return operationResult(this.metadata, {
			status: inspectKeyAgentStatus(context.cwd),
		});
	}
}

export class SecretsUnlockOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, context: OperationContext) {
		try {
			const status = unlockSecretSessionFromEnv(context.cwd, {
				allowMigration: input.allowMigration !== false,
				createIfMissing: input.createIfMissing !== false,
			});
			return operationResult(this.metadata, { status });
		} catch (error) {
			if (error instanceof KeyAgentError) {
				return failureResult(this.metadata, error.message, { meta: { code: error.code, details: error.details ?? null } });
			}
			throw error;
		}
	}
}

export class SecretsLockOperation extends BaseOperation {
	async execute(_input: Record<string, unknown>, context: OperationContext) {
		try {
			return operationResult(this.metadata, {
				status: lockSecretSession(context.cwd),
			});
		} catch (error) {
			if (error instanceof KeyAgentError) {
				return failureResult(this.metadata, error.message, { meta: { code: error.code, details: error.details ?? null } });
			}
			throw error;
		}
	}
}

export class SecretsMigrateKeyOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, context: OperationContext) {
		const passphrase = String(input.passphrase ?? context.env?.[MACHINE_KEY_PASSPHRASE_ENV] ?? '').trim();
		if (!passphrase) {
			return failureResult(this.metadata, `Set ${MACHINE_KEY_PASSPHRASE_ENV} or pass { passphrase } when migrating the machine key.`);
		}
		try {
			return operationResult(this.metadata, migrateMachineKeyToWrapped(context.cwd, passphrase));
		} catch (error) {
			if (error instanceof KeyAgentError) {
				return failureResult(this.metadata, error.message, { meta: { code: error.code, details: error.details ?? null } });
			}
			throw error;
		}
	}
}

export class SecretsRotatePassphraseOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, context: OperationContext) {
		const passphrase = String(input.passphrase ?? context.env?.[MACHINE_KEY_PASSPHRASE_ENV] ?? '').trim();
		if (!passphrase) {
			return failureResult(this.metadata, `Set ${MACHINE_KEY_PASSPHRASE_ENV} or pass { passphrase } when rotating the wrapped-key passphrase.`);
		}
		try {
			return operationResult(this.metadata, rotateMachineKeyPassphrase(context.cwd, passphrase));
		} catch (error) {
			if (error instanceof KeyAgentError) {
				return failureResult(this.metadata, error.message, { meta: { code: error.code, details: error.details ?? null } });
			}
			throw error;
		}
	}
}

export class SecretsRotateMachineKeyOperation extends BaseOperation {
	async execute(_input: Record<string, unknown>, context: OperationContext) {
		try {
			return operationResult(this.metadata, rotateMachineKey(context.cwd));
		} catch (error) {
			if (error instanceof KeyAgentError) {
				return failureResult(this.metadata, error.message, { meta: { code: error.code, details: error.details ?? null } });
			}
			throw error;
		}
	}
}

export class RollbackOperation extends BaseOperation {
	async execute(input: Record<string, unknown>, context: OperationContext) {
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
		const rollbackBase = providerTempRoot(tenantRoot, 'rollback');
		const tempRoot = mkdtempSync(join(rollbackBase, 'treeseed-rollback-'));
		const tempTenantRoot = resolve(tempRoot, tenantRelativePath);
		const currentNodeModules = resolve(tenantRoot, 'node_modules');
		let finalizedState: Record<string, unknown> | null = null;
		try {
			runGit(['worktree', 'add', '--detach', tempRoot, rollbackCommit], { cwd: gitRoot, capture: true });
			copyOperationalState(tenantRoot, tempTenantRoot);
			if (existsSync(currentNodeModules) && !existsSync(resolve(tempTenantRoot, 'node_modules'))) {
				symlinkSync(currentNodeModules, resolve(tempTenantRoot, 'node_modules'), 'dir');
			}
			const { wranglerPath } = ensureGeneratedWranglerConfig(tempTenantRoot, { target });
			const buildResult = spawnSync(process.execPath, [packageScriptPath('build/tenant-build')], {
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

export class DefaultOperationsProvider implements OperationProvider {
	readonly id = 'default';
	private readonly operations: OperationImplementation[];

	constructor() {
		this.operations = [
			new WorkflowOperation('status'),
			new WorkflowOperation('ci'),
			new WorkflowOperation('tasks'),
			new WorkflowOperation('switch', 'switch'),
			new WorkflowOperation('save'),
			new WorkflowOperation('update'),
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
			new WorkflowOperation('cleanup'),
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
			new ScriptOperation('build', 'build/tenant-build'),
			new ScriptOperation('check', 'verification/tenant-check'),
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
			new ScriptOperation('d1:migrate:local', 'tenant-d1-migrate-local'),
			new ScriptOperation('cleanup:markdown', 'maintenance/cleanup-markdown', ['--write']),
			new ScriptOperation('cleanup:markdown:check', 'maintenance/cleanup-markdown', ['--check']),
			new ScriptOperation('starlight:patch', 'content/patch-starlight-content-path'),
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

export function createDefaultOperationsProvider() {
	return new DefaultOperationsProvider();
}

export function listDefaultOperationMetadata() {
	return TRESEED_OPERATION_SPECS;
}
