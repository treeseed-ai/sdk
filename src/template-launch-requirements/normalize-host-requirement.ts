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
import { Mutable, ParseProjectLaunchHostBindingSpecsOptions, ProjectLaunchHostInventoryRecord, expectArray, expectEnum, expectRecord, expectString, normalizeBoolean, normalizeConfigWrite, normalizeEnvironmentWrite, optionalEnum, optionalRecord, optionalRecordOfStrings, optionalString, optionalStringArray, validateRequirementKey } from './mutable.ts';

export function normalizeHostRequirement(value: unknown, index: number): TemplateHostRequirement {
	const label = `launchRequirements.hosts[${index}]`;
	const record = expectRecord(value, label);
	const kind = record.kind === undefined ? 'host' : expectString(record.kind, `${label}.kind`);
	if (kind !== 'host') throw new Error(`${label}.kind must be "host".`);
	return {
		kind: 'host',
		key: validateRequirementKey(expectString(record.key, `${label}.key`), `${label}.key`),
		type: expectEnum(record.type, TEMPLATE_HOST_REQUIREMENT_TYPES, `${label}.type`) as TemplateHostRequirementType,
		required: normalizeBoolean(record.required),
		compatibleProviders: optionalStringArray(record.compatibleProviders, `${label}.compatibleProviders`),
		displayName: expectString(record.displayName, `${label}.displayName`),
		purpose: expectString(record.purpose, `${label}.purpose`),
		defaultSelection: optionalEnum(record.defaultSelection, ['team-default', 'managed', 'none'] as const, `${label}.defaultSelection`),
		configWrites: expectArray(record.configWrites, `${label}.configWrites`).map((entry, writeIndex) =>
			normalizeConfigWrite(entry, `${label}.configWrites[${writeIndex}]`)),
		environmentWrites: expectArray(record.environmentWrites, `${label}.environmentWrites`).map((entry, writeIndex) =>
			normalizeEnvironmentWrite(entry, `${label}.environmentWrites[${writeIndex}]`)),
	};
}

export function normalizeResourceRequirement(value: unknown, index: number): TemplateResourceRequirement {
	const label = `launchRequirements.resources[${index}]`;
	const record = expectRecord(value, label);
	const kind = record.kind === undefined ? 'resource' : expectString(record.kind, `${label}.kind`);
	if (kind !== 'resource') throw new Error(`${label}.kind must be "resource".`);
	return {
		kind: 'resource',
		key: validateRequirementKey(expectString(record.key, `${label}.key`), `${label}.key`),
		type: expectEnum(record.type, TEMPLATE_RESOURCE_REQUIREMENT_TYPES, `${label}.type`) as TemplateResourceRequirementType,
		required: normalizeBoolean(record.required),
		compatibleProviders: optionalStringArray(record.compatibleProviders, `${label}.compatibleProviders`),
		displayName: expectString(record.displayName, `${label}.displayName`),
		purpose: expectString(record.purpose, `${label}.purpose`),
		configWrites: expectArray(record.configWrites, `${label}.configWrites`).map((entry, writeIndex) =>
			normalizeConfigWrite(entry, `${label}.configWrites[${writeIndex}]`)),
		environmentWrites: expectArray(record.environmentWrites, `${label}.environmentWrites`).map((entry, writeIndex) =>
			normalizeEnvironmentWrite(entry, `${label}.environmentWrites[${writeIndex}]`)),
	};
}

export function normalizeSecretRequirement(value: unknown, index: number): TemplateSecretRequirement {
	const label = `launchRequirements.secrets[${index}]`;
	const record = expectRecord(value, label);
	const kind = record.kind === undefined ? 'secret' : expectString(record.kind, `${label}.kind`);
	if (kind !== 'secret') throw new Error(`${label}.kind must be "secret".`);
	return {
		kind: 'secret',
		key: validateRequirementKey(expectString(record.key, `${label}.key`), `${label}.key`),
		env: expectString(record.env, `${label}.env`),
		required: normalizeBoolean(record.required),
		sensitivity: expectEnum(record.sensitivity, TEMPLATE_SECRET_SENSITIVITIES, `${label}.sensitivity`) as TemplateSecretSensitivity,
		targets: expectArray(record.targets, `${label}.targets`).map((target, targetIndex) =>
			expectEnum(target, TEMPLATE_SECRET_TARGETS, `${label}.targets[${targetIndex}]`) as TemplateSecretTarget),
		source: expectEnum(record.source, TEMPLATE_SECRET_SOURCES, `${label}.source`) as TemplateSecretSource,
	};
}

