import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { runRepositoryGit } from '../../operations/services/operations/git-runner.ts';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { discoverApplications } from '../../hosting/apps.ts';
import { githubRepositoryCredentialEnvName } from '../../operations/services/configuration/github-credentials.ts';
import { discoverPackageAdapters } from '../../operations/services/reconciliation/package-adapters.ts';
import type { DeployConfig, TenantConfig } from '../support/contracts.ts';
import { loadDeployConfig } from '../hosting/deploy-config.ts';
import { loadPlugins, type LoadedPluginRegistration } from '../support/plugins.ts';
import { loadManifest } from '../configuration/tenant-config.ts';
import { EnvironmentContext, EnvironmentEntry, EnvironmentPurpose, EnvironmentScope, EnvironmentValidationProblem, EnvironmentValidationResult } from './environment-scopes.ts';
import { isEnvironmentEntryRelevant, resolveEnvironmentRegistry } from './package-repository-credential-overlay.ts';

export function isEntryRequired(
	entry: EnvironmentEntry,
	context: EnvironmentContext,
	scope: EnvironmentScope,
	purpose?: EnvironmentPurpose,
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
	entry: EnvironmentEntry,
	context: EnvironmentContext,
	scope: EnvironmentScope,
	values: Record<string, string | undefined> = {},
) {
	const source = scope === 'local' && entry.localDefaultValue !== undefined ? entry.localDefaultValue : entry.defaultValue;
	if (source === undefined) {
		return undefined;
	}
	return typeof source === 'function' ? source(context, scope, values) : source;
}

export function getEnvironmentSuggestedValues(options: {
	scope: EnvironmentScope;
	purpose?: EnvironmentPurpose;
	deployConfig?: DeployConfig;
	tenantConfig?: TenantConfig;
	plugins?: LoadedPluginRegistration[];
	values?: Record<string, string | undefined>;
}) {
	const registry = resolveEnvironmentRegistry(options);
	const suggestedValues: Record<string, string> = {};
	const seedValues = { ...(options.values ?? {}) };

	for (const entry of registry.entries.filter((candidate) =>
		isEnvironmentEntryRelevant(candidate, registry.context, options.scope, options.purpose),
	)) {
		const value = materializeDefaultValue(entry, registry.context, options.scope, { ...suggestedValues, ...seedValues });
		if (value === undefined) {
			continue;
		}
		suggestedValues[entry.id] = value;
	}

	return suggestedValues;
}

export function isEnvironmentEntryRequired(
	entry: EnvironmentEntry,
	context: EnvironmentContext,
	scope: EnvironmentScope,
	purpose?: EnvironmentPurpose,
) {
	return isEntryRequired(entry, context, scope, purpose);
}

export function valuePresent(value: unknown) {
	return typeof value === 'string' && value.trim().length > 0;
}

export function validateValue(entry: EnvironmentEntry, value: string) {
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

export function validateEnvironmentValues(options: {
	values: Record<string, string | undefined>;
	scope: EnvironmentScope;
	purpose: EnvironmentPurpose;
	deployConfig?: DeployConfig;
	tenantConfig?: TenantConfig;
	plugins?: LoadedPluginRegistration[];
}): EnvironmentValidationResult {
	const registry = resolveEnvironmentRegistry(options);
	const relevantEntries = registry.entries.filter((entry) =>
		isEnvironmentEntryRelevant(entry, registry.context, options.scope, options.purpose),
	);
	const requiredEntries = relevantEntries.filter((entry) =>
		isEntryRequired(entry, registry.context, options.scope, options.purpose),
	);
	const missing: EnvironmentValidationProblem[] = [];
	const invalid: EnvironmentValidationProblem[] = [];

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
