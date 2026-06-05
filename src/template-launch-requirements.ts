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
} from './sdk-types.ts';

type Mutable<T> = { -readonly [P in keyof T]: T[P] };

export type { TemplateLaunchRequirements } from './sdk-types.ts';

export interface ProjectLaunchHostInventoryRecord {
	id: string;
	type?: string | null;
	provider: string;
	ownership?: string | null;
	name?: string | null;
	accountLabel?: string | null;
	organizationOrOwner?: string | null;
	allowedEnvironments?: ProjectEnvironmentName[];
	status?: string | null;
	metadata?: Record<string, unknown>;
}

export interface ProjectLaunchResolvedHostBinding {
	requirementKey: string;
	requirementKind: ProjectLaunchRequirementKind;
	type: string;
	provider: string;
	hostId?: string | null;
	managedHostKey?: string | null;
	displayName: string;
	environmentScopes: ProjectEnvironmentName[];
	configValues: Record<string, unknown>;
	environmentValues: Record<string, string>;
	secretRefs: Record<string, string>;
	provenance: {
		selectedBy: NonNullable<ProjectLaunchHostBindingInput['selectedBy']>;
		selectedAt: string;
	};
	host: {
		id: string;
		name: string | null;
		ownership: string | null;
		status: string | null;
		accountLabel?: string | null;
		organizationOrOwner?: string | null;
		metadata?: Record<string, unknown>;
	} | null;
}

export interface ProjectLaunchConfigWritePlanItem extends TemplateConfigWrite {
	requirementKey: string;
	requirementKind: ProjectLaunchRequirementKind;
	requirementType: string;
	provider: string;
}

export interface ProjectLaunchSecretDeploymentPlanItem {
	requirementKey: string;
	requirementKind: ProjectLaunchRequirementKind;
	env: string;
	sensitivity: string;
	source: string;
	targets: string[];
	scopes: ProjectEnvironmentName[];
	sourceHostId?: string | null;
}

export interface ResolveProjectLaunchHostBindingsOptions {
	hostBindings?: Record<string, ProjectLaunchHostBindingInput>;
	launchRequirements?: TemplateLaunchRequirements | null;
	repositoryHosts?: ProjectLaunchHostInventoryRecord[];
	teamHosts?: ProjectLaunchHostInventoryRecord[];
	managedHosts?: ProjectLaunchHostInventoryRecord[];
	defaultHosts?: Record<string, unknown> | null;
	domains?: Record<string, unknown> | null;
	projectSlug?: string | null;
	projectName?: string | null;
	standardProjectLaunch?: boolean;
	selectedAt?: string;
}

export interface ResolveProjectLaunchHostBindingsResult {
	hostBindings: Record<string, ProjectLaunchResolvedHostBinding>;
	compatibility: {
		repositoryHostId?: string | null;
		cloudflareHostMode?: 'team_owned' | 'treeseed_managed' | null;
		cloudflareHostId?: string | null;
		emailHostMode?: 'team_owned' | 'treeseed_managed' | null;
		emailHostId?: string | null;
	};
	configWritePlan: ProjectLaunchConfigWritePlanItem[];
	secretDeploymentPlan: {
		items: ProjectLaunchSecretDeploymentPlanItem[];
	};
	diagnostics: Array<{ code: string; message: string; requirementKey?: string }>;
}

export interface ProjectLaunchLocalHostBindingSummary {
	requirementKey: string;
	requirementKind: ProjectLaunchRequirementKind;
	type: string;
	provider: string | null;
	alias: string | null;
	mode: 'team_owned' | 'treeseed_managed' | 'none';
	displayName: string;
}

export interface ParseProjectLaunchHostBindingSpecsOptions {
	specs?: string | string[] | null;
	launchRequirements?: TemplateLaunchRequirements | null;
	selectedAt?: string;
}

export interface ParseProjectLaunchHostBindingSpecsResult {
	hostBindings: Record<string, ProjectLaunchHostBindingInput>;
	repositoryHosts: ProjectLaunchHostInventoryRecord[];
	teamHosts: ProjectLaunchHostInventoryRecord[];
	managedHosts: ProjectLaunchHostInventoryRecord[];
	summaries: ProjectLaunchLocalHostBindingSummary[];
	omitted: ProjectLaunchLocalHostBindingSummary[];
}

function expectRecord(value: unknown, label: string) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`${label} must be an object.`);
	}
	return value as Record<string, unknown>;
}

function optionalRecord(value: unknown, label: string) {
	if (value === undefined || value === null) return undefined;
	return expectRecord(value, label);
}

