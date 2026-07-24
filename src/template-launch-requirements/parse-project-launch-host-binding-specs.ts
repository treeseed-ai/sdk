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
} from '../entrypoints/models/sdk-types.ts';
import { ParseProjectLaunchHostBindingSpecsOptions, ParseProjectLaunchHostBindingSpecsResult, ProjectLaunchHostInventoryRecord, ProjectLaunchLocalHostBindingSummary, expectString, validateRequirementKey } from './mutable.ts';
import { hostMetadataType, localHostMetadata, normalizeSpecList, portableHostConfigValues, safeLocalIdSegment } from './normalize-host-requirement.ts';

export function parseProjectLaunchHostBindingSpecs(options: ParseProjectLaunchHostBindingSpecsOptions): ParseProjectLaunchHostBindingSpecsResult {
	const specs = normalizeSpecList(options.specs);
	const hostRequirements = new Map((options.launchRequirements?.hosts ?? []).map((requirement) => [requirement.key, requirement]));
	const hostBindings: Record<string, ProjectLaunchHostBindingInput> = {};
	const repositoryHosts: ProjectLaunchHostInventoryRecord[] = [];
	const teamHosts: ProjectLaunchHostInventoryRecord[] = [];
	const managedHosts: ProjectLaunchHostInventoryRecord[] = [];
	const summaries: ProjectLaunchLocalHostBindingSummary[] = [];
	const omitted: ProjectLaunchLocalHostBindingSummary[] = [];

	for (const spec of specs) {
		const separatorIndex = spec.indexOf('=');
		if (separatorIndex < 1 || separatorIndex === spec.length - 1) {
			throw new Error(`Invalid host binding spec "${spec}". Expected <requirement>=<provider>:<alias> or <requirement>=none.`);
		}
		const key = validateRequirementKey(spec.slice(0, separatorIndex).trim(), `host binding spec "${spec}" requirement`);
		const value = spec.slice(separatorIndex + 1).trim();
		const requirement = hostRequirements.get(key);
		if (!requirement) {
			throw new Error(`Unknown host binding requirement "${key}".`);
		}
		if (value === 'none') {
			if (requirement.required) {
				throw new Error(`${key} is required and cannot be set to none.`);
			}
			omitted.push({
				requirementKey: key,
				requirementKind: 'host',
				type: requirement.type,
				provider: null,
				alias: null,
				mode: 'none',
				displayName: requirement.displayName,
			});
			delete hostBindings[key];
			continue;
		}

		const [rawProvider, ...aliasParts] = value.split(':');
		const provider = expectString(rawProvider, `${key} provider`);
		const alias = expectString(aliasParts.join(':'), `${key} alias`);
		if (requirement.compatibleProviders?.length && !requirement.compatibleProviders.includes(provider)) {
			throw new Error(`${key} requires provider ${requirement.compatibleProviders.join(', ')}, but received "${provider}".`);
		}
		if (String(requirement.type) === 'capacity-provider' || provider === 'capacity-provider') {
			throw new Error(`${key} capacity-provider host bindings are not accepted for standard project launch.`);
		}

		const managed = alias === 'managed';
		const localSegment = `${safeLocalIdSegment(key)}-${safeLocalIdSegment(provider)}-${safeLocalIdSegment(alias)}`;
		const hostId = managed
			? `local-managed:${localSegment}`
			: `local:${localSegment}`;
		const displayName = managed
			? `Managed ${requirement.displayName}`
			: `${requirement.displayName} (${alias})`;
		const host: ProjectLaunchHostInventoryRecord = {
			id: hostId,
			type: requirement.type,
			provider,
			ownership: managed ? 'treeseed_managed' : 'team_owned',
			name: displayName,
			accountLabel: alias,
			organizationOrOwner: requirement.type === 'repository' ? alias : undefined,
			allowedEnvironments: ['local', 'staging', 'prod'],
			status: 'active',
			metadata: localHostMetadata(requirement, managed),
		};
		if (managed) {
			managedHosts.push(host);
		} else if (requirement.type === 'repository') {
			repositoryHosts.push(host);
		} else {
			teamHosts.push(host);
		}
		hostBindings[key] = {
			requirementKey: key,
			requirementKind: 'host',
			type: requirement.type,
			provider,
			hostId: managed ? null : hostId,
			managedHostKey: managed ? hostId : null,
			mode: managed ? 'treeseed_managed' : 'team_owned',
			displayName,
			environmentScopes: ['local', 'staging', 'prod'],
			configValues: portableHostConfigValues(requirement, provider, alias),
			environmentValues: {},
			secretRefs: {},
			selectedBy: managed ? 'managed-default' : 'user',
		};
		summaries.push({
			requirementKey: key,
			requirementKind: 'host',
			type: requirement.type,
			provider,
			alias,
			mode: managed ? 'treeseed_managed' : 'team_owned',
			displayName,
		});
	}

	return {
		hostBindings,
		repositoryHosts,
		teamHosts,
		managedHosts,
		summaries,
		omitted,
	};
}

