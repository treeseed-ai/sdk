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
} from '../../../entrypoints/models/sdk-types.ts';
import type {
	ProjectLaunchConfigWritePlanItem,
	ProjectLaunchResolvedHostBinding,
	ProjectLaunchSecretDeploymentPlanItem,
} from '../../../entrypoints/templates/template-launch-requirements.ts';
import { ApplyProjectLaunchHostBindingConfigOptions, MutableRecord, ProjectLaunchHostBindingConfigApplyResult, ProjectLaunchHostBindingConfigAuditDiagnostic, ProjectLaunchHostBindingConfigAuditResult, ProjectLaunchHostBindingConfigWriteSummary, ProjectLaunchHostBindingEnvironmentWriteSummary, assertTarget, ensureDir, getPath, readStructuredFile, selectedHostValue, selectedResourceValue, setDotPath, writeStructuredFile } from './mutable-record.ts';

export function resolveWriteValue(
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

export function shouldWrite(write: ProjectLaunchConfigWritePlanItem, binding: ProjectLaunchResolvedHostBinding | undefined, value: unknown) {
	if (write.writeWhen === 'host-selected') {
		return Boolean(binding?.host || binding?.hostId || binding?.managedHostKey) && value !== undefined && value !== null && value !== '';
	}
	if (write.writeWhen === 'feature-enabled') {
		return value !== undefined && value !== null && value !== false && value !== '';
	}
	return value !== undefined && value !== null;
}

export function summarizeValue(value: unknown): string | number | boolean | null {
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
	if (value === null || value === undefined) return null;
	if (Array.isArray(value)) return `[${value.length} items]`;
	return '{...}';
}

export function normalizeTargets(targets: string[]): TemplateSecretTarget[] {
	return targets.filter((target): target is TemplateSecretTarget => typeof target === 'string' && target.length > 0) as TemplateSecretTarget[];
}

export function buildEnvironmentEntry(
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

export function compareStatus(diagnostics: ProjectLaunchHostBindingConfigAuditDiagnostic[]) {
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
	const tempBase = resolve(options.projectRoot, '.treeseed', 'tmp', 'host-binding-audit');
	mkdirSync(tempBase, { recursive: true });
	const tempRoot = mkdtempSync(join(tempBase, 'treeseed-host-binding-audit-'));
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
