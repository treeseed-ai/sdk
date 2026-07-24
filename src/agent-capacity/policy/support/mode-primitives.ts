import type { AgentExecutionMode } from '../../contracts/capacity/assignments/assignment-records.ts';
import type { AgentKernelModeFallback, AgentKernelModeFallbackCode } from '../../contracts/runtime/runtime-observability.ts';

export function isAgentExecutionMode(value: unknown): value is AgentExecutionMode {
	return value === 'planning' || value === 'acting';
}

export function normalizeAgentExecutionMode(value: unknown, fallback: AgentExecutionMode = 'planning'): AgentExecutionMode {
	return isAgentExecutionMode(value) ? value : fallback;
}

export function createAgentKernelModeFallback(
	code: AgentKernelModeFallbackCode | string,
	reason: string,
	options: { retryable?: boolean; metadata?: Record<string, unknown> } = {},
): AgentKernelModeFallback {
	return { code, reason, retryable: options.retryable ?? true, metadata: options.metadata ?? {} };
}
