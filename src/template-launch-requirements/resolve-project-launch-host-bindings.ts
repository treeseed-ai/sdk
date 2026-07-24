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
import { ProjectLaunchConfigWritePlanItem, ProjectLaunchResolvedHostBinding, ProjectLaunchSecretDeploymentPlanItem, ResolveProjectLaunchHostBindingsOptions, ResolveProjectLaunchHostBindingsResult } from './mutable.ts';
import { allRequirements } from './normalize-host-requirement.ts';
import { compatibilityFromBindings, resolveAdHocBinding, resolveHostRequirementBinding, resolveResourceRequirementBinding } from './resolve-host-requirement-binding.ts';

export function resolveProjectLaunchHostBindings(options: ResolveProjectLaunchHostBindingsOptions): ResolveProjectLaunchHostBindingsResult {
	const selectedAt = options.selectedAt ?? new Date().toISOString();
	const inputs = options.hostBindings ?? {};
	const hostBindings: Record<string, ProjectLaunchResolvedHostBinding> = {};
	const configWritePlan: ProjectLaunchConfigWritePlanItem[] = [];
	const secretItems: ProjectLaunchSecretDeploymentPlanItem[] = [];
	const requirementKeys = new Set<string>();

	for (const requirement of allRequirements(options.launchRequirements)) {
		requirementKeys.add(requirement.key);
		if (requirement.kind === 'host') {
			const binding = resolveHostRequirementBinding(requirement, inputs[requirement.key], options, selectedAt);
			if (binding.host || requirement.required || inputs[requirement.key]) {
				hostBindings[requirement.key] = binding;
				for (const write of requirement.configWrites ?? []) {
					configWritePlan.push({
						...write,
						requirementKey: requirement.key,
						requirementKind: 'host',
						requirementType: requirement.type,
						provider: binding.provider,
					});
				}
				for (const write of requirement.environmentWrites ?? []) {
					secretItems.push({
						requirementKey: requirement.key,
						requirementKind: 'host',
						env: write.env,
						sensitivity: write.sensitivity ?? 'plain',
						source: write.valueFrom,
						targets: write.targets ?? [],
						scopes: write.scopes ?? binding.environmentScopes,
						sourceHostId: binding.hostId ?? binding.host?.id ?? null,
					});
				}
			}
			continue;
		}
		if (options.standardProjectLaunch !== false && requirement.kind === 'resource') {
			throw new Error(`${requirement.key} resource requirements are not accepted for standard project launch yet.`);
		}
		if (requirement.kind === 'resource') {
			const binding = resolveResourceRequirementBinding(requirement, inputs[requirement.key], selectedAt);
			if (binding) {
				hostBindings[requirement.key] = binding;
				for (const write of requirement.configWrites ?? []) {
					configWritePlan.push({
						...write,
						requirementKey: requirement.key,
						requirementKind: 'resource',
						requirementType: requirement.type,
						provider: binding.provider,
					});
				}
				for (const write of requirement.environmentWrites ?? []) {
					secretItems.push({
						requirementKey: requirement.key,
						requirementKind: 'resource',
						env: write.env,
						sensitivity: write.sensitivity ?? 'plain',
						source: write.valueFrom,
						targets: write.targets ?? [],
						scopes: write.scopes ?? binding.environmentScopes,
						sourceHostId: binding.hostId ?? binding.managedHostKey ?? binding.host?.id ?? null,
					});
				}
			}
			continue;
		}
		if (requirement.kind === 'secret') {
			if (requirement.required && requirement.source === 'selected-host' && !inputs[requirement.key]) {
				throw new Error(`${requirement.key} is required and must resolve from a selected host.`);
			}
			secretItems.push({
				requirementKey: requirement.key,
				requirementKind: 'secret',
				env: requirement.env,
				sensitivity: requirement.sensitivity,
				source: requirement.source,
				targets: requirement.targets,
				scopes: ['staging', 'prod'],
				sourceHostId: inputs[requirement.key]?.hostId ?? null,
			});
		}
	}

	for (const [key, input] of Object.entries(inputs)) {
		if (!requirementKeys.has(key)) {
			hostBindings[key] = resolveAdHocBinding(key, input, options, selectedAt);
		}
	}

	return {
		hostBindings,
		compatibility: compatibilityFromBindings(hostBindings),
		configWritePlan,
		secretDeploymentPlan: { items: secretItems },
		diagnostics: [],
	};
}
