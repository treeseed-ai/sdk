import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
	TEMPLATE_CONFIG_MERGE_STRATEGIES,
	TEMPLATE_CONFIG_WRITE_TARGETS,
	type ProjectEnvironmentName,
	type TemplateConfigMergeStrategy,
	type TemplateConfigWriteTarget,
	type TemplateSecretTarget,
	type TemplateSecretSensitivity,
} from '../../../sdk-types.ts';
import type {
	ProjectLaunchConfigWritePlanItem,
	ProjectLaunchResolvedHostBinding,
	ProjectLaunchSecretDeploymentPlanItem,
} from '../../../template-launch-requirements.ts';


export type MutableRecord = Record<string, any>;

export interface ApplyProjectLaunchHostBindingConfigOptions {
	projectRoot: string;
	hostBindings?: Record<string, ProjectLaunchResolvedHostBinding> | null;
	hostBindingPlans?: {
		configWrites?: ProjectLaunchConfigWritePlanItem[];
		secretDeployment?: {
			items?: ProjectLaunchSecretDeploymentPlanItem[];
		};
	} | null;
	launchInput?: {
		projectSlug?: string | null;
		projectName?: string | null;
		repoName?: string | null;
		domains?: Record<string, unknown> | null;
	} | null;
	derived?: {
		projectSlug?: string | null;
		projectName?: string | null;
		repositoryName?: string | null;
	} | null;
}

export interface ProjectLaunchHostBindingConfigWriteSummary {
	target: TemplateConfigWriteTarget;
	path: string;
	requirementKey: string;
	requirementKind: string;
	provider: string;
	operation: TemplateConfigMergeStrategy;
	valuePreview: string | number | boolean | null;
}

export interface ProjectLaunchHostBindingEnvironmentWriteSummary {
	env: string;
	requirementKey: string;
	requirementKind: string;
	sourceHostType?: string | null;
	sourceProvider?: string | null;
	sensitivity: TemplateSecretSensitivity | string;
	targets: string[];
	scopes: ProjectEnvironmentName[];
}

export interface ProjectLaunchHostBindingConfigApplyResult {
	configWrites: ProjectLaunchHostBindingConfigWriteSummary[];
	environmentWrites: ProjectLaunchHostBindingEnvironmentWriteSummary[];
	targets: string[];
}

export interface ProjectLaunchHostBindingConfigAuditDiagnostic {
	code: 'missing_config_target' | 'stale_config_target' | 'invalid_config_target';
	status: 'ok' | 'warning' | 'blocked';
	target: TemplateConfigWriteTarget;
	message: string;
}

export interface ProjectLaunchHostBindingConfigAuditResult {
	status: 'ok' | 'warning' | 'blocked';
	checkedTargets: TemplateConfigWriteTarget[];
	changedTargets: TemplateConfigWriteTarget[];
	diagnostics: ProjectLaunchHostBindingConfigAuditDiagnostic[];
	expected: ProjectLaunchHostBindingConfigApplyResult;
}

export function ensureDir(path: string) {
	mkdirSync(path, { recursive: true });
}

export function readStructuredFile(filePath: string, target: TemplateConfigWriteTarget): MutableRecord {
	if (!existsSync(filePath)) {
		return target === 'src/env.yaml' ? { entries: {} } : {};
	}
	const raw = readFileSync(filePath, 'utf8');
	if (!raw.trim()) {
		return target === 'src/env.yaml' ? { entries: {} } : {};
	}
	const parsed = target === 'package.json' ? JSON.parse(raw) : parseYaml(raw);
	return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as MutableRecord : {};
}

export function writeStructuredFile(filePath: string, target: TemplateConfigWriteTarget, value: MutableRecord) {
	ensureDir(dirname(filePath));
	const body = target === 'package.json'
		? `${JSON.stringify(value, null, 2)}\n`
		: stringifyYaml(value);
	writeFileSync(filePath, body, 'utf8');
}

export function parseStructuredContent(content: string, target: TemplateConfigWriteTarget): MutableRecord {
	if (!content.trim()) {
		return target === 'src/env.yaml' ? { entries: {} } : {};
	}
	const parsed = target === 'package.json' ? JSON.parse(content) : parseYaml(content);
	return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as MutableRecord : {};
}

export function stringifyStructuredContent(value: MutableRecord, target: TemplateConfigWriteTarget) {
	return target === 'package.json'
		? `${JSON.stringify(value, null, 2)}\n`
		: stringifyYaml(value);
}

export function assertTarget(target: TemplateConfigWriteTarget) {
	if (!(TEMPLATE_CONFIG_WRITE_TARGETS as readonly string[]).includes(target)) {
		throw new Error(`Unsupported host binding config write target "${target}".`);
	}
}

export function safePathSegments(path: string) {
	const segments = path.split('.');
	if (segments.some((segment) => !segment || segment === '..')) {
		throw new Error(`Host binding config write path "${path}" must be a safe dot path.`);
	}
	for (const segment of segments) {
		if (!/^[A-Za-z0-9_-]+$/u.test(segment)) {
			throw new Error(`Host binding config write path "${path}" contains unsafe segment "${segment}".`);
		}
		if (segment === '__proto__' || segment === 'prototype' || segment === 'constructor') {
			throw new Error(`Host binding config write path "${path}" contains forbidden segment "${segment}".`);
		}
	}
	return segments;
}