function expectString(value: unknown, label: string) {
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new Error(`${label} must be a non-empty string.`);
	}
	return value.trim();
}

function optionalString(value: unknown) {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function expectBoolean(value: unknown, label: string) {
	if (typeof value !== 'boolean') {
		throw new Error(`${label} must be a boolean.`);
	}
	return value;
}

function optionalStringArray(value: unknown, label: string) {
	if (value === undefined || value === null) return undefined;
	if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
	return value.map((entry, index) => expectString(entry, `${label}[${index}]`));
}

function optionalRecordOfStrings(value: unknown, label: string) {
	if (value === undefined || value === null) return undefined;
	const record = expectRecord(value, label);
	const normalized: Record<string, string> = {};
	for (const [key, entry] of Object.entries(record)) {
		normalized[key] = expectString(entry, `${label}.${key}`);
	}
	return normalized;
}

function expectEnum<T extends readonly string[]>(value: unknown, allowed: T, label: string): T[number] {
	const text = expectString(value, label);
	if (!(allowed as readonly string[]).includes(text)) {
		throw new Error(`${label} uses unsupported value "${text}".`);
	}
	return text as T[number];
}

function optionalEnum<T extends readonly string[]>(value: unknown, allowed: T, label: string) {
	if (value === undefined || value === null || value === '') return undefined;
	return expectEnum(value, allowed, label);
}

function expectArray(value: unknown, label: string) {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
	return value;
}

function normalizeBoolean(value: unknown) {
	return value === undefined || value === null ? false : expectBoolean(value, 'required');
}

function validateRequirementKey(key: string, label: string) {
	if (!/^[A-Za-z][A-Za-z0-9_-]*$/u.test(key)) {
		throw new Error(`${label} must start with a letter and contain only letters, numbers, underscores, or hyphens.`);
	}
	return key;
}

function validateConfigWritePath(path: string, label: string) {
	const segments = path.split('.');
	if (segments.some((segment) => !segment || segment === '..')) {
		throw new Error(`${label} must be a safe dot path.`);
	}
	for (const segment of segments) {
		if (!/^[A-Za-z0-9_-]+$/u.test(segment)) {
			throw new Error(`${label} contains unsafe segment "${segment}".`);
		}
		if (segment === '__proto__' || segment === 'prototype' || segment === 'constructor') {
			throw new Error(`${label} contains forbidden segment "${segment}".`);
		}
	}
	return path;
}

function normalizeConfigWrite(value: unknown, label: string): TemplateConfigWrite {
	const record = expectRecord(value, label);
	return {
		target: expectEnum(record.target, TEMPLATE_CONFIG_WRITE_TARGETS, `${label}.target`) as TemplateConfigWriteTarget,
		path: validateConfigWritePath(expectString(record.path, `${label}.path`), `${label}.path`),
		valueFrom: expectString(record.valueFrom, `${label}.valueFrom`),
		writeWhen: optionalEnum(record.writeWhen, TEMPLATE_CONFIG_WRITE_WHEN, `${label}.writeWhen`) as TemplateConfigWriteWhen | undefined,
		mergeStrategy: optionalEnum(record.mergeStrategy, TEMPLATE_CONFIG_MERGE_STRATEGIES, `${label}.mergeStrategy`) as TemplateConfigMergeStrategy | undefined,
	};
}

function normalizeEnvironmentWrite(value: unknown, label: string): TemplateEnvironmentWrite {
	const record = expectRecord(value, label);
	return {
		env: expectString(record.env, `${label}.env`),
		valueFrom: expectString(record.valueFrom, `${label}.valueFrom`),
		targets: optionalStringArray(record.targets, `${label}.targets`)?.map((target, index) =>
			expectEnum(target, TEMPLATE_SECRET_TARGETS, `${label}.targets[${index}]`) as TemplateSecretTarget),
		scopes: optionalStringArray(record.scopes, `${label}.scopes`)?.map((scope, index) =>
			expectEnum(scope, PROJECT_ENVIRONMENT_NAMES, `${label}.scopes[${index}]`) as ProjectEnvironmentName),
		sensitivity: optionalEnum(record.sensitivity, TEMPLATE_SECRET_SENSITIVITIES, `${label}.sensitivity`) as TemplateSecretSensitivity | undefined,
	};
}

function normalizeHostRequirement(value: unknown, index: number): TemplateHostRequirement {
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

function normalizeResourceRequirement(value: unknown, index: number): TemplateResourceRequirement {
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

function normalizeSecretRequirement(value: unknown, index: number): TemplateSecretRequirement {
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

function normalizeEnvironmentScopes(value: unknown, label: string) {
	return optionalStringArray(value, label)?.map((scope, index) =>
		expectEnum(scope, PROJECT_ENVIRONMENT_NAMES, `${label}[${index}]`) as ProjectEnvironmentName);
}

function normalizeBinding(value: unknown, key: string): ProjectLaunchHostBindingInput {
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

function defaultScopes(input: Record<string, unknown>) {
	return normalizeEnvironmentScopes(input.targetEnvironments, 'targetEnvironments') ?? ['staging', 'prod'];
}

function deriveLegacyBindings(input: Record<string, unknown>) {
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

function hostMetadataType(host: ProjectLaunchHostInventoryRecord) {
	const metadataType = typeof host.metadata?.hostType === 'string' ? host.metadata.hostType : host.type;
	if (metadataType === 'repository_host' || metadataType === 'repository') return 'repository';
	if (metadataType === 'web_host' || metadataType === 'cloudflare' || metadataType === 'web') return 'web';
	if (metadataType === 'email_host' || metadataType === 'smtp' || metadataType === 'email') return 'email';
	if (metadataType === 'ai_host' || metadataType === 'ai') return 'ai';
	if (metadataType === 'knowledge_library' || metadataType === 'knowledge-library' || metadataType === 'treedb') return 'knowledge-library';
	if (host.provider === 'smtp') return 'email';
	if (host.provider === 'cloudflare') return 'web';
	if (host.provider === 'github') return 'repository';
	if (host.provider === 'treedb') return 'knowledge-library';
	return metadataType ?? '';
}

function allRequirements(launchRequirements?: TemplateLaunchRequirements | null) {
	return [
		...(launchRequirements?.hosts ?? []),
		...(launchRequirements?.resources ?? []),
		...(launchRequirements?.secrets ?? []),
	];
}

function normalizeSpecList(specs: ParseProjectLaunchHostBindingSpecsOptions['specs']) {
	if (!specs) return [];
	return (Array.isArray(specs) ? specs : [specs])
		.flatMap((entry) => String(entry).split(','))
		.map((entry) => entry.trim())
		.filter(Boolean);
}

function safeLocalIdSegment(value: string) {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		|| 'local';
}

function portableHostConfigValues(requirement: TemplateHostRequirement, provider: string, alias: string) {
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
	if (requirement.type === 'knowledge-library' && provider === 'treedb') {
		values.treeDb = {
			instance: alias,
			contentAccessMode: 'treedb',
		};
		return values;
	}
	return values;
}

function localHostMetadata(requirement: TemplateHostRequirement, managed: boolean) {
	return {
		hostType: requirement.type,
		managed,
		configured: true,
		local: true,
	};
}

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

function defaultHostIds(defaultHosts?: Record<string, unknown> | null, requirementKey?: string, type?: string) {
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

function hostMatchesRequirement(
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

function hostUsabilityError(
	host: ProjectLaunchHostInventoryRecord,
	requirement: TemplateHostRequirement,
	required: boolean,
) {
	if (!required) return null;
	const status = typeof host.status === 'string' ? host.status : 'active';
	if (status === 'active' || status === 'ready') return null;
	return `${requirement.key} selected host "${host.name ?? host.id}" is not active (${status}).`;
}

function resolveManagedHost(
	requirement: TemplateHostRequirement,
	managedHosts: ProjectLaunchHostInventoryRecord[],
	environmentScopes: ProjectEnvironmentName[],
) {
	return managedHosts.find((host) => hostMatchesRequirement(host, requirement, environmentScopes)) ?? null;
}

function resolveTeamHost(
	requirement: TemplateHostRequirement,
	hosts: ProjectLaunchHostInventoryRecord[],
	environmentScopes: ProjectEnvironmentName[],
	id?: string | null,
) {
	return hosts.find((host) => (!id || host.id === id) && hostMatchesRequirement(host, requirement, environmentScopes)) ?? null;
}

function normalizeHostSnapshot(host: ProjectLaunchHostInventoryRecord | null) {
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

function normalizeResourceSnapshot(binding: ProjectLaunchHostBindingInput) {
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

function bindingSelectedBy(binding: ProjectLaunchHostBindingInput | undefined, host: ProjectLaunchHostInventoryRecord | null, fallback: NonNullable<ProjectLaunchHostBindingInput['selectedBy']>) {
	if (binding?.selectedBy) return binding.selectedBy;
	if (host?.ownership === 'treeseed_managed') return 'managed-default';
	return fallback;
}

function resolveHostRequirementBinding(
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

function resolveResourceRequirementBinding(
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

function resolveAdHocBinding(
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

function compatibilityFromBindings(bindings: Record<string, ProjectLaunchResolvedHostBinding>) {
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
