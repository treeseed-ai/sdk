import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { runTreeseedGit } from '../../operations/services/git-runner.ts';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { discoverTreeseedApplications } from '../../hosting/apps.ts';
import { githubRepositoryCredentialEnvName } from '../../operations/services/github-credentials.ts';
import { discoverTreeseedPackageAdapters } from '../../operations/services/package-adapters.ts';
import type { TreeseedDeployConfig, TreeseedTenantConfig } from '../contracts.ts';
import { loadTreeseedDeployConfig } from '../deploy-config.ts';
import { loadTreeseedPlugins, type LoadedTreeseedPluginEntry } from '../plugins.ts';
import { loadTreeseedManifest } from '../tenant-config.ts';
import { TreeseedEnvironmentContext, TreeseedEnvironmentEntry, TreeseedEnvironmentPurpose, TreeseedEnvironmentScope, TreeseedEnvironmentValidationProblem, TreeseedEnvironmentValidationResult } from './treeseed-environment-scopes.ts';
import { isTreeseedEnvironmentEntryRelevant, resolveTreeseedEnvironmentRegistry } from './package-repository-credential-overlay.ts';

export function isEntryRequired(
	entry: TreeseedEnvironmentEntry,
	context: TreeseedEnvironmentContext,
	scope: TreeseedEnvironmentScope,
	purpose?: TreeseedEnvironmentPurpose,
) {
	if (entry.requirement === 'required') {
		return true;
	}
	if (entry.requirement === 'conditional') {
		return entry.requiredWhen ? entry.requiredWhen(context, scope, purpose) : true;
	}
	return false;
}

export function materializeDefaultValue(
	entry: TreeseedEnvironmentEntry,
	context: TreeseedEnvironmentContext,
	scope: TreeseedEnvironmentScope,
	values: Record<string, string | undefined> = {},
) {
	const source = scope === 'local' && entry.localDefaultValue !== undefined ? entry.localDefaultValue : entry.defaultValue;
	if (source === undefined) {
		return undefined;
	}
	return typeof source === 'function' ? source(context, scope, values) : source;
}

export function getTreeseedEnvironmentSuggestedValues(options: {
	scope: TreeseedEnvironmentScope;
	purpose?: TreeseedEnvironmentPurpose;
	deployConfig?: TreeseedDeployConfig;
	tenantConfig?: TreeseedTenantConfig;
	plugins?: LoadedTreeseedPluginEntry[];
	values?: Record<string, string | undefined>;
}) {
	const registry = resolveTreeseedEnvironmentRegistry(options);
	const suggestedValues: Record<string, string> = {};
	const seedValues = { ...(options.values ?? {}) };

	for (const entry of registry.entries.filter((candidate) =>
		isTreeseedEnvironmentEntryRelevant(candidate, registry.context, options.scope, options.purpose),
	)) {
		const value = materializeDefaultValue(entry, registry.context, options.scope, { ...suggestedValues, ...seedValues });
		if (value === undefined) {
			continue;
		}
		suggestedValues[entry.id] = value;
	}

	return suggestedValues;
}

export function isTreeseedEnvironmentEntryRequired(
	entry: TreeseedEnvironmentEntry,
	context: TreeseedEnvironmentContext,
	scope: TreeseedEnvironmentScope,
	purpose?: TreeseedEnvironmentPurpose,
) {
	return isEntryRequired(entry, context, scope, purpose);
}

export function valuePresent(value: unknown) {
	return typeof value === 'string' && value.trim().length > 0;
}

export function validateValue(entry: TreeseedEnvironmentEntry, value: string) {
	if (!entry.validation) {
		return null;
	}

	switch (entry.validation.kind) {
		case 'string':
		case 'nonempty': {
			if (!valuePresent(value)) {
				return `${entry.id} must be a non-empty string.`;
			}
			if (
				typeof entry.validation.minLength === 'number'
				&& value.trim().length < entry.validation.minLength
			) {
				return `${entry.id} must be at least ${entry.validation.minLength} characters.`;
			}
			return null;
		}
		case 'boolean':
			return /^(true|false|1|0)$/i.test(value) ? null : `${entry.id} must be true or false.`;
		case 'number':
			return Number.isFinite(Number(value)) ? null : `${entry.id} must be a number.`;
		case 'url':
			try {
				new URL(value);
				return null;
			} catch {
				return `${entry.id} must be a valid URL.`;
			}
		case 'email':
			return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? null : `${entry.id} must be a valid email address.`;
		case 'enum':
			return entry.validation.values.includes(value)
				? null
				: `${entry.id} must be one of: ${entry.validation.values.join(', ')}.`;
		default:
			return null;
	}
}

export function validateTreeseedEnvironmentValues(options: {
	values: Record<string, string | undefined>;
	scope: TreeseedEnvironmentScope;
	purpose: TreeseedEnvironmentPurpose;
	deployConfig?: TreeseedDeployConfig;
	tenantConfig?: TreeseedTenantConfig;
	plugins?: LoadedTreeseedPluginEntry[];
}): TreeseedEnvironmentValidationResult {
	const registry = resolveTreeseedEnvironmentRegistry(options);
	const relevantEntries = registry.entries.filter((entry) =>
		isTreeseedEnvironmentEntryRelevant(entry, registry.context, options.scope, options.purpose),
	);
	const requiredEntries = relevantEntries.filter((entry) =>
		isEntryRequired(entry, registry.context, options.scope, options.purpose),
	);
	const missing: TreeseedEnvironmentValidationProblem[] = [];
	const invalid: TreeseedEnvironmentValidationProblem[] = [];

	for (const entry of requiredEntries) {
		const value = options.values[entry.id];
		if (!valuePresent(value)) {
			missing.push({
				id: entry.id,
				label: entry.label,
				reason: 'missing',
				message: `${entry.id} is required for ${options.purpose} (${options.scope}). ${entry.howToGet}`,
				entry,
			});
			continue;
		}

		const validationMessage = validateValue(entry, value);
		if (validationMessage) {
			invalid.push({
				id: entry.id,
				label: entry.label,
				reason: 'invalid',
				message: validationMessage,
				entry,
			});
		}
	}

	return {
		ok: missing.length === 0 && invalid.length === 0,
		entries: relevantEntries,
		required: requiredEntries,
		missing,
		invalid,
	};
}
