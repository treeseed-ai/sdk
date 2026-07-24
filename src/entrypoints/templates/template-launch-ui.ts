import type {
	ProjectEnvironmentName,
	TemplateHostRequirement,
	TemplateLaunchRequirements,
	TemplateResourceRequirement,
	TemplateSecretRequirement,
	TemplateSecretTarget,
} from '../models/sdk-types.ts';
import type { ProjectLaunchHostInventoryRecord } from './template-launch-requirements.ts';

export interface ProjectLaunchRequirementHostChoice {
	value: string;
	label: string;
	mode: 'none' | 'team_owned' | 'treeseed_managed' | 'new';
	hostId?: string | null;
	managedHostKey?: string | null;
	provider: string;
	type: string;
	selected: boolean;
	readiness: 'ready' | 'configuration_required' | 'inactive' | 'new' | 'none';
	rootDomain?: string | null;
}

export interface ProjectLaunchHostRequirementViewModel {
	kind: 'host';
	key: string;
	type: string;
	displayName: string;
	purpose: string;
	required: boolean;
	compatibleProviders: string[];
	defaultSelection?: 'team-default' | 'managed' | 'none';
	environmentScopes: ProjectEnvironmentName[];
	configWritePreviews: Array<{ target: string; path: string; valueFrom: string; writeWhen?: string }>;
	environmentWritePreviews: Array<{ env: string; targets: string[]; scopes: ProjectEnvironmentName[]; sensitivity: string }>;
	choices: ProjectLaunchRequirementHostChoice[];
}

export interface ProjectLaunchResourceRequirementViewModel {
	kind: 'resource';
	key: string;
	type: string;
	displayName: string;
	purpose: string;
	required: boolean;
	compatibleProviders: string[];
	configWritePreviews: Array<{ target: string; path: string; valueFrom: string; writeWhen?: string }>;
	environmentWritePreviews: Array<{ env: string; targets: string[]; scopes: ProjectEnvironmentName[]; sensitivity: string }>;
	status: 'unsupported_in_standard_launch';
}

export interface ProjectLaunchSecretRequirementViewModel {
	kind: 'secret';
	key: string;
	env: string;
	required: boolean;
	sensitivity: string;
	source: string;
	targets: TemplateSecretTarget[];
	status: 'planned';
}

export interface ProjectLaunchRequirementsViewModel {
	version?: number;
	hosts: ProjectLaunchHostRequirementViewModel[];
	resources: ProjectLaunchResourceRequirementViewModel[];
	secrets: ProjectLaunchSecretRequirementViewModel[];
}

export interface DeriveProjectLaunchRequirementsViewModelOptions {
	launchRequirements?: TemplateLaunchRequirements | null;
	repositoryHosts?: ProjectLaunchHostInventoryRecord[];
	teamHosts?: ProjectLaunchHostInventoryRecord[];
	managedHosts?: ProjectLaunchHostInventoryRecord[];
	defaultHosts?: Record<string, unknown> | null;
	environmentScopes?: ProjectEnvironmentName[];
}

function hostType(host: ProjectLaunchHostInventoryRecord) {
	const metadataType = typeof host.metadata?.hostType === 'string' ? host.metadata.hostType : host.type;
	if (metadataType === 'repository_host' || metadataType === 'repository') return 'repository';
	if (metadataType === 'web_host' || metadataType === 'cloudflare' || metadataType === 'web') return 'web';
	if (metadataType === 'email_host' || metadataType === 'smtp' || metadataType === 'email') return 'email';
	if (metadataType === 'ai_host' || metadataType === 'ai') return 'ai';
	if (host.provider === 'github') return 'repository';
	if (host.provider === 'cloudflare') return 'web';
	if (host.provider === 'smtp') return 'email';
	return metadataType ?? '';
}