export function getPath(value: unknown, path: string) {
	let current = value;
	for (const segment of path.split('.')) {
		if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
		current = (current as Record<string, unknown>)[segment];
	}
	return current;
}

export function hasPath(value: unknown, path: string) {
	let current = value;
	for (const segment of path.split('.')) {
		if (!current || typeof current !== 'object' || Array.isArray(current) || !(segment in current)) return false;
		current = (current as Record<string, unknown>)[segment];
	}
	return true;
}

export function deepMerge(left: unknown, right: unknown): unknown {
	if (
		left
		&& typeof left === 'object'
		&& !Array.isArray(left)
		&& right
		&& typeof right === 'object'
		&& !Array.isArray(right)
	) {
		const result: MutableRecord = { ...(left as MutableRecord) };
		for (const [key, value] of Object.entries(right as MutableRecord)) {
			result[key] = key in result ? deepMerge(result[key], value) : value;
		}
		return result;
	}
	return right;
}

export function uniqueArray(left: unknown, right: unknown) {
	const current = Array.isArray(left) ? left : [];
	const incoming = Array.isArray(right) ? right : [right];
	return [...new Set([...current, ...incoming])];
}

export function setDotPath(target: MutableRecord, path: string, value: unknown, strategy: TemplateConfigMergeStrategy) {
	const segments = safePathSegments(path);
	let current = target;
	for (const segment of segments.slice(0, -1)) {
		if (!current[segment] || typeof current[segment] !== 'object' || Array.isArray(current[segment])) {
			current[segment] = {};
		}
		current = current[segment];
	}
	const leaf = segments[segments.length - 1]!;
	if (strategy === 'replace') {
		current[leaf] = value;
		return;
	}
	if (strategy === 'deep-merge') {
		current[leaf] = deepMerge(current[leaf], value);
		return;
	}
	if (strategy === 'append-unique') {
		current[leaf] = uniqueArray(current[leaf], value);
		return;
	}
	throw new Error(`Unsupported host binding config merge strategy "${strategy}".`);
}

export function selectedHostValue(binding: ProjectLaunchResolvedHostBinding, selector: string) {
	if (selector === 'provider') return binding.provider;
	if (selector === 'type') return binding.type;
	if (selector === 'id') return binding.host?.id ?? binding.hostId ?? binding.managedHostKey ?? null;
	if (selector === 'hostId') return binding.hostId ?? binding.host?.id ?? null;
	if (selector === 'managedHostKey') return binding.managedHostKey ?? null;
	if (selector === 'name') return binding.host?.name ?? binding.displayName ?? null;
	if (selector === 'displayName') return binding.displayName;
	if (selector === 'ownership') return binding.host?.ownership ?? null;
	if (selector === 'status') return binding.host?.status ?? null;
	if (selector === 'accountLabel') return binding.host?.accountLabel ?? null;
	if (selector === 'organizationOrOwner') return binding.host?.organizationOrOwner ?? null;
	if (selector.startsWith('github.')) {
		const field = selector.slice('github.'.length);
		if (field === 'owner') {
			return binding.host?.organizationOrOwner
				?? getPath(binding.configValues, 'github.owner')
				?? getPath(binding.configValues, 'owner')
				?? null;
		}
		return getPath(binding.configValues, `github.${field}`) ?? null;
	}
	if (selector.startsWith('metadata.')) return getPath(binding.host?.metadata, selector.slice('metadata.'.length)) ?? null;
	if (selector.startsWith('configValues.')) return getPath(binding.configValues, selector.slice('configValues.'.length)) ?? null;
	if (selector.startsWith('environmentValues.')) return getPath(binding.environmentValues, selector.slice('environmentValues.'.length)) ?? null;
	if (selector.startsWith('secretRefs.')) return getPath(binding.secretRefs, selector.slice('secretRefs.'.length)) ?? null;
	throw new Error(`Unsupported selectedHost value source "${selector}".`);
}

export function selectedResourceValue(binding: ProjectLaunchResolvedHostBinding, selector: string) {
	if (selector === 'provider') return binding.provider;
	if (selector === 'type') return binding.type;
	if (selector === 'id') return binding.host?.id ?? binding.hostId ?? binding.managedHostKey ?? null;
	if (selector === 'resourceId') return binding.hostId ?? binding.host?.id ?? null;
	if (selector === 'managedResourceKey') return binding.managedHostKey ?? null;
	if (selector === 'name') return binding.displayName ?? binding.host?.name ?? null;
	if (selector === 'displayName') return binding.displayName;
	if (selector.startsWith('metadata.')) return getPath(binding.host?.metadata, selector.slice('metadata.'.length)) ?? null;
	if (selector.startsWith('configValues.')) return getPath(binding.configValues, selector.slice('configValues.'.length)) ?? null;
	if (selector.startsWith('environmentValues.')) return getPath(binding.environmentValues, selector.slice('environmentValues.'.length)) ?? null;
	if (selector.startsWith('secretRefs.')) return getPath(binding.secretRefs, selector.slice('secretRefs.'.length)) ?? null;
	throw new Error(`Unsupported selectedResource value source "${selector}".`);
}
