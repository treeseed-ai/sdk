export { AgentSdk, ScopedAgentSdk } from '.././sdk.ts';

export * from '.././content-operations.ts';

export type {
	AgentSdkContentRepositoryOptions,
	AgentSdkTreeDxOptions,
	TreeSeedTreeDxContentPathRule,
	TreeSeedTreeDxRepositoryHint,
} from '.././sdk.ts';

export { ContentGraphRuntime } from '.././graph.ts';

export * from '.././treedx/index.ts';

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
} from '.././treedx-backends.ts';

export type {
	ContentBackend,
	ExecBackend,
	GraphBackend,
	ResolvedTreeDxOptions,
	TreeDxRepositoryCandidate,
} from '.././treedx-backends.ts';

export {
	BUILTIN_MODEL_REGISTRY,
	MODEL_REGISTRY,
	buildBuiltinModelRegistry,
	buildModelRegistry,
	buildScopedModelRegistry,
	mergeModelRegistries,
	resolveModelDefinition,
} from '.././model-registry.ts';

export { normalizeAgentCliOptions, buildCopilotAllowToolArgs } from '.././cli-tools.ts';

export type {
	TreeseedCopilotTaskInput,
	TreeseedCopilotTaskResult,
} from '.././copilot.ts';

export async function runTreeseedCopilotTask(input: import('../copilot.ts').TreeseedCopilotTaskInput): Promise<import('../copilot.ts').TreeseedCopilotTaskResult> {
	const { runTreeseedCopilotTask: run } = await import('../copilot.ts');
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
} from '.././operations/agent-tools.ts';

export {
	TREESEED_AGENT_TOOL_DEFINITIONS,
	assertKnownAgentToolIds,
	findAgentToolDefinition,
	listAgentToolIds,
	type AgentToolDefinition,
	type AgentToolDispatchMapping,
	type AgentToolExecutionTarget,
	type AgentToolMutability,
	type AgentToolTelemetryCategory,
} from '.././agent-tools.ts';
