import type { ProviderAssignmentCapabilityHandle, ProviderAssignmentCapabilityHandles, ProviderRepositoryAccessHandle, ProviderSecretUseHandle, ProviderTreeDxWorkspaceHandle, ProviderWorkflowOperationHandle } from '../../contracts/capacity/assignments/assignment-records.ts';
import type { AgentRuntimeSpec, ExecutionCapabilitySupply, ExecutionResourceNeed } from '../../../types/agents.ts';

export function record(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function stringList(value: unknown): string[] {
	return Array.isArray(value) ? value.map((entry) => String(entry ?? '').trim()).filter(Boolean) : [];
}

export function arrayValue(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

export function capabilityHandleArrays(handles: ProviderAssignmentCapabilityHandles | Record<string, unknown> | null | undefined): ProviderAssignmentCapabilityHandle[] {
	const source = record(handles);
	return [
		...arrayValue(source.repository),
		...arrayValue(source.treeDx),
		...arrayValue(source.workflowOperations),
		...arrayValue(source.secrets),
	].filter(isRecord) as ProviderAssignmentCapabilityHandle[];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function uniqueStrings(values: string[]): string[] {
	return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

export function numberOrNull(value: unknown): number | null {
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
}

export function booleanDefault(value: unknown, fallback: boolean): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

export function stringOrNull(value: unknown): string | null {
	if (value === null || value === undefined || value === '') return null;
	return String(value);
}

export function firstString(...values: unknown[]): string | null {
	for (const value of values) {
		const normalized = stringOrNull(value);
		if (normalized) return normalized;
	}
	return null;
}

export function firstArray(...values: unknown[]): unknown[] {
	for (const value of values) {
		if (Array.isArray(value)) return value;
	}
	return [];
}

export function booleanOrNull(value: unknown): boolean | null {
	return typeof value === 'boolean' ? value : null;
}

export function pressureAllows(pressure: ExecutionCapabilitySupply['pressure'] | undefined) {
	return pressure !== 'exhausted' && pressure !== 'throttled';
}

export function resourceNeedKey(need: ExecutionResourceNeed) {
	return [
		need.kind,
		uniqueStrings(need.operations).join('|'),
		uniqueStrings(need.paths ?? []).join('|'),
		need.required === false ? 'optional' : 'required',
	].join(':');
}

export function pushResourceNeed(target: ExecutionResourceNeed[], need: ExecutionResourceNeed) {
	const normalized: ExecutionResourceNeed = {
		...need,
		operations: uniqueStrings(need.operations),
		paths: need.paths?.length ? uniqueStrings(need.paths) : undefined,
		required: need.required ?? true,
		metadata: need.metadata,
	};
	if (!target.some((entry) => resourceNeedKey(entry) === resourceNeedKey(normalized))) {
		target.push(normalized);
	}
}

export function handleResourceNeed(handle: ProviderAssignmentCapabilityHandle): ExecutionResourceNeed | null {
	const operations = uniqueStrings([
		...stringList(handle.operations),
		...stringList((handle as ProviderTreeDxWorkspaceHandle).allowedOperations),
	]);
	if (handle.kind === 'repository_access') {
		const repository = handle as ProviderRepositoryAccessHandle;
		return {
			kind: 'repository',
			operations: operations.length ? operations : ['read'],
			paths: stringList(repository.allowedPaths),
			required: true,
			metadata: {
				handleId: handle.id,
				provider: repository.provider ?? null,
			},
		};
	}
	if (handle.kind === 'treedx_workspace') {
		const workspace = handle as ProviderTreeDxWorkspaceHandle;
		return {
			kind: 'treedx_workspace',
			operations: operations.length ? operations : ['read'],
			paths: stringList(workspace.allowedPaths),
			required: true,
			metadata: {
				handleId: handle.id,
				workspaceId: workspace.workspaceId ?? null,
			},
		};
	}
	if (handle.kind === 'workflow_operation') {
		const workflow = handle as ProviderWorkflowOperationHandle;
		return {
			kind: 'workflow',
			operations: operations.length ? operations : ['dispatch_workflow'],
			required: true,
			metadata: {
				handleId: handle.id,
				operationId: workflow.operationId,
				workflowFile: workflow.workflowFile,
			},
		};
	}
	if (handle.kind === 'secret_use') {
		return {
			kind: 'secret',
			operations: operations.length ? operations : ['use'],
			required: true,
			metadata: {
				handleId: handle.id,
				custodyMode: (handle as ProviderSecretUseHandle).custodyMode ?? null,
			},
		};
	}
	return null;
}

export function preferredCapabilitiesFromAgent(agent: Pick<AgentRuntimeSpec, 'execution' | 'outputs'> | null | undefined): string[] {
	const preferences = agent?.execution.providerProfile?.preferredExecutionProviders ?? [];
	return uniqueStrings(preferences.flatMap((entry) => [
		entry.provider,
		entry.providerId,
		entry.model,
		entry.modelClass,
	].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)));
}

export function recordStringArray(source: unknown, key: string): string[] {
	return stringList(record(source)[key]);
}

export function collectSupplyMetadataCapabilities(...sources: unknown[]) {
	return uniqueStrings(sources.flatMap((source) => [
		...recordStringArray(record(source).metadata, 'capabilities'),
		...recordStringArray(source, 'capabilities'),
	]));
}

export function collectSupplyMetadataAliases(...sources: unknown[]) {
	return uniqueStrings(sources.flatMap((source) => [
		...recordStringArray(record(source).metadata, 'capabilityAliases'),
		...recordStringArray(record(source).metadata, 'aliases'),
		...recordStringArray(source, 'capabilityAliases'),
		...recordStringArray(source, 'aliases'),
	]));
}

export function stableStringify(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
	const entries = Object.entries(value as Record<string, unknown>)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`);
	return `{${entries.join(',')}}`;
}