function rootDomain(host: ProjectLaunchHostInventoryRecord) {
	const metadata = host.metadata ?? {};
	const dns = metadata.dns && typeof metadata.dns === 'object' ? metadata.dns as Record<string, unknown> : {};
	const value = dns.zoneName ?? dns.rootDomain ?? metadata.rootDomain ?? metadata.webRootDomain ?? metadata.cloudflareZoneName;
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function hostLabel(host: ProjectLaunchHostInventoryRecord, fallback: string) {
	const ownership = host.ownership === 'treeseed_managed'
		? 'managed'
		: host.accountLabel ?? host.organizationOrOwner ?? host.provider ?? 'team-owned';
	return `${host.name || fallback} (${ownership})`;
}

function compatibleHosts(
	requirement: TemplateHostRequirement,
	options: DeriveProjectLaunchRequirementsViewModelOptions,
) {
	const source = requirement.type === 'repository'
		? options.repositoryHosts ?? []
		: [...(options.teamHosts ?? []), ...(options.managedHosts ?? [])];
	return source.filter((host) => {
		if (hostType(host) !== requirement.type) return false;
		return !requirement.compatibleProviders?.length || requirement.compatibleProviders.includes(host.provider);
	});
}

function defaultHostId(requirement: TemplateHostRequirement, defaultHosts?: Record<string, unknown> | null) {
	for (const key of [requirement.key, requirement.type, requirement.key === 'sourceRepository' ? 'repository' : null, requirement.key === 'publicWeb' ? 'web' : null, requirement.key === 'transactionalEmail' ? 'email' : null]) {
		if (!key) continue;
		const value = defaultHosts?.[key];
		if (typeof value === 'string' && value.trim()) return value.trim();
	}
	return null;
}

function selectedChoiceIndex(choices: ProjectLaunchRequirementHostChoice[], requirement: TemplateHostRequirement, defaultHosts?: Record<string, unknown> | null) {
	const configuredDefault = defaultHostId(requirement, defaultHosts);
	if (configuredDefault) {
		const index = choices.findIndex((choice) => choice.hostId === configuredDefault || choice.managedHostKey === configuredDefault);
		if (index >= 0) return index;
	}
	if (requirement.defaultSelection === 'team-default') {
		const teamIndex = choices.findIndex((choice) => choice.mode === 'team_owned');
		if (teamIndex >= 0) return teamIndex;
	}
	if (requirement.defaultSelection === 'managed' || requirement.defaultSelection === 'team-default') {
		const managedIndex = choices.findIndex((choice) => choice.mode === 'treeseed_managed');
		if (managedIndex >= 0) return managedIndex;
	}
	if (!requirement.required) {
		const noneIndex = choices.findIndex((choice) => choice.mode === 'none');
		if (noneIndex >= 0) return noneIndex;
	}
	return choices.length > 0 ? 0 : -1;
}

function deriveHostRequirement(requirement: TemplateHostRequirement, options: DeriveProjectLaunchRequirementsViewModelOptions): ProjectLaunchHostRequirementViewModel {
	const scopes = options.environmentScopes ?? ['staging', 'prod'];
	const choices = compatibleHosts(requirement, options).map((host) => {
		const managed = host.ownership === 'treeseed_managed';
		const status = typeof host.status === 'string' && host.status ? host.status : 'active';
		return {
			value: `${managed ? 'treeseed_managed' : 'team_owned'}:${host.id}`,
			label: hostLabel(host, requirement.displayName),
			mode: managed ? 'treeseed_managed' as const : 'team_owned' as const,
			hostId: managed && requirement.type !== 'repository' ? null : host.id,
			managedHostKey: managed ? host.id : null,
			provider: host.provider,
			type: requirement.type,
			selected: false,
			readiness: status === 'active' || status === 'ready' ? 'ready' as const : status === 'configuration_required' ? 'configuration_required' as const : 'inactive' as const,
			rootDomain: rootDomain(host),
		};
	});
	if (requirement.type === 'repository' && !choices.some((choice) => choice.value === 'treeseed_managed:platform:github:hosted-hubs' || choice.value === 'team_owned:platform:github:hosted-hubs')) {
		choices.unshift({
			value: 'treeseed_managed:platform:github:hosted-hubs',
			label: 'TreeSeed hosted repositories (managed)',
			mode: 'treeseed_managed',
			hostId: 'platform:github:hosted-hubs',
			managedHostKey: 'platform:github:hosted-hubs',
			provider: 'github',
			type: 'repository',
			selected: false,
			readiness: 'ready',
			rootDomain: null,
		});
	}
	if (!requirement.required) {
		choices.push({
			value: `none:${requirement.key}`,
			label: `No ${requirement.displayName.toLowerCase()}`,
			mode: 'none',
			hostId: null,
			managedHostKey: null,
			provider: requirement.compatibleProviders?.[0] ?? '',
			type: requirement.type,
			selected: false,
			readiness: 'none',
			rootDomain: null,
		});
	}
	choices.push({
		value: `new:${requirement.type}`,
		label: `Create new ${requirement.type} host...`,
		mode: 'new',
		hostId: null,
		managedHostKey: null,
		provider: requirement.compatibleProviders?.[0] ?? '',
		type: requirement.type,
		selected: false,
		readiness: 'new',
		rootDomain: null,
	});
	const selectedIndex = selectedChoiceIndex(choices, requirement, options.defaultHosts);
	if (selectedIndex >= 0) choices[selectedIndex] = { ...choices[selectedIndex]!, selected: true };

	return {
		kind: 'host',
		key: requirement.key,
		type: requirement.type,
		displayName: requirement.displayName,
		purpose: requirement.purpose,
		required: requirement.required,
		compatibleProviders: requirement.compatibleProviders ?? [],
		defaultSelection: requirement.defaultSelection,
		environmentScopes: scopes,
		configWritePreviews: (requirement.configWrites ?? []).map((write) => ({
			target: write.target,
			path: write.path,
			valueFrom: write.valueFrom,
			writeWhen: write.writeWhen,
		})),
		environmentWritePreviews: (requirement.environmentWrites ?? []).map((write) => ({
			env: write.env,
			targets: write.targets ?? [],
			scopes: write.scopes ?? scopes,
			sensitivity: write.sensitivity ?? 'plain',
		})),
		choices,
	};
}

function deriveResourceRequirement(requirement: TemplateResourceRequirement): ProjectLaunchResourceRequirementViewModel {
	return {
		kind: 'resource',
		key: requirement.key,
		type: requirement.type,
		displayName: requirement.displayName,
		purpose: requirement.purpose,
		required: requirement.required,
		compatibleProviders: requirement.compatibleProviders ?? [],
		configWritePreviews: (requirement.configWrites ?? []).map((write) => ({
			target: write.target,
			path: write.path,
			valueFrom: write.valueFrom,
			writeWhen: write.writeWhen,
		})),
		environmentWritePreviews: (requirement.environmentWrites ?? []).map((write) => ({
			env: write.env,
			targets: write.targets ?? [],
			scopes: write.scopes ?? ['staging', 'prod'],
			sensitivity: write.sensitivity ?? 'plain',
		})),
		status: 'unsupported_in_standard_launch',
	};
}

function deriveSecretRequirement(requirement: TemplateSecretRequirement): ProjectLaunchSecretRequirementViewModel {
	return {
		kind: 'secret',
		key: requirement.key,
		env: requirement.env,
		required: requirement.required,
		sensitivity: requirement.sensitivity,
		source: requirement.source,
		targets: requirement.targets,
		status: 'planned',
	};
}

export function deriveProjectLaunchRequirementsViewModel(options: DeriveProjectLaunchRequirementsViewModelOptions): ProjectLaunchRequirementsViewModel {
	const launchRequirements = options.launchRequirements ?? {};
	return {
		version: launchRequirements.version,
		hosts: (launchRequirements.hosts ?? []).map((requirement) => deriveHostRequirement(requirement, options)),
		resources: (launchRequirements.resources ?? []).map(deriveResourceRequirement),
		secrets: (launchRequirements.secrets ?? []).map(deriveSecretRequirement),
	};
}
