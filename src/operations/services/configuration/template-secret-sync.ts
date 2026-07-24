import {
	syncCloudflareEnvironment,
	syncGitHubEnvironment,
	syncRailwayEnvironment,
	type ConfigScope,
} from './config-runtime.ts';
import type {
	ProjectLaunchResolvedHostBinding,
	ProjectLaunchSecretDeploymentPlanItem,
} from '../../../entrypoints/templates/template-launch-requirements.ts';
import type { ProjectLaunchRequirementKind } from '../../../entrypoints/models/sdk-types.ts';

export type ProjectLaunchSecretSyncProvider = 'github' | 'cloudflare' | 'railway';
export type ProjectLaunchSecretSyncStatus = 'synced' | 'skipped' | 'failed';
export type ProjectLaunchSecretSyncProviderStatus = 'running' | 'completed' | 'failed';
export type ProjectLaunchSecretSyncTargetKind =
	| 'github-secret'
	| 'github-variable'
	| 'cloudflare-secret'
	| 'cloudflare-var'
	| 'railway-secret'
	| 'railway-var';

export interface ProjectLaunchSecretValueDiagnostic {
	code: 'missing_value' | 'unsupported_target';
	requirementKey: string;
	requirementKind: ProjectLaunchRequirementKind;
	env: string;
	source: string;
	targets: string[];
	scopes: ConfigScope[];
	message: string;
}

export interface ProjectLaunchResolvedSecretValueItem {
	requirementKey: string;
	requirementKind: ProjectLaunchRequirementKind;
	env: string;
	source: string;
	targets: ProjectLaunchSecretSyncTargetKind[];
	scopes: ConfigScope[];
	sensitivity: string;
	sourceHostId?: string | null;
	resolved: boolean;
}

export interface ProjectLaunchSecretValueOverlayResult {
	valuesOverlay: Record<string, string>;
	items: ProjectLaunchResolvedSecretValueItem[];
	diagnostics: ProjectLaunchSecretValueDiagnostic[];
}

export interface ProjectLaunchSecretSyncSummaryItem {
	provider: ProjectLaunchSecretSyncProvider;
	scope: ConfigScope;
	target: ProjectLaunchSecretSyncTargetKind;
	env: string;
	requirementKey: string;
	requirementKind: ProjectLaunchRequirementKind;
	sensitivity: string;
	status: ProjectLaunchSecretSyncStatus;
	error?: {
		message: string;
	};
}

export interface ProjectLaunchSecretSyncProviderSummary {
	provider: ProjectLaunchSecretSyncProvider;
	scope: ConfigScope;
	entryIds: string[];
	status: Exclude<ProjectLaunchSecretSyncProviderStatus, 'running'>;
	error?: {
		message: string;
	};
}

export interface ProjectLaunchSecretSyncProgressEvent {
	provider: ProjectLaunchSecretSyncProvider;
	scope: ConfigScope;
	status: ProjectLaunchSecretSyncProviderStatus;
	entryIds: string[];
	message: string;
}

export interface ProjectLaunchSecretSyncResult {
	ok: boolean;
	items: ProjectLaunchSecretSyncSummaryItem[];
	providers: ProjectLaunchSecretSyncProviderSummary[];
	diagnostics: ProjectLaunchSecretValueDiagnostic[];
}

export interface ProjectLaunchSecretSyncAdapters {
	github?: typeof syncGitHubEnvironment;
	cloudflare?: typeof syncCloudflareEnvironment;
	railway?: typeof syncRailwayEnvironment;
}

export interface ResolveProjectLaunchSecretValueOverlayOptions {
	hostBindings?: Record<string, ProjectLaunchResolvedHostBinding> | null;
	secretDeploymentPlan?: { items?: ProjectLaunchSecretDeploymentPlanItem[] | null } | null;
	valuesOverlay?: Record<string, string | undefined> | null;
	valuesByScope?: Partial<Record<ConfigScope, Record<string, string | undefined> | null>> | null;
	processEnv?: Record<string, string | undefined>;
	scopes?: ConfigScope[];
}

