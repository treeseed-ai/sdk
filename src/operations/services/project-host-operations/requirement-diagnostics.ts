import type {
	ProjectEnvironmentName,
	ProjectLaunchHostBindingInput,
	TemplateHostRequirement,
	TemplateLaunchRequirements,
} from '../../../entrypoints/models/sdk-types.ts';
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
} from '../configuration/template-secret-sync.ts';
import {
	resolveProjectLaunchHostBindings,
	type ProjectLaunchHostInventoryRecord,
	type ProjectLaunchResolvedHostBinding,
	type ResolveProjectLaunchHostBindingsResult,
} from '../../../entrypoints/templates/template-launch-requirements.ts';
import { ExecuteProjectHostBindingOperationInput, PlanProjectHostBindingOperationOptions, PlanProjectHostBindingOperationResult, ProjectHostBindingsView, ProjectHostOperationDiagnostic, ProjectHostOperationStatus, bindingChanged, bindingMode, hostRequirementInputSet, mergeInventory, mergeTeamHostInventory, requirementByKey } from './project-host-operation-kind.ts';

export function requirementDiagnostics(requirement: TemplateHostRequirement, binding?: ProjectLaunchResolvedHostBinding): ProjectHostOperationDiagnostic[] {
	const diagnostics: ProjectHostOperationDiagnostic[] = [];
	const hostId = binding?.hostId ?? binding?.host?.id ?? binding?.managedHostKey ?? null;
	if (!binding || bindingMode(binding) === 'none') {
		if (requirement.required) {
			diagnostics.push({
				code: 'missing_required_host',
				status: 'blocked',
				message: `${requirement.displayName} is required and has no selected host.`,
				requirementKey: requirement.key,
			});
		}
		return diagnostics;
	}
	if (binding.type !== requirement.type) {
		diagnostics.push({
			code: 'incompatible_host_type',
			status: 'blocked',
			message: `${requirement.displayName} requires ${requirement.type} hosts, but ${binding.type} is selected.`,
			requirementKey: requirement.key,
			provider: binding.provider,
			hostId,
		});
	}
	if (requirement.compatibleProviders?.length && !requirement.compatibleProviders.includes(binding.provider)) {
		diagnostics.push({
			code: 'incompatible_provider',
			status: 'blocked',
			message: `${requirement.displayName} requires ${requirement.compatibleProviders.join(', ')} provider support.`,
			requirementKey: requirement.key,
			provider: binding.provider,
			hostId,
		});
	}
	const status = String(binding.host?.status ?? '').trim();
	if (status && !['active', 'ready'].includes(status)) {
		diagnostics.push({
			code: 'host_not_ready',
			status: requirement.required ? 'blocked' : 'warning',
			message: `${requirement.displayName} host is ${status}.`,
			requirementKey: requirement.key,
			provider: binding.provider,
			hostId,
		});
	}
	return diagnostics;
}

export function worstStatus(diagnostics: ProjectHostOperationDiagnostic[]): ProjectHostOperationStatus {
	if (diagnostics.some((diagnostic) => diagnostic.status === 'blocked')) return 'blocked';
	if (diagnostics.some((diagnostic) => diagnostic.status === 'warning')) return 'warning';
	return 'ok';
}

export function deriveProjectHostBindingsView(options: {
	launchRequirements?: TemplateLaunchRequirements | null;
	hostBindings?: Record<string, ProjectLaunchResolvedHostBinding> | null;
	hostBindingPlans?: {
		configWrites?: ResolveProjectLaunchHostBindingsResult['configWritePlan'] | null;
		secretDeployment?: ResolveProjectLaunchHostBindingsResult['secretDeploymentPlan'] | null;
	} | null;
}): ProjectHostBindingsView {
	const bindings = options.hostBindings ?? {};
	const configWrites = options.hostBindingPlans?.configWrites ?? [];
	const secretItems = options.hostBindingPlans?.secretDeployment?.items ?? [];
	const requirements = (options.launchRequirements?.hosts ?? []).map((requirement) => {
		const binding = bindings[requirement.key];
		const diagnostics = requirementDiagnostics(requirement, binding);
		const marketHostId = binding?.hostId ?? binding?.host?.id ?? binding?.managedHostKey ?? null;
		const scopedConfigWrites = configWrites.filter((write) => write.requirementKey === requirement.key);
		const scopedSecretItems = secretItems.filter((item) => item.requirementKey === requirement.key);
		return {
			requirementKey: requirement.key,
			displayName: requirement.displayName,
			type: requirement.type,
			required: requirement.required,
			purpose: requirement.purpose,
			compatibleProviders: requirement.compatibleProviders ?? [],
			binding: binding
				? {
					provider: binding.provider,
					hostId: binding.hostId ?? binding.host?.id ?? null,
					managedHostKey: binding.managedHostKey ?? null,
					mode: bindingMode(binding),
					displayName: binding.displayName,
					ownership: binding.host?.ownership ?? null,
					status: binding.host?.status ?? null,
					environmentScopes: binding.environmentScopes,
					selectedBy: binding.provenance.selectedBy,
					selectedAt: binding.provenance.selectedAt,
				}
				: null,
			configWrites: scopedConfigWrites.map((write) => ({
				target: write.target,
				path: write.path,
				valueFrom: write.valueFrom,
				provider: write.provider ?? binding?.provider ?? null,
			})),
			secretTargets: scopedSecretItems.map((item) => ({
				env: item.env,
				targets: item.targets,
				scopes: item.scopes,
				sensitivity: item.sensitivity,
				provider: binding?.provider ?? null,
			})),
			audit: {
				status: worstStatus(diagnostics),
				diagnostics,
				marketHostId,
				repositoryConfig: scopedConfigWrites.length > 0 ? 'planned' as const : 'not_declared' as const,
			},
		};
	});
	const diagnostics = requirements.flatMap((requirement) => requirement.audit.diagnostics);
	return {
		requirements,
		summary: {
			status: worstStatus(diagnostics),
			total: requirements.length,
			blocked: diagnostics.filter((diagnostic) => diagnostic.status === 'blocked').length,
			warnings: diagnostics.filter((diagnostic) => diagnostic.status === 'warning').length,
		},
		diagnostics,
	};
}

