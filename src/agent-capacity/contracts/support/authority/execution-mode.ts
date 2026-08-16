export const AGENT_WORK_EXECUTION_MODES = ['simulation', 'production'] as const;

/** Repository-publication authority. This is independent from planning/acting safety mode. */
export type AgentWorkExecutionMode = (typeof AGENT_WORK_EXECUTION_MODES)[number];

export const UPSTREAM_MUTATION_POLICIES = ['denied', 'checkpoint-only', 'exact-approved-ref'] as const;
export type UpstreamMutationPolicy = (typeof UPSTREAM_MUTATION_POLICIES)[number];

export function upstreamMutationPolicyFor(input: {
	executionMode: AgentWorkExecutionMode;
	authority: 'assignment' | 'platform-integration';
}): UpstreamMutationPolicy {
	if (input.executionMode === 'simulation') return 'denied';
	return input.authority === 'assignment' ? 'checkpoint-only' : 'exact-approved-ref';
}

export function parseAgentWorkExecutionMode(value: unknown): AgentWorkExecutionMode {
	if (value === undefined || value === null || value === '') return 'simulation';
	if (value === 'simulation' || value === 'production') return value;
	throw new Error('executionMode must be simulation or production.');
}