export interface SyncProjectLaunchHostBindingSecretsOptions extends ResolveProjectLaunchSecretValueOverlayOptions {
	projectRoot: string;
	repository?: string | null;
	planOnly?: boolean;
	providers?: ProjectLaunchSecretSyncProvider[];
	onProgress?: (event: ProjectLaunchSecretSyncProgressEvent) => void | Promise<void>;
	adapters?: ProjectLaunchSecretSyncAdapters;
}

const PROVIDER_TARGETS: Record<ProjectLaunchSecretSyncProvider, ProjectLaunchSecretSyncTargetKind[]> = {
	github: ['github-secret', 'github-variable'],
	cloudflare: ['cloudflare-secret', 'cloudflare-var'],
	railway: ['railway-secret', 'railway-var'],
};

const DEFAULT_SCOPES: ConfigScope[] = ['staging', 'prod'];
const NON_PROVIDER_TARGETS = new Set(['local-runtime', 'local-cloudflare', 'config-file']);
const SECRET_TOKEN_PATTERN = /(?:gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,}|[A-Za-z0-9+/=]{32,})/gu;

export class ProjectLaunchSecretSyncError extends Error {
	readonly result: ProjectLaunchSecretSyncResult;

	constructor(message: string, result: ProjectLaunchSecretSyncResult) {
		super(message);
		this.name = 'ProjectLaunchSecretSyncError';
		this.result = result;
	}
}

function stringValue(value: unknown) {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';
}

function normalizeSecretTargets(targets: string[]) {
	const allowed = new Set(Object.values(PROVIDER_TARGETS).flat());
	return targets
		.map((target) => String(target ?? '').trim())
		.filter((target): target is ProjectLaunchSecretSyncTargetKind => allowed.has(target as ProjectLaunchSecretSyncTargetKind));
}

function normalizeScopes(items: ProjectLaunchSecretDeploymentPlanItem[], requested?: ConfigScope[]) {
	const scopes = new Set<ConfigScope>(requested?.length ? requested : DEFAULT_SCOPES);
	for (const item of items) {
		for (const scope of item.scopes ?? []) {
			if (scope === 'staging' || scope === 'prod') {
				scopes.add(scope);
			}
		}
	}
	return [...scopes];
}

function valueCandidatesForSource(source: string) {
	const value = String(source ?? '').trim();
	if (!value) return [];
	const [, suffix = ''] = /^(?:selectedHost|host)\.(?:secret|config|environment|env):(.+)$/u.exec(value) ?? [];
	if (suffix) {
		return [suffix, suffix.toUpperCase(), `TREESEED_${suffix.toUpperCase()}`];
	}
	const [, dotted = ''] = /^(?:selectedHost|host)\.([A-Za-z0-9_]+)$/u.exec(value) ?? [];
	if (dotted) {
		return [dotted, dotted.toUpperCase(), `TREESEED_${dotted.toUpperCase()}`];
	}
	return [];
}

function scopedOverlay(
	options: ResolveProjectLaunchSecretValueOverlayOptions,
	scope: ConfigScope,
) {
	return {
		...(options.processEnv ?? process.env),
		...(options.valuesOverlay ?? {}),
		...(options.valuesByScope?.[scope] ?? {}),
	};
}

function bindingValue(binding: ProjectLaunchResolvedHostBinding | undefined, key: string) {
	if (!binding || !key) return '';
	const record = binding as unknown as Record<string, any>;
	for (const containerKey of ['environmentValues', 'configValues', 'secrets', 'secretValues', 'metadata']) {
		const container = record[containerKey];
		if (container && typeof container === 'object') {
			const value = stringValue(container[key]) || stringValue(container[key.toUpperCase()]);
			if (value) return value;
		}
	}
	return stringValue(record[key]) || stringValue(record[key.toUpperCase()]);
}

function resolvePlanItemValue(
	item: ProjectLaunchSecretDeploymentPlanItem,
	scope: ConfigScope,
	options: ResolveProjectLaunchSecretValueOverlayOptions,
) {
	const values = scopedOverlay(options, scope);
	const direct = stringValue(values[item.env]);
	if (direct) return direct;
	const binding = item.sourceHostId ? options.hostBindings?.[item.requirementKey] : undefined;
	for (const candidate of valueCandidatesForSource(item.source)) {
		const overlayValue = stringValue(values[candidate]);
		if (overlayValue) return overlayValue;
		const hostValue = bindingValue(binding, candidate);
		if (hostValue) return hostValue;
	}
	return '';
}

