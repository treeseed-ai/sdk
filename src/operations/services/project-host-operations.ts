import type {
	ProjectEnvironmentName,
	ProjectLaunchHostBindingInput,
	TemplateHostRequirement,
	TemplateLaunchRequirements,
} from '../../sdk-types.ts';
import {
	executePlatformRepositoryOperation,
	type PlatformRepositoryDescriptor,
	type PlatformRepositoryOperationResult,
} from '../repository-operations.ts';
import {
	ProjectLaunchSecretSyncError,
	syncProjectLaunchHostBindingSecrets,
	type ProjectLaunchSecretSyncProgressEvent,
	type ProjectLaunchSecretSyncResult,
} from './template-secret-sync.ts';
import {
	resolveProjectLaunchHostBindings,
	type ProjectLaunchHostInventoryRecord,
	type ProjectLaunchResolvedHostBinding,
	type ResolveProjectLaunchHostBindingsResult,
} from '../../template-launch-requirements.ts';

export type ProjectHostOperationKind = 'inspect' | 'audit' | 'resync' | 'replace' | 'rotate';
export type ProjectHostOperationStatus = 'ok' | 'warning' | 'blocked';

export interface ProjectHostOperationDiagnostic {
	code: string;
	status: ProjectHostOperationStatus;
	message: string;
	requirementKey?: string;
	provider?: string | null;
	hostId?: string | null;
	path?: string | null;
}

export interface ProjectHostRequirementBindingView {
	requirementKey: string;
	displayName: string;
	type: string;
	required: boolean;
	purpose: string;
	compatibleProviders: string[];
	binding: {
		provider: string | null;
		hostId: string | null;
		managedHostKey: string | null;
		mode: string | null;
		displayName: string | null;
		ownership: string | null;
		status: string | null;
		environmentScopes: ProjectEnvironmentName[];
		selectedBy: string | null;
		selectedAt: string | null;
	} | null;
	configWrites: Array<{
		target: string;
		path: string;
		valueFrom: string;
		provider: string | null;
	}>;
	secretTargets: Array<{
		env: string;
		targets: string[];
		scopes: ProjectEnvironmentName[];
		sensitivity: string;
		provider: string | null;
	}>;
	audit: {
		status: ProjectHostOperationStatus;
		diagnostics: ProjectHostOperationDiagnostic[];
		marketHostId: string | null;
		repositoryConfig: 'planned' | 'not_declared';
	};
}

export interface ProjectHostBindingsView {
	requirements: ProjectHostRequirementBindingView[];
	summary: {
		status: ProjectHostOperationStatus;
		total: number;
		blocked: number;
		warnings: number;
	};
	diagnostics: ProjectHostOperationDiagnostic[];
}

export interface PlanProjectHostBindingOperationOptions {
	kind: ProjectHostOperationKind;
	requirementKey?: string | null;
	currentHostBindings?: Record<string, ProjectLaunchResolvedHostBinding> | null;
	replacementHostBindings?: Record<string, ProjectLaunchHostBindingInput> | null;
	launchRequirements?: TemplateLaunchRequirements | null;
	repositoryHosts?: ProjectLaunchHostInventoryRecord[];
	teamHosts?: ProjectLaunchHostInventoryRecord[];
	managedHosts?: ProjectLaunchHostInventoryRecord[];
	defaultHosts?: Record<string, unknown> | null;
	projectSlug?: string | null;
	projectName?: string | null;
	selectedAt?: string;
}

export interface PlanProjectHostBindingOperationResult {
	kind: ProjectHostOperationKind;
	requirementKey: string | null;
	previousHostBindings: Record<string, ProjectLaunchResolvedHostBinding>;
	nextHostBindings: Record<string, ProjectLaunchResolvedHostBinding>;
	compatibility: ResolveProjectLaunchHostBindingsResult['compatibility'];
	hostBindingPlans: {
		configWrites: ResolveProjectLaunchHostBindingsResult['configWritePlan'];
		secretDeployment: ResolveProjectLaunchHostBindingsResult['secretDeploymentPlan'];
	};
	audit: ProjectHostBindingsView;
	operationSummary: {
		requiresRepositoryConfigWrite: boolean;
		requiresSecretSync: boolean;
		changedRequirementKeys: string[];
	};
}

export interface ExecuteProjectHostBindingOperationInput {
	projectId?: string | null;
	teamId?: string | null;
	kind: ProjectHostOperationKind;
	requirementKey?: string | null;
	repository: PlatformRepositoryDescriptor;
	hostBindings: Record<string, ProjectLaunchResolvedHostBinding>;
	previousHostBindings?: Record<string, ProjectLaunchResolvedHostBinding> | null;
	hostBindingPlans: PlanProjectHostBindingOperationResult['hostBindingPlans'];
	operationSummary?: PlanProjectHostBindingOperationResult['operationSummary'] | null;
	projectSlug?: string | null;
	projectName?: string | null;
	repositoryName?: string | null;
	commitMessage?: string | null;
	approvalRequired?: boolean;
	approvalId?: string | null;
	dryRun?: boolean;
}

export interface ExecuteProjectHostBindingOperationContext {
	workspaceRoot: string;
	environment?: string;
	valuesOverlay?: Record<string, string | undefined> | null;
	valuesByScope?: Record<string, Record<string, string | undefined> | null> | null;
	processEnv?: Record<string, string | undefined>;
	onProgress?: (event: ProjectLaunchSecretSyncProgressEvent) => void | Promise<void>;
}

