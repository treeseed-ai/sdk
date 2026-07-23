import {
	PROJECT_ENVIRONMENT_NAMES,
	PROJECT_LAUNCH_REQUIREMENT_KINDS,
	TEMPLATE_CONFIG_MERGE_STRATEGIES,
	TEMPLATE_CONFIG_WRITE_TARGETS,
	TEMPLATE_CONFIG_WRITE_WHEN,
	TEMPLATE_HOST_REQUIREMENT_TYPES,
	TEMPLATE_RESOURCE_REQUIREMENT_TYPES,
	TEMPLATE_SECRET_SENSITIVITIES,
	TEMPLATE_SECRET_SOURCES,
	TEMPLATE_SECRET_TARGETS,
	type ProjectEnvironmentName,
	type ProjectLaunchHostBindingInput,
	type ProjectLaunchRequirementKind,
	type TemplateConfigWrite,
	type TemplateConfigMergeStrategy,
	type TemplateConfigWriteTarget,
	type TemplateConfigWriteWhen,
	type TemplateEnvironmentWrite,
	type TemplateHostRequirement,
	type TemplateHostRequirementType,
	type TemplateLaunchRequirements,
	type TemplateResourceRequirement,
	type TemplateResourceRequirementType,
	type TemplateSecretRequirement,
	type TemplateSecretSensitivity,
	type TemplateSecretSource,
	type TemplateSecretTarget,
} from '../sdk-types.ts';
import { ProjectLaunchHostInventoryRecord, ProjectLaunchResolvedHostBinding, ResolveProjectLaunchHostBindingsOptions } from './mutable.ts';
import { bindingSelectedBy, defaultHostIds, hostUsabilityError, normalizeHostSnapshot, normalizeResourceSnapshot, resolveManagedHost, resolveTeamHost } from './parse-project-launch-host-binding-specs.ts';
import { hostMetadataType } from './normalize-host-requirement.ts';