function providerForTarget(target: ProjectLaunchSecretSyncTargetKind): ProjectLaunchSecretSyncProvider {
	if (target.startsWith('github-')) return 'github';
	if (target.startsWith('cloudflare-')) return 'cloudflare';
	return 'railway';
}

function redactSecretSyncMessage(message: unknown) {
	return String(message instanceof Error ? message.message : message ?? 'Secret sync failed.')
		.replace(SECRET_TOKEN_PATTERN, '[redacted]')
		.replace(/(token|password|secret|key)=([^,\s]+)/giu, '$1=[redacted]');
}

export function resolveProjectLaunchSecretValueOverlay(
	options: ResolveProjectLaunchSecretValueOverlayOptions,
): ProjectLaunchSecretValueOverlayResult {
	const planItems = options.secretDeploymentPlan?.items?.filter(Boolean) ?? [];
	const scopes = normalizeScopes(planItems, options.scopes);
	const valuesOverlay: Record<string, string> = {};
	const resolvedItems: ProjectLaunchResolvedSecretValueItem[] = [];
	const diagnostics: ProjectLaunchSecretValueDiagnostic[] = [];

	for (const item of planItems) {
		const targets = normalizeSecretTargets(item.targets ?? []);
		const itemScopes = (item.scopes ?? []).filter((scope): scope is ConfigScope => scope === 'local' || scope === 'staging' || scope === 'prod');
		if (targets.length === 0) {
			if ((item.targets ?? []).every((target) => NON_PROVIDER_TARGETS.has(String(target)))) {
				continue;
			}
			diagnostics.push({
				code: 'unsupported_target',
				requirementKey: item.requirementKey,
				requirementKind: item.requirementKind,
				env: item.env,
				source: item.source,
				targets: item.targets ?? [],
				scopes: itemScopes,
				message: `Secret deployment target is not supported for ${item.env}.`,
			});
			continue;
		}
		const activeScopes = itemScopes.filter((scope) => scopes.includes(scope));
		let resolved = false;
		for (const scope of activeScopes) {
			const value = resolvePlanItemValue(item, scope, options);
			if (value) {
				valuesOverlay[item.env] = value;
				resolved = true;
				break;
			}
		}
		if (!resolved) {
			diagnostics.push({
				code: 'missing_value',
				requirementKey: item.requirementKey,
				requirementKind: item.requirementKind,
				env: item.env,
				source: item.source,
				targets,
				scopes: activeScopes,
				message: `No launch secret value was available for ${item.env}.`,
			});
		}
		resolvedItems.push({
			requirementKey: item.requirementKey,
			requirementKind: item.requirementKind,
			env: item.env,
			source: item.source,
			targets,
			scopes: activeScopes,
			sensitivity: item.sensitivity,
			sourceHostId: item.sourceHostId ?? null,
			resolved,
		});
	}

	return { valuesOverlay, items: resolvedItems, diagnostics };
}

function itemsForProviderScope(
	items: ProjectLaunchResolvedSecretValueItem[],
	provider: ProjectLaunchSecretSyncProvider,
	scope: ConfigScope,
) {
	const targets = new Set(PROVIDER_TARGETS[provider]);
	return items.filter((item) =>
		item.resolved
		&& item.scopes.includes(scope)
		&& item.targets.some((target) => targets.has(target)));
}

function summaryItemsFor(
	items: ProjectLaunchResolvedSecretValueItem[],
	provider: ProjectLaunchSecretSyncProvider,
	scope: ConfigScope,
	status: ProjectLaunchSecretSyncStatus,
	error?: unknown,
): ProjectLaunchSecretSyncSummaryItem[] {
	const targets = new Set(PROVIDER_TARGETS[provider]);
	return items.flatMap((item) =>
		item.targets
			.filter((target) => targets.has(target))
			.map((target) => ({
				provider,
				scope,
				target,
				env: item.env,
				requirementKey: item.requirementKey,
				requirementKind: item.requirementKind,
				sensitivity: item.sensitivity,
				status,
				...(error ? { error: { message: redactSecretSyncMessage(error) } } : {}),
			})));
}