export function normalizeTemplateLaunchRequirements(value: unknown, label = 'launchRequirements'): TemplateLaunchRequirements | undefined {
	if (value === undefined || value === null) return undefined;
	const record = expectRecord(value, label);
	const version = record.version === undefined || record.version === null
		? undefined
		: Number(record.version);
	if (version !== undefined && (!Number.isInteger(version) || version < 1)) {
		throw new Error(`${label}.version must be a positive integer.`);
	}
	return {
		version,
		hosts: expectArray(record.hosts, `${label}.hosts`).map(normalizeHostRequirement),
		resources: expectArray(record.resources, `${label}.resources`).map(normalizeResourceRequirement),
		secrets: expectArray(record.secrets, `${label}.secrets`).map(normalizeSecretRequirement),
	};
}

export function validateTemplateLaunchRequirements(value: unknown, label = 'launchRequirements') {
	normalizeTemplateLaunchRequirements(value, label);
}

export function normalizeEnvironmentScopes(value: unknown, label: string) {
	return optionalStringArray(value, label)?.map((scope, index) =>
		expectEnum(scope, PROJECT_ENVIRONMENT_NAMES, `${label}[${index}]`) as ProjectEnvironmentName);
}

export function normalizeBinding(value: unknown, key: string): ProjectLaunchHostBindingInput {
	const label = `hostBindings.${key}`;
	const record = expectRecord(value, label);
	const requirementKind = optionalEnum(record.requirementKind ?? record.kind, PROJECT_LAUNCH_REQUIREMENT_KINDS, `${label}.requirementKind`) as ProjectLaunchRequirementKind | undefined;
	const normalized: ProjectLaunchHostBindingInput = {
		requirementKey: validateRequirementKey(optionalString(record.requirementKey) ?? key, `${label}.requirementKey`),
		requirementKind: requirementKind ?? 'host',
		type: expectString(record.type, `${label}.type`),
		provider: expectString(record.provider, `${label}.provider`),
		hostId: optionalString(record.hostId) ?? null,
		managedHostKey: optionalString(record.managedHostKey) ?? null,
		mode: optionalString(record.mode) ?? null,
		displayName: optionalString(record.displayName),
		environmentScopes: normalizeEnvironmentScopes(record.environmentScopes, `${label}.environmentScopes`),
		configValues: optionalRecord(record.configValues, `${label}.configValues`),
		environmentValues: optionalRecordOfStrings(record.environmentValues, `${label}.environmentValues`),
		secretRefs: optionalRecordOfStrings(record.secretRefs, `${label}.secretRefs`),
		selectedBy: optionalEnum(record.selectedBy, ['user', 'team-default', 'managed-default', 'template-default'] as const, `${label}.selectedBy`),
	};
	return normalized;
}

export function defaultScopes(input: Record<string, unknown>) {
	return normalizeEnvironmentScopes(input.targetEnvironments, 'targetEnvironments') ?? ['staging', 'prod'];
}

export function deriveLegacyBindings(input: Record<string, unknown>) {
	const intent = optionalRecord(input.intent, 'intent');
	const repository = optionalRecord(intent?.repository, 'intent.repository');
	const bindings: Record<string, ProjectLaunchHostBindingInput> = {};
	const scopes = defaultScopes(input);
	const repositoryHostId = optionalString(repository?.hostId) ?? optionalString(input.repositoryHostId) ?? 'platform:github:hosted-hubs';
	bindings.sourceRepository = {
		requirementKey: 'sourceRepository',
		requirementKind: 'host',
		type: 'repository',
		provider: 'github',
		hostId: repositoryHostId,
		mode: repositoryHostId.startsWith('platform:') ? 'treeseed_managed' : undefined,
		environmentScopes: scopes,
		selectedBy: repositoryHostId.startsWith('platform:') ? 'managed-default' : 'user',
	};

	const cloudflareHostMode = optionalString(input.cloudflareHostMode);
	const cloudflareHostId = optionalString(input.cloudflareHostId);
	if (cloudflareHostMode || cloudflareHostId) {
		bindings.publicWeb = {
			requirementKey: 'publicWeb',
			requirementKind: 'host',
			type: 'web',
			provider: 'cloudflare',
			hostId: cloudflareHostMode === 'team_owned' ? cloudflareHostId ?? null : null,
			managedHostKey: cloudflareHostMode === 'treeseed_managed' ? 'treeseed-managed-cloudflare' : null,
			mode: cloudflareHostMode ?? null,
			environmentScopes: scopes,
			selectedBy: cloudflareHostMode === 'treeseed_managed' ? 'managed-default' : 'user',
		};
	}

	const emailHostMode = optionalString(input.emailHostMode);
	const emailHostId = optionalString(input.emailHostId);
	if (emailHostMode || emailHostId) {
		bindings.transactionalEmail = {
			requirementKey: 'transactionalEmail',
			requirementKind: 'host',
			type: 'email',
			provider: 'smtp',
			hostId: emailHostMode === 'team_owned' ? emailHostId ?? null : null,
			managedHostKey: emailHostMode === 'treeseed_managed' ? 'treeseed-managed-email' : null,
			mode: emailHostMode ?? null,
			environmentScopes: scopes,
			selectedBy: emailHostMode === 'treeseed_managed' ? 'managed-default' : 'user',
		};
	}

	return bindings;
}