export function defaultHostIds(defaultHosts?: Record<string, unknown> | null, requirementKey?: string, type?: string) {
	const keys = [
		requirementKey,
		type,
		requirementKey === 'sourceRepository' ? 'repository' : null,
		requirementKey === 'publicWeb' ? 'web' : null,
		requirementKey === 'transactionalEmail' ? 'email' : null,
	].filter(Boolean) as string[];
	for (const key of keys) {
		const value = defaultHosts?.[key];
		if (typeof value === 'string' && value.trim()) return value.trim();
	}
	return null;
}

export function hostMatchesRequirement(
	host: ProjectLaunchHostInventoryRecord,
	requirement: TemplateHostRequirement,
	environmentScopes: ProjectEnvironmentName[],
) {
	if (hostMetadataType(host) !== requirement.type) return false;
	if (requirement.compatibleProviders?.length && !requirement.compatibleProviders.includes(host.provider)) return false;
	if (host.allowedEnvironments?.length) {
		return environmentScopes.every((scope) => host.allowedEnvironments?.includes(scope));
	}
	return true;
}

export function hostUsabilityError(
	host: ProjectLaunchHostInventoryRecord,
	requirement: TemplateHostRequirement,
	required: boolean,
) {
	if (!required) return null;
	const status = typeof host.status === 'string' ? host.status : 'active';
	if (status === 'active' || status === 'ready') return null;
	return `${requirement.key} selected host "${host.name ?? host.id}" is not active (${status}).`;
}

export function resolveManagedHost(
	requirement: TemplateHostRequirement,
	managedHosts: ProjectLaunchHostInventoryRecord[],
	environmentScopes: ProjectEnvironmentName[],
) {
	return managedHosts.find((host) => hostMatchesRequirement(host, requirement, environmentScopes)) ?? null;
}

export function resolveTeamHost(
	requirement: TemplateHostRequirement,
	hosts: ProjectLaunchHostInventoryRecord[],
	environmentScopes: ProjectEnvironmentName[],
	id?: string | null,
) {
	return hosts.find((host) => (!id || host.id === id) && hostMatchesRequirement(host, requirement, environmentScopes)) ?? null;
}

export function normalizeHostSnapshot(host: ProjectLaunchHostInventoryRecord | null) {
	if (!host) return null;
	return {
		id: host.id,
		name: host.name ?? null,
		ownership: host.ownership ?? null,
		status: host.status ?? null,
		accountLabel: host.accountLabel ?? null,
		organizationOrOwner: host.organizationOrOwner ?? null,
		metadata: host.metadata ? {
			hostType: host.metadata.hostType,
			dns: host.metadata.dns,
			managed: host.metadata.managed,
			configured: host.metadata.configured,
			missingConfigKeys: host.metadata.missingConfigKeys,
		} : undefined,
	};
}

export function normalizeResourceSnapshot(binding: ProjectLaunchHostBindingInput) {
	const id = binding.hostId ?? binding.managedHostKey ?? null;
	if (!id) return null;
	return {
		id,
		name: binding.displayName ?? id,
		ownership: binding.managedHostKey ? 'treeseed_managed' : 'team_owned',
		status: 'active',
		accountLabel: null,
		organizationOrOwner: null,
		metadata: {
			hostType: binding.type,
			resource: true,
		},
	};
}

export function bindingSelectedBy(binding: ProjectLaunchHostBindingInput | undefined, host: ProjectLaunchHostInventoryRecord | null, fallback: NonNullable<ProjectLaunchHostBindingInput['selectedBy']>) {
	if (binding?.selectedBy) return binding.selectedBy;
	if (host?.ownership === 'treeseed_managed') return 'managed-default';
	return fallback;
}