export async function syncProjectLaunchHostBindingSecrets(
	options: SyncProjectLaunchHostBindingSecretsOptions,
): Promise<ProjectLaunchSecretSyncResult> {
	const planItems = options.secretDeploymentPlan?.items?.filter(Boolean) ?? [];
	const scopes = normalizeScopes(planItems, options.scopes);
	const providers = options.providers?.length ? options.providers : Object.keys(PROVIDER_TARGETS) as ProjectLaunchSecretSyncProvider[];
	const overlay = resolveProjectLaunchSecretValueOverlay({ ...options, scopes });
	const relevantDiagnostics = overlay.diagnostics.filter((diagnostic) =>
		diagnostic.scopes.some((scope) => scopes.includes(scope))
		&& diagnostic.targets.some((target) => providers.includes(providerForTarget(target as ProjectLaunchSecretSyncTargetKind))));
	const result: ProjectLaunchSecretSyncResult = {
		ok: relevantDiagnostics.length === 0,
		items: [],
		providers: [],
		diagnostics: overlay.diagnostics,
	};
	if (relevantDiagnostics.length > 0) {
		for (const diagnostic of relevantDiagnostics) {
			for (const target of normalizeSecretTargets(diagnostic.targets)) {
				const provider = providerForTarget(target);
				for (const scope of diagnostic.scopes.filter((entry) => scopes.includes(entry))) {
					result.items.push({
						provider,
						scope,
						target,
						env: diagnostic.env,
						requirementKey: diagnostic.requirementKey,
						requirementKind: diagnostic.requirementKind,
						sensitivity: 'secret',
						status: 'failed',
						error: { message: diagnostic.message },
					});
				}
			}
		}
		throw new ProjectLaunchSecretSyncError('Host-bound secret sync could not resolve every required value.', result);
	}

	const adapters = {
		github: options.adapters?.github ?? syncGitHubEnvironment,
		cloudflare: options.adapters?.cloudflare ?? syncCloudflareEnvironment,
		railway: options.adapters?.railway ?? syncRailwayEnvironment,
	};

	for (const provider of providers) {
		for (const scope of scopes) {
			if (scope === 'local') continue;
			const scopedItems = itemsForProviderScope(overlay.items, provider, scope);
			if (scopedItems.length === 0) continue;
			const entryIds = [...new Set(scopedItems.map((item) => item.env))];
			await options.onProgress?.({
				provider,
				scope,
				entryIds,
				status: 'running',
				message: `Syncing ${entryIds.length} host-bound ${provider} entr${entryIds.length === 1 ? 'y' : 'ies'} for ${scope}.`,
			});
			try {
				const valuesOverlay = {
					...overlay.valuesOverlay,
					...(options.valuesByScope?.[scope] ?? {}),
				};
				if (provider === 'github') {
					await adapters.github({
						tenantRoot: options.projectRoot,
						scope,
						planOnly: options.planOnly,
						repository: options.repository ?? null,
						valuesOverlay,
						entryIds,
						execution: 'sequential',
					});
				} else if (provider === 'cloudflare') {
					adapters.cloudflare({
						tenantRoot: options.projectRoot,
						scope,
						planOnly: options.planOnly,
						valuesOverlay,
						entryIds,
					});
				} else {
					adapters.railway({
						tenantRoot: options.projectRoot,
						scope,
						planOnly: options.planOnly,
						valuesOverlay,
						entryIds,
					});
				}
				result.items.push(...summaryItemsFor(scopedItems, provider, scope, 'synced'));
				result.providers.push({ provider, scope, entryIds, status: 'completed' });
				await options.onProgress?.({
					provider,
					scope,
					entryIds,
					status: 'completed',
					message: `Synced host-bound ${provider} entries for ${scope}.`,
				});
			} catch (error) {
				result.ok = false;
				result.items.push(...summaryItemsFor(scopedItems, provider, scope, 'failed', error));
				result.providers.push({
					provider,
					scope,
					entryIds,
					status: 'failed',
					error: { message: redactSecretSyncMessage(error) },
				});
				await options.onProgress?.({
					provider,
					scope,
					entryIds,
					status: 'failed',
					message: redactSecretSyncMessage(error),
				});
				throw new ProjectLaunchSecretSyncError(redactSecretSyncMessage(error), result);
			}
		}
	}

	result.ok = result.providers.every((provider) => provider.status === 'completed') && result.diagnostics.length === 0;
	return result;
}