export function normalizeProjectLaunchHostBindings(input: unknown) {
	const record = expectRecord(input, 'project launch request');
	const normalized: Mutable<Record<string, ProjectLaunchHostBindingInput>> = {};
	for (const [key, binding] of Object.entries(optionalRecord(record.hostBindings, 'hostBindings') ?? {})) {
		normalized[validateRequirementKey(key, `hostBindings key "${key}"`)] = normalizeBinding(binding, key);
	}
	for (const [key, binding] of Object.entries(deriveLegacyBindings(record))) {
		if (!normalized[key]) normalized[key] = binding;
	}
	return normalized;
}

export function hostMetadataType(host: ProjectLaunchHostInventoryRecord) {
	const metadataType = typeof host.metadata?.hostType === 'string' ? host.metadata.hostType : host.type;
	if (metadataType === 'repository_host' || metadataType === 'repository') return 'repository';
	if (metadataType === 'web_host' || metadataType === 'cloudflare' || metadataType === 'web') return 'web';
	if (metadataType === 'email_host' || metadataType === 'smtp' || metadataType === 'email') return 'email';
	if (metadataType === 'ai_host' || metadataType === 'ai') return 'ai';
	if (metadataType === 'knowledge_library' || metadataType === 'knowledge-library' || metadataType === 'treedx') return 'knowledge-library';
	if (host.provider === 'smtp') return 'email';
	if (host.provider === 'cloudflare') return 'web';
	if (host.provider === 'github') return 'repository';
	if (host.provider === 'treedx') return 'knowledge-library';
	return metadataType ?? '';
}

export function allRequirements(launchRequirements?: TemplateLaunchRequirements | null) {
	return [
		...(launchRequirements?.hosts ?? []),
		...(launchRequirements?.resources ?? []),
		...(launchRequirements?.secrets ?? []),
	];
}

export function normalizeSpecList(specs: ParseProjectLaunchHostBindingSpecsOptions['specs']) {
	if (!specs) return [];
	return (Array.isArray(specs) ? specs : [specs])
		.flatMap((entry) => String(entry).split(','))
		.map((entry) => entry.trim())
		.filter(Boolean);
}

export function safeLocalIdSegment(value: string) {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		|| 'local';
}

export function portableHostConfigValues(requirement: TemplateHostRequirement, provider: string, alias: string) {
	const values: Record<string, unknown> = {
		localAlias: alias,
		provider,
	};
	if (requirement.type === 'repository' && provider === 'github') {
		values.owner = alias;
		values.github = { owner: alias };
		return values;
	}
	if (requirement.type === 'web' && provider === 'cloudflare') {
		values.cloudflare = { account: alias };
		return values;
	}
	if (requirement.type === 'email' && provider === 'smtp') {
		values.smtp = { profile: alias };
		return values;
	}
	if (requirement.type === 'knowledge-library' && provider === 'treedx') {
		values.treeDx = {
			instance: alias,
			contentAccessMode: 'treedx',
		};
		return values;
	}
	return values;
}

export function localHostMetadata(requirement: TemplateHostRequirement, managed: boolean) {
	return {
		hostType: requirement.type,
		managed,
		configured: true,
		local: true,
	};
}
