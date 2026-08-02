import { ConfigScope } from '../accounts/ensure-secret-session-for-config.ts';
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
