export { AgentSdk, ScopedAgentSdk } from '../entrypoints/models/sdk.ts';

export * from '../operations/content-operations.ts';

export type {
	AgentSdkContentRepositoryOptions,
	AgentSdkTreeDxOptions,
	TreeDxContentPathRule,
	TreeDxRepositoryHint,
} from '../entrypoints/models/sdk.ts';

export { ContentGraphRuntime } from '../treedx/graph/graph.ts';

export * from '../treedx/index.ts';

export {
	createTreeDxClientFromAgentOptions,
	LocalContentBackend,
	LocalExecBackend,
	LocalGraphBackend,
	TreeDxApiError,
	TreeDxContentBackend,
	TreeDxContentRepositoryConfigError,
	TreeDxExecBackend,
	TreeDxGraphBackend,
	TreeDxPortfolioResolver,
} from '../treedx/repositories/treedx-backends.ts';

export type {
	ContentBackend,
	ExecBackend,
	GraphBackend,
	ResolvedTreeDxOptions,
	TreeDxRepositoryCandidate,
} from '../treedx/repositories/treedx-backends.ts';

export {
	BUILTIN_MODEL_REGISTRY,
	MODEL_REGISTRY,
	buildBuiltinModelRegistry,
	buildModelRegistry,
	buildScopedModelRegistry,
	mergeModelRegistries,
	resolveModelDefinition,
} from '../entrypoints/models/model-registry.ts';

export { normalizeAgentCliOptions, buildCopilotAllowToolArgs } from '../agents/cli-tools.ts';

export type {
	CopilotTaskInput,
	CopilotTaskResult,
} from '../agents/copilot.ts';

export async function runCopilotTask(input: import('../agents/copilot.ts').CopilotTaskInput): Promise<import('../agents/copilot.ts').CopilotTaskResult> {
	const { runCopilotTask: run } = await import('../agents/copilot.ts');
	return run(input);
}

export {
	AGENT_OPERATION_MODES,
	AGENT_OPERATION_NAMES,
	createAgentOperationEvent,
	decideAgentOperationPermission,
	deniedAgentOperationResult,
	isAgentOperationName,
	resolveAgentOperationGrant,
	type AgentDeterministicOperationStep,
	type AgentOperationEvent,
	type AgentOperationGrant,
	type AgentOperationMergeFailure,
	type AgentOperationMode,
	type AgentOperationName,
	type AgentOperationPermissionCode,
	type AgentOperationPermissionDecision,
	type AgentOperationRequest,
	type AgentOperationResult,
	type AgentOperationStatus,
} from '../operations/agents/agent-tools.ts';

export {
	AGENT_TOOL_DEFINITIONS,
	assertKnownAgentToolIds,
	findAgentToolDefinition,
	listAgentToolIds,
	type AgentToolDefinition,
	type AgentToolDispatchMapping,
	type AgentToolExecutionTarget,
	type AgentToolMutability,
	type AgentToolTelemetryCategory,
} from '../agents/agent-tools.ts';
