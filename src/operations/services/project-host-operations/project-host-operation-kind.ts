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
	planOnly?: boolean;
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

export function requirementByKey(requirements?: TemplateLaunchRequirements | null) {
	return new Map((requirements?.hosts ?? []).map((requirement) => [requirement.key, requirement]));
}

export function bindingMode(binding: ProjectLaunchResolvedHostBinding | undefined | null) {
	if (!binding) return null;
	if (binding.managedHostKey || binding.host?.ownership === 'treeseed_managed' || binding.provenance.selectedBy === 'managed-default') return 'treeseed_managed';
	if (binding.hostId || binding.host?.id) return 'team_owned';
	return 'none';
}

export function inputFromResolved(binding: ProjectLaunchResolvedHostBinding): ProjectLaunchHostBindingInput {
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

export function inventoryFromResolved(binding: ProjectLaunchResolvedHostBinding): ProjectLaunchHostInventoryRecord | null {
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

export function mergeInventory(
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

export function mergeTeamHostInventory(
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

export function hostRequirementInputSet(
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

export function bindingChanged(previous: ProjectLaunchResolvedHostBinding | undefined, next: ProjectLaunchResolvedHostBinding | undefined) {
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
