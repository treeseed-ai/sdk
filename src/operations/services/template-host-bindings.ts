import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
} from '../../sdk-types.ts';
import type {
	ProjectLaunchConfigWritePlanItem,
	ProjectLaunchResolvedHostBinding,
	ProjectLaunchSecretDeploymentPlanItem,
} from '../../template-launch-requirements.ts';

type MutableRecord = Record<string, any>;

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

function ensureDir(path: string) {
	mkdirSync(path, { recursive: true });
}

function readStructuredFile(filePath: string, target: TemplateConfigWriteTarget): MutableRecord {
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

function writeStructuredFile(filePath: string, target: TemplateConfigWriteTarget, value: MutableRecord) {
	ensureDir(dirname(filePath));
	const body = target === 'package.json'
		? `${JSON.stringify(value, null, 2)}\n`
		: stringifyYaml(value);
	writeFileSync(filePath, body, 'utf8');
}

function parseStructuredContent(content: string, target: TemplateConfigWriteTarget): MutableRecord {
	if (!content.trim()) {
		return target === 'src/env.yaml' ? { entries: {} } : {};
	}
	const parsed = target === 'package.json' ? JSON.parse(content) : parseYaml(content);
	return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as MutableRecord : {};
}

function stringifyStructuredContent(value: MutableRecord, target: TemplateConfigWriteTarget) {
	return target === 'package.json'
		? `${JSON.stringify(value, null, 2)}\n`
		: stringifyYaml(value);
}

function assertTarget(target: TemplateConfigWriteTarget) {
	if (!(TEMPLATE_CONFIG_WRITE_TARGETS as readonly string[]).includes(target)) {
		throw new Error(`Unsupported host binding config write target "${target}".`);
	}
}

function safePathSegments(path: string) {
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

function getPath(value: unknown, path: string) {
	let current = value;
	for (const segment of path.split('.')) {
		if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
		current = (current as Record<string, unknown>)[segment];
	}
	return current;
}

function hasPath(value: unknown, path: string) {
	let current = value;
	for (const segment of path.split('.')) {
		if (!current || typeof current !== 'object' || Array.isArray(current) || !(segment in current)) return false;
		current = (current as Record<string, unknown>)[segment];
	}
	return true;
}

function deepMerge(left: unknown, right: unknown): unknown {
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

function uniqueArray(left: unknown, right: unknown) {
	const current = Array.isArray(left) ? left : [];
	const incoming = Array.isArray(right) ? right : [right];
	return [...new Set([...current, ...incoming])];
}

function setDotPath(target: MutableRecord, path: string, value: unknown, strategy: TemplateConfigMergeStrategy) {
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

function selectedHostValue(binding: ProjectLaunchResolvedHostBinding, selector: string) {
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

function selectedResourceValue(binding: ProjectLaunchResolvedHostBinding, selector: string) {
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

function resolveWriteValue(
	write: ProjectLaunchConfigWritePlanItem,
	binding: ProjectLaunchResolvedHostBinding | undefined,
	options: ApplyProjectLaunchHostBindingConfigOptions,
) {
	const valueFrom = write.valueFrom;
	if (valueFrom.startsWith('selectedHost.')) {
		if (!binding) return undefined;
		return selectedHostValue(binding, valueFrom.slice('selectedHost.'.length));
	}
	if (valueFrom.startsWith('selectedResource.')) {
		if (!binding) return undefined;
		return selectedResourceValue(binding, valueFrom.slice('selectedResource.'.length));
	}
	if (valueFrom.startsWith('launchInput.domains.')) {
		return getPath(options.launchInput?.domains, valueFrom.slice('launchInput.domains.'.length));
	}
	if (valueFrom === 'derived.projectSlug') {
		return options.derived?.projectSlug ?? options.launchInput?.projectSlug ?? null;
	}
	if (valueFrom === 'derived.projectName') {
		return options.derived?.projectName ?? options.launchInput?.projectName ?? null;
	}
	if (valueFrom === 'derived.repositoryName') {
		return options.derived?.repositoryName
			?? options.launchInput?.repoName
			?? options.launchInput?.projectSlug
			?? null;
	}
	if (valueFrom.startsWith('literal.')) {
		const literal = valueFrom.slice('literal.'.length);
		if (literal === 'true') return true;
		if (literal === 'false') return false;
		if (literal === 'null') return null;
		return literal;
	}
	throw new Error(`Unsupported host binding config value source "${valueFrom}".`);
}

function shouldWrite(write: ProjectLaunchConfigWritePlanItem, binding: ProjectLaunchResolvedHostBinding | undefined, value: unknown) {
	if (write.writeWhen === 'host-selected') {
		return Boolean(binding?.host || binding?.hostId || binding?.managedHostKey) && value !== undefined && value !== null && value !== '';
	}
	if (write.writeWhen === 'feature-enabled') {
		return value !== undefined && value !== null && value !== false && value !== '';
	}
	return value !== undefined && value !== null;
}

function summarizeValue(value: unknown): string | number | boolean | null {
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
	if (value === null || value === undefined) return null;
	if (Array.isArray(value)) return `[${value.length} items]`;
	return '{...}';
}

function normalizeTargets(targets: string[]): TemplateSecretTarget[] {
	return targets.filter((target): target is TemplateSecretTarget => typeof target === 'string' && target.length > 0) as TemplateSecretTarget[];
}

function buildEnvironmentEntry(
	item: ProjectLaunchSecretDeploymentPlanItem,
	binding: ProjectLaunchResolvedHostBinding | undefined,
) {
	const sourceHostType = binding?.type ?? (item.requirementKind === 'host' ? item.requirementKey : null);
	const sourceProvider = binding?.provider ?? null;
	return {
		label: item.env.replace(/^TREESEED_/u, '').replace(/_/gu, ' ').toLowerCase().replace(/\b\w/gu, (letter) => letter.toUpperCase()),
		group: 'launch-hosts',
		description: `Configuration declared by the ${item.requirementKey} launch requirement.`,
		howToGet: 'Resolve this value from the selected launch host or configured deployment secret manager.',
		sensitivity: item.sensitivity,
		targets: normalizeTargets(item.targets),
		scopes: item.scopes,
		requirement: item.requirementKind === 'secret' ? 'required' : 'conditional',
		purposes: ['deploy', 'config'],
		storage: item.sensitivity === 'secret' ? 'scoped' : 'shared',
		validation: { kind: 'nonempty' },
		sourcePriority: ['machine-config', 'process-env'],
		sourceRequirement: item.requirementKey,
		sourceHostType,
		sourceProvider,
	};
}

export function applyProjectLaunchHostBindingConfig(options: ApplyProjectLaunchHostBindingConfigOptions): ProjectLaunchHostBindingConfigApplyResult {
	const configWrites = options.hostBindingPlans?.configWrites ?? [];
	const secretItems = options.hostBindingPlans?.secretDeployment?.items ?? [];
	const hostBindings = options.hostBindings ?? {};
	const documents = new Map<TemplateConfigWriteTarget, MutableRecord>();
	const summaries: ProjectLaunchHostBindingConfigWriteSummary[] = [];
	const environmentSummaries: ProjectLaunchHostBindingEnvironmentWriteSummary[] = [];

	for (const write of configWrites) {
		assertTarget(write.target);
		const operation = write.mergeStrategy ?? 'replace';
		if (!(TEMPLATE_CONFIG_MERGE_STRATEGIES as readonly string[]).includes(operation)) {
			throw new Error(`Unsupported host binding config merge strategy "${operation}".`);
		}
		const binding = hostBindings[write.requirementKey];
		const value = resolveWriteValue(write, binding, options);
		if (!shouldWrite(write, binding, value)) continue;
		const document = documents.get(write.target) ?? readStructuredFile(resolve(options.projectRoot, write.target), write.target);
		documents.set(write.target, document);
		setDotPath(document, write.path, value, operation);
		summaries.push({
			target: write.target,
			path: write.path,
			requirementKey: write.requirementKey,
			requirementKind: write.requirementKind,
			provider: write.provider,
			operation,
			valuePreview: summarizeValue(value),
		});
	}

	if (secretItems.length > 0) {
		const target = 'src/env.yaml' as const;
		const document = documents.get(target) ?? readStructuredFile(resolve(options.projectRoot, target), target);
		documents.set(target, document);
		document.entries = document.entries && typeof document.entries === 'object' && !Array.isArray(document.entries)
			? document.entries
			: {};
		for (const item of secretItems) {
			const binding = hostBindings[item.requirementKey];
			document.entries[item.env] = {
				...(document.entries[item.env] ?? {}),
				...buildEnvironmentEntry(item, binding),
			};
			environmentSummaries.push({
				env: item.env,
				requirementKey: item.requirementKey,
				requirementKind: item.requirementKind,
				sourceHostType: binding?.type ?? null,
				sourceProvider: binding?.provider ?? null,
				sensitivity: item.sensitivity,
				targets: item.targets,
				scopes: item.scopes,
			});
		}
	}

	for (const [target, document] of documents) {
		writeStructuredFile(resolve(options.projectRoot, target), target, document);
	}

	return {
		configWrites: summaries,
		environmentWrites: environmentSummaries,
		targets: [...documents.keys()],
	};
}

function compareStatus(diagnostics: ProjectLaunchHostBindingConfigAuditDiagnostic[]) {
	if (diagnostics.some((diagnostic) => diagnostic.status === 'blocked')) return 'blocked';
	if (diagnostics.some((diagnostic) => diagnostic.status === 'warning')) return 'warning';
	return 'ok';
}

export function auditProjectLaunchHostBindingConfig(options: ApplyProjectLaunchHostBindingConfigOptions): ProjectLaunchHostBindingConfigAuditResult {
	const plannedTargets = new Set<TemplateConfigWriteTarget>();
	for (const write of options.hostBindingPlans?.configWrites ?? []) {
		assertTarget(write.target);
		plannedTargets.add(write.target);
	}
	if ((options.hostBindingPlans?.secretDeployment?.items ?? []).length > 0) {
		plannedTargets.add('src/env.yaml');
	}
	const checkedTargets = [...plannedTargets];
	const tempRoot = mkdtempSync(join(tmpdir(), 'treeseed-host-binding-audit-'));
	const before = new Map<TemplateConfigWriteTarget, string | null>();
	try {
		for (const target of checkedTargets) {
			const sourcePath = resolve(options.projectRoot, target);
			const targetPath = resolve(tempRoot, target);
			if (existsSync(sourcePath)) {
				ensureDir(dirname(targetPath));
				cpSync(sourcePath, targetPath);
				before.set(target, readFileSync(sourcePath, 'utf8'));
			} else {
				before.set(target, null);
			}
		}
		const expected = applyProjectLaunchHostBindingConfig({
			...options,
			projectRoot: tempRoot,
		});
		const diagnostics: ProjectLaunchHostBindingConfigAuditDiagnostic[] = [];
		const changedTargets: TemplateConfigWriteTarget[] = [];
		for (const target of checkedTargets) {
			const sourcePath = resolve(options.projectRoot, target);
			const expectedPath = resolve(tempRoot, target);
			const expectedContent = existsSync(expectedPath) ? readFileSync(expectedPath, 'utf8') : null;
			const actualContent = existsSync(sourcePath) ? readFileSync(sourcePath, 'utf8') : null;
			if (before.get(target) === null && expectedContent !== null) {
				changedTargets.push(target);
				diagnostics.push({
					code: 'missing_config_target',
					status: 'warning',
					target,
					message: `${target} is missing host-bound configuration.`,
				});
			} else if (actualContent !== expectedContent) {
				changedTargets.push(target);
				diagnostics.push({
					code: 'stale_config_target',
					status: 'warning',
					target,
					message: `${target} does not match the current host binding plan.`,
				});
			}
		}
		return {
			status: compareStatus(diagnostics),
			checkedTargets,
			changedTargets,
			diagnostics,
			expected,
		};
	} catch (error) {
		const target = checkedTargets[0] ?? 'treeseed.site.yaml';
		const diagnostics: ProjectLaunchHostBindingConfigAuditDiagnostic[] = [{
			code: 'invalid_config_target',
			status: 'blocked',
			target,
			message: error instanceof Error ? error.message : String(error),
		}];
		return {
			status: 'blocked',
			checkedTargets,
			changedTargets: [],
			diagnostics,
			expected: { configWrites: [], environmentWrites: [], targets: [] },
		};
	} finally {
		rmSync(tempRoot, { recursive: true, force: true });
	}
}

export function preserveProjectLaunchHostBindingConfigOverlay(options: {
	target: TemplateConfigWriteTarget;
	currentContent: string;
	nextContent: string;
	hostBindingPlans?: ApplyProjectLaunchHostBindingConfigOptions['hostBindingPlans'];
}) {
	assertTarget(options.target);
	const configWrites = options.hostBindingPlans?.configWrites ?? [];
	const shouldPreserveConfigWrites = configWrites.some((write) => write.target === options.target);
	const shouldPreserveEnvironmentEntries = options.target === 'src/env.yaml';
	if (!shouldPreserveConfigWrites && !shouldPreserveEnvironmentEntries) {
		return options.nextContent;
	}

	const currentDocument = parseStructuredContent(options.currentContent, options.target);
	const nextDocument = parseStructuredContent(options.nextContent, options.target);

	for (const write of configWrites) {
		if (write.target !== options.target) continue;
		safePathSegments(write.path);
		if (!hasPath(currentDocument, write.path)) continue;
		setDotPath(nextDocument, write.path, getPath(currentDocument, write.path), 'replace');
	}

	if (options.target === 'src/env.yaml') {
		const currentEntries = currentDocument.entries && typeof currentDocument.entries === 'object' && !Array.isArray(currentDocument.entries)
			? currentDocument.entries as Record<string, unknown>
			: {};
		nextDocument.entries = nextDocument.entries && typeof nextDocument.entries === 'object' && !Array.isArray(nextDocument.entries)
			? nextDocument.entries
			: {};
		for (const [entryId, entry] of Object.entries(currentEntries)) {
			if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
			if (typeof (entry as Record<string, unknown>).sourceRequirement !== 'string') continue;
			nextDocument.entries[entryId] = entry;
		}
	}

	return stringifyStructuredContent(nextDocument, options.target);
}