export function resolveHostRequirementBinding(
	requirement: TemplateHostRequirement,
	input: ProjectLaunchHostBindingInput | undefined,
	options: ResolveProjectLaunchHostBindingsOptions,
	selectedAt: string,
) {
	const environmentScopes = input?.environmentScopes ?? ['staging', 'prod'];
	if (options.standardProjectLaunch !== false && (input?.type === 'capacity-provider' || input?.provider === 'capacity-provider')) {
		throw new Error(`${requirement.key} capacity-provider host bindings are not accepted for standard project launch.`);
	}
	if (input && input.requirementKind !== 'host') {
		throw new Error(`${requirement.key} must bind a host requirement.`);
	}
	if (input && input.type !== requirement.type) {
		throw new Error(`${requirement.key} requires host type "${requirement.type}", but received "${input.type}".`);
	}
	if (input && requirement.compatibleProviders?.length && !requirement.compatibleProviders.includes(input.provider)) {
		throw new Error(`${requirement.key} requires provider ${requirement.compatibleProviders.join(', ')}, but received "${input.provider}".`);
	}

	const inventory = requirement.type === 'repository'
		? options.repositoryHosts ?? []
		: [...(options.teamHosts ?? []), ...(options.managedHosts ?? [])];
	const teamInventory = requirement.type === 'repository'
		? options.repositoryHosts ?? []
		: options.teamHosts ?? [];
	let host: ProjectLaunchHostInventoryRecord | null = null;
	let managedHostKey = input?.managedHostKey ?? null;
	let hostId = input?.hostId ?? null;
	let provider = input?.provider ?? requirement.compatibleProviders?.[0] ?? '';
	let selectedBy: NonNullable<ProjectLaunchHostBindingInput['selectedBy']> = input?.selectedBy ?? 'user';

	if (input) {
		if (input.mode === 'treeseed_managed' || input.managedHostKey) {
			host = requirement.type === 'repository'
				? resolveTeamHost(requirement, inventory, environmentScopes, input.hostId ?? null)
				: resolveManagedHost(requirement, options.managedHosts ?? [], environmentScopes);
			if (!host) throw new Error(`${requirement.key} requires a compatible managed ${requirement.type} host.`);
			provider = host.provider;
			managedHostKey = input.managedHostKey ?? host.id;
			hostId = requirement.type === 'repository' ? input.hostId ?? host.id : null;
		} else if (input.hostId) {
			host = resolveTeamHost(requirement, inventory, environmentScopes, input.hostId);
			if (!host) throw new Error(`${requirement.key} selected host "${input.hostId}" is not available or compatible.`);
			provider = host.provider;
			hostId = host.id;
		} else if (requirement.required) {
			throw new Error(`${requirement.key} is required and must select a compatible host.`);
		}
	} else if (requirement.defaultSelection === 'team-default') {
		const defaultHostId = defaultHostIds(options.defaultHosts, requirement.key, requirement.type);
		host = defaultHostId ? resolveTeamHost(requirement, teamInventory, environmentScopes, defaultHostId) : null;
		if (!host && !defaultHostId) host = resolveTeamHost(requirement, teamInventory, environmentScopes);
		if (!host) host = resolveManagedHost(requirement, options.managedHosts ?? [], environmentScopes);
		if (host) {
			provider = host.provider;
			hostId = host.id;
			managedHostKey = host.ownership === 'treeseed_managed' ? host.id : null;
			selectedBy = defaultHostId ? 'team-default' : host.ownership === 'treeseed_managed' ? 'managed-default' : 'team-default';
		}
	} else if (requirement.defaultSelection === 'managed') {
		host = resolveManagedHost(requirement, options.managedHosts ?? [], environmentScopes);
		if (host) {
			provider = host.provider;
			managedHostKey = host.id;
			hostId = requirement.type === 'repository' ? host.id : null;
			selectedBy = 'managed-default';
		}
	}

	if (!host && requirement.required) {
		throw new Error(`${requirement.key} is required and no compatible ${requirement.type} host is available.`);
	}
	if (host) {
		const usabilityError = hostUsabilityError(host, requirement, requirement.required);
		if (usabilityError) throw new Error(usabilityError);
	}

	return {
		requirementKey: requirement.key,
		requirementKind: 'host' as const,
		type: requirement.type,
		provider,
		hostId,
		managedHostKey,
		displayName: input?.displayName ?? requirement.displayName,
		environmentScopes,
		configValues: input?.configValues ?? {},
		environmentValues: input?.environmentValues ?? {},
		secretRefs: input?.secretRefs ?? {},
		provenance: {
			selectedBy: bindingSelectedBy(input, host, selectedBy),
			selectedAt,
		},
		host: normalizeHostSnapshot(host),
	} satisfies ProjectLaunchResolvedHostBinding;
}

export function resolveResourceRequirementBinding(
	requirement: TemplateResourceRequirement,
	input: ProjectLaunchHostBindingInput | undefined,
	selectedAt: string,
) {
	if (!input) {
		if (requirement.required) {
			throw new Error(`${requirement.key} is required and must select a compatible resource.`);
		}
		return null;
	}
	const environmentScopes = input.environmentScopes ?? ['staging', 'prod'];
	if (input.requirementKind !== 'resource') {
		throw new Error(`${requirement.key} must bind a resource requirement.`);
	}
	if (input.type !== requirement.type) {
		throw new Error(`${requirement.key} requires resource type "${requirement.type}", but received "${input.type}".`);
	}
	if (requirement.compatibleProviders?.length && !requirement.compatibleProviders.includes(input.provider)) {
		throw new Error(`${requirement.key} requires provider ${requirement.compatibleProviders.join(', ')}, but received "${input.provider}".`);
	}
	return {
		requirementKey: requirement.key,
		requirementKind: 'resource' as const,
		type: requirement.type,
		provider: input.provider,
		hostId: input.hostId ?? null,
		managedHostKey: input.managedHostKey ?? null,
		displayName: input.displayName ?? requirement.displayName,
		environmentScopes,
		configValues: input.configValues ?? {},
		environmentValues: input.environmentValues ?? {},
		secretRefs: input.secretRefs ?? {},
		provenance: {
			selectedBy: input.selectedBy ?? 'user',
			selectedAt,
		},
		host: normalizeResourceSnapshot(input),
	} satisfies ProjectLaunchResolvedHostBinding;
}

