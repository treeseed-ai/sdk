import { ConfigScope } from '../accounts/ensure-secret-session-for-config.ts';
import type { CollectedConfigContext } from '../accounts/ensure-secret-session-for-config.ts';
import { listRelevantConfigEntries } from '../configuration/list-relevant-config-entries.ts';
import { maskValue } from '../configuration/machine-config-relative-path.ts';
import { collectConfigSeedValueSources,collectEnvironmentContext } from './resolve-entry-value-from-buckets.ts';

export function collectPrintEnvReport({
	tenantRoot,
	scope,
	env = process.env,
	revealSecrets = false,
}: {
	tenantRoot: string;
	scope: ConfigScope;
	env?: NodeJS.ProcessEnv;
	revealSecrets?: boolean;
}) {
	const registry = collectEnvironmentContext(tenantRoot);
	const { values, sources } = collectConfigSeedValueSources(tenantRoot, scope, env);
	return {
		scope,
		revealSecrets,
		entries: listRelevantConfigEntries(registry, scope).map((entry) => {
			const rawValue = values[entry.id] ?? '';
			const canRevealValue = entry.sensitivity !== 'secret' || revealSecrets;
			return {
				id: entry.id,
				label: entry.label,
				sensitivity: entry.sensitivity,
				value: canRevealValue ? rawValue : '',
				displayValue: rawValue
					? (entry.sensitivity === 'secret' && !revealSecrets ? maskValue(rawValue) : rawValue)
					: '(unset)',
				source: sources[entry.id] ?? 'unset',
				sourceRequirement: entry.sourceRequirement,
				sourceHostType: entry.sourceHostType ?? null,
				sourceProvider: entry.sourceProvider ?? null,
			};
		}),
	};
}

const REDACTED_CONFIG_VALUE = '<redacted>';

/** Build the only configuration-context shape allowed to cross a reporting boundary. */
export function redactConfigContextForReport(context: CollectedConfigContext) {
	const secretIds = new Set(Object.values(context.entriesByScope).flat()
		.filter((entry) => entry.sensitivity === 'secret').map((entry) => entry.id));
	const redactValues = (values: Record<string, string>) => Object.fromEntries(
		Object.entries(values).map(([id, value]) => [id, secretIds.has(id) && value ? REDACTED_CONFIG_VALUE : value]),
	);
	return {
		tenantRoot: context.tenantRoot,
		scopes: context.scopes,
		project: context.project,
		configPath: context.configPath,
		keyPath: context.keyPath,
		entriesByScope: Object.fromEntries(Object.entries(context.entriesByScope).map(([scope, entries]) => [scope,
			entries.map((entry) => entry.sensitivity === 'secret'
				? { ...entry, currentValue: REDACTED_CONFIG_VALUE, suggestedValue: REDACTED_CONFIG_VALUE, effectiveValue: REDACTED_CONFIG_VALUE }
				: entry),
		])),
		valuesByScope: Object.fromEntries(Object.entries(context.valuesByScope).map(([scope, values]) => [scope, redactValues(values)])),
		suggestedValuesByScope: Object.fromEntries(Object.entries(context.suggestedValuesByScope).map(([scope, values]) => [scope, redactValues(values)])),
		configReadinessByScope: context.configReadinessByScope,
		validationByScope: context.validationByScope,
		sharedStorageMigrations: context.sharedStorageMigrations,
	};
}