export interface ExecuteProjectHostBindingOperationResult {
	ok: boolean;
	kind: ProjectHostOperationKind;
	requirementKey: string | null;
	hostBindings: Record<string, ProjectLaunchResolvedHostBinding>;
	previousHostBindings: Record<string, ProjectLaunchResolvedHostBinding>;
	hostBindingPlans: PlanProjectHostBindingOperationResult['hostBindingPlans'];
	repository: {
		operation: string;
		branch: string | null;
		commitSha: string | null;
		changedPaths: string[];
		audit: unknown;
		config: unknown;
	};
	secretSync: ProjectLaunchSecretSyncResult | null;
	summary: {
		requiresRepositoryConfigWrite: boolean;
		requiresSecretSync: boolean;
		changedRequirementKeys: string[];
	};
}

function requirementByKey(requirements?: TemplateLaunchRequirements | null) {
	return new Map((requirements?.hosts ?? []).map((requirement) => [requirement.key, requirement]));
}

function bindingMode(binding: ProjectLaunchResolvedHostBinding | undefined | null) {
	if (!binding) return null;
	if (binding.managedHostKey || binding.host?.ownership === 'treeseed_managed' || binding.provenance.selectedBy === 'managed-default') return 'treeseed_managed';
	if (binding.hostId || binding.host?.id) return 'team_owned';
	return 'none';
}

function inputFromResolved(binding: ProjectLaunchResolvedHostBinding): ProjectLaunchHostBindingInput {
	return {
		requirementKey: binding.requirementKey,
		requirementKind: binding.requirementKind,
		type: binding.type,
		provider: binding.provider,
		hostId: binding.hostId ?? binding.host?.id ?? null,
		managedHostKey: binding.managedHostKey ?? null,
		mode: bindingMode(binding),
		displayName: binding.displayName,
		environmentScopes: binding.environmentScopes,
		configValues: binding.configValues,
		environmentValues: binding.environmentValues,
		secretRefs: binding.secretRefs,
		selectedBy: binding.provenance.selectedBy,
	};
}

function inventoryFromResolved(binding: ProjectLaunchResolvedHostBinding): ProjectLaunchHostInventoryRecord | null {
	const id = binding.host?.id ?? binding.hostId ?? binding.managedHostKey ?? null;
	if (!id) return null;
	return {
		id,
		type: binding.type,
		provider: binding.provider,
		ownership: binding.host?.ownership ?? (binding.managedHostKey ? 'treeseed_managed' : null),
		name: binding.host?.name ?? binding.displayName,
		accountLabel: binding.host?.accountLabel ?? null,
		organizationOrOwner: binding.host?.organizationOrOwner ?? null,
		allowedEnvironments: binding.environmentScopes,
		status: binding.host?.status ?? 'active',
		metadata: {
			...(binding.host?.metadata ?? {}),
			hostType: binding.type,
		},
	};
}

function mergeInventory(
	currentBindings: Record<string, ProjectLaunchResolvedHostBinding>,
	input: ProjectLaunchHostInventoryRecord[] | undefined,
	type: string,
) {
	const records = [...(input ?? [])];
	const seen = new Set(records.map((record) => record.id));
	for (const binding of Object.values(currentBindings)) {
		if (binding.type !== type) continue;
		const record = inventoryFromResolved(binding);
		if (record && !seen.has(record.id)) {
			records.push(record);
			seen.add(record.id);
		}
	}
	return records;
}

function mergeTeamHostInventory(
	currentBindings: Record<string, ProjectLaunchResolvedHostBinding>,
	input: ProjectLaunchHostInventoryRecord[] | undefined,
) {
	const records = [...(input ?? [])];
	const seen = new Set(records.map((record) => record.id));
	for (const binding of Object.values(currentBindings)) {
		if (!['web', 'email', 'ai'].includes(binding.type)) continue;
		const record = inventoryFromResolved(binding);
		if (record && !seen.has(record.id)) {
			records.push(record);
			seen.add(record.id);
		}
	}
	return records;
}

function hostRequirementInputSet(
	currentHostBindings: Record<string, ProjectLaunchResolvedHostBinding>,
	replacementHostBindings?: Record<string, ProjectLaunchHostBindingInput> | null,
) {
	const inputs: Record<string, ProjectLaunchHostBindingInput> = {};
	for (const [key, binding] of Object.entries(currentHostBindings)) {
		inputs[key] = inputFromResolved(binding);
	}
	for (const [key, binding] of Object.entries(replacementHostBindings ?? {})) {
		inputs[key] = binding;
	}
	return inputs;
}

function bindingChanged(previous: ProjectLaunchResolvedHostBinding | undefined, next: ProjectLaunchResolvedHostBinding | undefined) {
	return JSON.stringify({
		provider: previous?.provider ?? null,
		hostId: previous?.hostId ?? previous?.host?.id ?? null,
		managedHostKey: previous?.managedHostKey ?? null,
		mode: bindingMode(previous),
	}) !== JSON.stringify({
		provider: next?.provider ?? null,
		hostId: next?.hostId ?? next?.host?.id ?? null,
		managedHostKey: next?.managedHostKey ?? null,
		mode: bindingMode(next),
	});
}

function requirementDiagnostics(requirement: TemplateHostRequirement, binding?: ProjectLaunchResolvedHostBinding): ProjectHostOperationDiagnostic[] {
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

function worstStatus(diagnostics: ProjectHostOperationDiagnostic[]): ProjectHostOperationStatus {
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

function scopedRequirementKeys(input: ExecuteProjectHostBindingOperationInput) {
	if (input.requirementKey) return [input.requirementKey];
	if (input.kind === 'replace') return input.operationSummary?.changedRequirementKeys ?? [];
	return [];
}

function scopedPlans(
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

function repositorySlug(result: PlatformRepositoryOperationResult) {
	return result.repository.owner ? `${result.repository.owner}/${result.repository.name}` : result.repository.name;
}

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
				dryRun: input.dryRun,
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
