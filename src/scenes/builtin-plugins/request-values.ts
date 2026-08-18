import type { SceneRuntimePluginContext } from '../types.ts';
import { sceneRuntimeValue } from './duration.ts';

export function runtimeValue(value: unknown, context: SceneRuntimePluginContext): unknown {
	if (typeof value === 'string') return sceneRuntimeValue(value, context);
	if (Array.isArray(value)) return value.map((entry) => runtimeValue(entry, context));
	if (!value || typeof value !== 'object') return value;
	return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, runtimeValue(entry, context)]));
}

export function runtimeRecord(value: unknown, context: SceneRuntimePluginContext): Record<string, string> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
	return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, String(runtimeValue(entry, context))]));
}

export function hasHeader(headers: Record<string, string>, expected: string) {
	return Object.keys(headers).some((key) => key.toLowerCase() === expected);
}