export function planProjectHostBindingOperation(options: PlanProjectHostBindingOperationOptions): PlanProjectHostBindingOperationResult {
	const current = options.currentHostBindings ?? {};
	const replacements = options.replacementHostBindings ?? {};
	const requirementsByKey = requirementByKey(options.launchRequirements);
	const requirementKey = options.requirementKey ?? Object.keys(replacements)[0] ?? null;
	if (requirementKey && !requirementsByKey.has(requirementKey)) {
		throw new Error(`Unknown launch host requirement "${requirementKey}".`);
	}
	const inputs = hostRequirementInputSet(current, replacements);
	const resolved = resolveProjectLaunchHostBindings({
		hostBindings: inputs,
		launchRequirements: options.launchRequirements,
		repositoryHosts: mergeInventory(current, options.repositoryHosts, 'repository'),
		teamHosts: mergeTeamHostInventory(current, options.teamHosts),
		managedHosts: options.managedHosts,
		defaultHosts: options.defaultHosts,
		projectSlug: options.projectSlug,
		projectName: options.projectName,
		standardProjectLaunch: true,
		selectedAt: options.selectedAt,
	});
	const changedRequirementKeys = [...new Set([
		...Object.keys(current),
		...Object.keys(resolved.hostBindings),
	])].filter((key) => bindingChanged(current[key], resolved.hostBindings[key]));
	const hostBindingPlans = {
		configWrites: resolved.configWritePlan,
		secretDeployment: resolved.secretDeploymentPlan,
	};
	const audit = deriveProjectHostBindingsView({
		launchRequirements: options.launchRequirements,
		hostBindings: resolved.hostBindings,
		hostBindingPlans,
	});
	const scopedKeys = requirementKey ? [requirementKey] : changedRequirementKeys;
	return {
		kind: options.kind,
		requirementKey,
		previousHostBindings: current,
		nextHostBindings: resolved.hostBindings,
		compatibility: resolved.compatibility,
		hostBindingPlans,
		audit,
		operationSummary: {
			requiresRepositoryConfigWrite: resolved.configWritePlan.some((write) => scopedKeys.length === 0 || scopedKeys.includes(write.requirementKey)),
			requiresSecretSync: (resolved.secretDeploymentPlan.items ?? []).some((item) => scopedKeys.length === 0 || scopedKeys.includes(item.requirementKey)),
			changedRequirementKeys,
		},
	};
}

export function scopedRequirementKeys(input: ExecuteProjectHostBindingOperationInput) {
	if (input.requirementKey) return [input.requirementKey];
	if (input.kind === 'replace') return input.operationSummary?.changedRequirementKeys ?? [];
	return [];
}

export function scopedPlans(
	input: ExecuteProjectHostBindingOperationInput,
): PlanProjectHostBindingOperationResult['hostBindingPlans'] {
	const keys = scopedRequirementKeys(input);
	if (keys.length === 0) return input.hostBindingPlans;
	const keySet = new Set(keys);
	return {
		configWrites: input.hostBindingPlans.configWrites.filter((write) => keySet.has(write.requirementKey)),
		secretDeployment: {
			items: (input.hostBindingPlans.secretDeployment.items ?? []).filter((item) => keySet.has(item.requirementKey)),
		},
	};
}

export function repositorySlug(result: PlatformRepositoryOperationResult) {
	return result.repository.owner ? `${result.repository.owner}/${result.repository.name}` : result.repository.name;
}