export function resolveAdHocBinding(
	key: string,
	input: ProjectLaunchHostBindingInput,
	options: ResolveProjectLaunchHostBindingsOptions,
	selectedAt: string,
) {
	if (options.standardProjectLaunch !== false && (input.type === 'capacity-provider' || input.provider === 'capacity-provider')) {
		throw new Error(`${key} capacity-provider host bindings are not accepted for standard project launch.`);
	}
	const environmentScopes = input.environmentScopes ?? ['staging', 'prod'];
	const inventory = input.type === 'repository'
		? options.repositoryHosts ?? []
		: [...(options.teamHosts ?? []), ...(options.managedHosts ?? [])];
	let host: ProjectLaunchHostInventoryRecord | null = null;
	if (input.mode === 'treeseed_managed' || input.managedHostKey) {
		host = inventory.find((entry) => hostMetadataType(entry) === input.type && entry.provider === input.provider && entry.ownership === 'treeseed_managed') ?? null;
	} else if (input.hostId) {
		host = inventory.find((entry) => entry.id === input.hostId && hostMetadataType(entry) === input.type && entry.provider === input.provider) ?? null;
	}
	return {
		requirementKey: input.requirementKey ?? key,
		requirementKind: input.requirementKind,
		type: input.type,
		provider: input.provider,
		hostId: input.hostId ?? host?.id ?? null,
		managedHostKey: input.managedHostKey ?? (host?.ownership === 'treeseed_managed' ? host.id : null),
		displayName: input.displayName ?? host?.name ?? key,
		environmentScopes,
		configValues: input.configValues ?? {},
		environmentValues: input.environmentValues ?? {},
		secretRefs: input.secretRefs ?? {},
		provenance: {
			selectedBy: bindingSelectedBy(input, host, input.selectedBy ?? 'user'),
			selectedAt,
		},
		host: normalizeHostSnapshot(host),
	} satisfies ProjectLaunchResolvedHostBinding;
}

export function compatibilityFromBindings(bindings: Record<string, ProjectLaunchResolvedHostBinding>) {
	const sourceRepository = bindings.sourceRepository;
	const publicWeb = bindings.publicWeb;
	const transactionalEmail = bindings.transactionalEmail;
	const publicWebSelected = Boolean(publicWeb?.host || publicWeb?.hostId || publicWeb?.managedHostKey);
	const transactionalEmailSelected = Boolean(transactionalEmail?.host || transactionalEmail?.hostId || transactionalEmail?.managedHostKey);
	return {
		repositoryHostId: sourceRepository?.hostId ?? null,
		cloudflareHostMode: publicWebSelected && publicWeb
			? publicWeb.provenance.selectedBy === 'managed-default' || publicWeb.host?.ownership === 'treeseed_managed' || publicWeb.managedHostKey
				? 'treeseed_managed' as const
				: 'team_owned' as const
			: null,
		cloudflareHostId: publicWebSelected && publicWeb?.host?.ownership === 'team_owned' ? publicWeb.host.id : publicWebSelected && publicWeb?.hostId && !publicWeb.managedHostKey ? publicWeb.hostId : null,
		emailHostMode: transactionalEmailSelected && transactionalEmail
			? transactionalEmail.provenance.selectedBy === 'managed-default' || transactionalEmail.host?.ownership === 'treeseed_managed' || transactionalEmail.managedHostKey
				? 'treeseed_managed' as const
				: 'team_owned' as const
			: null,
		emailHostId: transactionalEmailSelected && transactionalEmail?.host?.ownership === 'team_owned' ? transactionalEmail.host.id : transactionalEmailSelected && transactionalEmail?.hostId && !transactionalEmail.managedHostKey ? transactionalEmail.hostId : null,
	};
}
