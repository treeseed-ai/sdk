import type {
	ProjectEnvironmentName,
	ProjectLaunchHostBindingInput,
	TemplateHostRequirement,
	TemplateLaunchRequirements,
} from '../../../sdk-types.ts';
import {
	executePlatformRepositoryOperation,
	type PlatformRepositoryDescriptor,
	type PlatformRepositoryOperationResult,
} from '../../repository-operations.ts';
import {
	ProjectLaunchSecretSyncError,
	syncProjectLaunchHostBindingSecrets,
	type ProjectLaunchSecretSyncProgressEvent,
	type ProjectLaunchSecretSyncResult,
} from '../template-secret-sync.ts';
import {
	resolveProjectLaunchHostBindings,
	type ProjectLaunchHostInventoryRecord,
	type ProjectLaunchResolvedHostBinding,
	type ResolveProjectLaunchHostBindingsResult,
} from '../../../template-launch-requirements.ts';
import { ExecuteProjectHostBindingOperationContext, ExecuteProjectHostBindingOperationInput, ExecuteProjectHostBindingOperationResult } from './project-host-operation-kind.ts';
import { repositorySlug, scopedPlans } from './requirement-diagnostics.ts';

export async function executeProjectHostBindingOperation(
	input: ExecuteProjectHostBindingOperationInput,
	context: ExecuteProjectHostBindingOperationContext,
): Promise<ExecuteProjectHostBindingOperationResult> {
	const plans = scopedPlans(input);
	const requiresRepositoryConfigWrite = input.kind === 'replace' && plans.configWrites.length > 0;
	const repositoryOperation = requiresRepositoryConfigWrite ? 'apply_host_binding_config' : 'audit_host_binding_config';
	const repositoryResult = await executePlatformRepositoryOperation(repositoryOperation, {
		projectId: input.projectId ?? undefined,
		teamId: input.teamId ?? undefined,
		repository: input.repository,
		hostBindings: input.hostBindings,
		hostBindingPlans: plans,
		launchInput: {
			projectSlug: input.projectSlug ?? null,
			projectName: input.projectName ?? null,
			repoName: input.repositoryName ?? input.projectSlug ?? null,
		},
		derived: {
			projectSlug: input.projectSlug ?? null,
			projectName: input.projectName ?? null,
			repositoryName: input.repositoryName ?? input.projectSlug ?? null,
		},
		commitMessage: input.commitMessage ?? undefined,
		approvalRequired: input.approvalRequired,
		approvalId: input.approvalId ?? undefined,
	}, {
		workspaceRoot: context.workspaceRoot,
		environment: context.environment,
	});

	let secretSync: ProjectLaunchSecretSyncResult | null = null;
	const requiresSecretSync = ['replace', 'resync', 'rotate'].includes(input.kind) && (plans.secretDeployment.items ?? []).length > 0;
	if (requiresSecretSync) {
		try {
			secretSync = await syncProjectLaunchHostBindingSecrets({
				projectRoot: repositoryResult.repositoryPath,
				repository: repositorySlug(repositoryResult),
				hostBindings: input.hostBindings,
				secretDeploymentPlan: plans.secretDeployment,
				valuesOverlay: context.valuesOverlay,
				valuesByScope: context.valuesByScope as any,
				processEnv: context.processEnv,
				planOnly: input.planOnly,
				onProgress: context.onProgress,
			});
		} catch (error) {
			if (error instanceof ProjectLaunchSecretSyncError) {
				secretSync = error.result;
			} else {
				throw error;
			}
		}
	}

	return {
		ok: secretSync ? secretSync.ok : true,
		kind: input.kind,
		requirementKey: input.requirementKey ?? null,
		hostBindings: input.hostBindings,
		previousHostBindings: input.previousHostBindings ?? {},
		hostBindingPlans: plans,
		repository: {
			operation: repositoryOperation,
			branch: repositoryResult.operationBranch ?? repositoryResult.branch,
			commitSha: repositoryResult.commitSha,
			changedPaths: repositoryResult.changedPaths,
			audit: repositoryResult.output.hostBindingAudit ?? null,
			config: repositoryResult.output.hostBindingConfig ?? null,
		},
		secretSync,
		summary: {
			requiresRepositoryConfigWrite,
			requiresSecretSync,
			changedRequirementKeys: input.operationSummary?.changedRequirementKeys ?? [],
		},
	};
}
