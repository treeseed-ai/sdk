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


export type Mutable<T> = { -readonly [P in keyof T]: T[P] };

export type { TemplateLaunchRequirements } from '../entrypoints/models/sdk-types.ts';

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

export function expectRecord(value: unknown, label: string) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`${label} must be an object.`);
	}
	return value as Record<string, unknown>;
}

export function optionalRecord(value: unknown, label: string) {
	if (value === undefined || value === null) return undefined;
	return expectRecord(value, label);
}

export function expectString(value: unknown, label: string) {
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new Error(`${label} must be a non-empty string.`);
	}
	return value.trim();
}

export function optionalString(value: unknown) {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export function expectBoolean(value: unknown, label: string) {
	if (typeof value !== 'boolean') {
		throw new Error(`${label} must be a boolean.`);
	}
	return value;
}

export function optionalStringArray(value: unknown, label: string) {
	if (value === undefined || value === null) return undefined;
	if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
	return value.map((entry, index) => expectString(entry, `${label}[${index}]`));
}

export function optionalRecordOfStrings(value: unknown, label: string) {
	if (value === undefined || value === null) return undefined;
	const record = expectRecord(value, label);
	const normalized: Record<string, string> = {};
	for (const [key, entry] of Object.entries(record)) {
		normalized[key] = expectString(entry, `${label}.${key}`);
	}
	return normalized;
}

export function expectEnum<T extends readonly string[]>(value: unknown, allowed: T, label: string): T[number] {
	const text = expectString(value, label);
	if (!(allowed as readonly string[]).includes(text)) {
		throw new Error(`${label} uses unsupported value "${text}".`);
	}
	return text as T[number];
}

export function optionalEnum<T extends readonly string[]>(value: unknown, allowed: T, label: string) {
	if (value === undefined || value === null || value === '') return undefined;
	return expectEnum(value, allowed, label);
}

export function expectArray(value: unknown, label: string) {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
	return value;
}

export function normalizeBoolean(value: unknown) {
	return value === undefined || value === null ? false : expectBoolean(value, 'required');
}

export function validateRequirementKey(key: string, label: string) {
	if (!/^[A-Za-z][A-Za-z0-9_-]*$/u.test(key)) {
		throw new Error(`${label} must start with a letter and contain only letters, numbers, underscores, or hyphens.`);
	}
	return key;
}

export function validateConfigWritePath(path: string, label: string) {
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

export function normalizeConfigWrite(value: unknown, label: string): TemplateConfigWrite {
	const record = expectRecord(value, label);
	return {
		target: expectEnum(record.target, TEMPLATE_CONFIG_WRITE_TARGETS, `${label}.target`) as TemplateConfigWriteTarget,
		path: validateConfigWritePath(expectString(record.path, `${label}.path`), `${label}.path`),
		valueFrom: expectString(record.valueFrom, `${label}.valueFrom`),
		writeWhen: optionalEnum(record.writeWhen, TEMPLATE_CONFIG_WRITE_WHEN, `${label}.writeWhen`) as TemplateConfigWriteWhen | undefined,
		mergeStrategy: optionalEnum(record.mergeStrategy, TEMPLATE_CONFIG_MERGE_STRATEGIES, `${label}.mergeStrategy`) as TemplateConfigMergeStrategy | undefined,
	};
}

export function normalizeEnvironmentWrite(value: unknown, label: string): TemplateEnvironmentWrite {
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
