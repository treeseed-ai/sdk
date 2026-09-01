export type AgentExecutionMode = 'planning' | 'acting';
export type AgentWorkExecutionMode = import('../../support/execution-mode.ts').AgentWorkExecutionMode;
export type ProviderAssignmentStatus = 'pending' | 'leased' | 'running' | 'completed' | 'failed' | 'returned' | 'expired' | 'cancelled';
export type ProviderAssignmentLeaseState = 'unleased' | 'leased' | 'released' | 'expired';
export type AgentModeRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type ProviderAssignmentSynthesisSource =
	| 'approved_decision'
	| 'planning_input_request'
	| 'capacity_plan'
	| 'workday_demand'
	| 'verification_failure'
	| 'fallback_queue';

export const AGENT_ASSIGNMENT_WORKSPACE_ACCESS_MODES = [
	'context_only',
	'workspace_write',
	'brokered_workspace',
	'full_workspace_no_credentials',
	'trusted_direct',
] as const;

export type AgentAssignmentWorkspaceAccessMode = (typeof AGENT_ASSIGNMENT_WORKSPACE_ACCESS_MODES)[number];
export type AgentAssignmentCapabilityHandleKind = 'repository_access' | 'treedx_workspace' | 'workflow_operation' | 'secret_use';
export type AgentAssignmentCapabilityOperation = 'read' | 'write' | 'test' | 'release' | 'dispatch_workflow' | 'commit' | 'push' | string;

export interface WorkdayCapacityEnvelope {
	teamId: string;
	projectId: string;
	workDayId?: string | null;
	environment?: string | null;
	executionMode?: AgentWorkExecutionMode;
	allocationSetId?: string | null;
	availableSeconds?: number | null;
	requestedSeconds?: number | null;
	reservedSeconds?: number | null;
	activeSeconds?: number | null;
	elapsedSeconds?: number | null;
	releasedSeconds?: number | null;
	overrunSeconds?: number | null;
	budget?: import('../../support/time-capacity.ts').CapacityBudgetV2 | null;
	metadata?: Record<string, unknown>;
}

export interface AgentCapacityEnvelope extends WorkdayCapacityEnvelope {
	mode: AgentExecutionMode;
	projectAgentClassId?: string | null;
	capacityProviderId?: string | null;
	executionProviderId?: string | null;
	reservationId?: string | null;
	nativeUnit?: string | null;
	reservedNativeAmount?: number | null;
	limits?: Record<string, unknown>;
}

export interface DecisionExecutionInput {
	teamId: string;
	projectId: string;
	projectAgentClassId: string;
	mode: AgentExecutionMode;
	executionMode?: AgentWorkExecutionMode;
	activityType?: import('../../../../types/agents.ts').AgentActivityType;
	workGraphNodeId?: string | null;
	estimateId?: string | null;
	taskId?: string | null;
	workDayId?: string | null;
	agentId?: string | null;
	handlerId?: string | null;
	capacity: AgentCapacityEnvelope;
	input: Record<string, unknown>;
	metadata?: Record<string, unknown>;
}

export interface TreeDxProxyHandle {
	id: string;
	teamId: string;
	projectId: string;
	assignmentId?: string | null;
	executionMode?: AgentWorkExecutionMode;
	repositoryId?: string | null;
	workspaceId?: string | null;
	baseCommitSha?: string | null;
	baseRef?: string | null;
	branchName?: string | null;
	status?: 'issued' | 'active' | 'revoked' | 'expired' | string;
	scopes: string[];
	expiresAt?: string | null;
	issuedAt?: string | null;
	revokedAt?: string | null;
	auditId?: string | null;
	token?: string | null;
	tokenHash?: string | null;
	allowedOperations?: string[];
	allowedPaths?: string[];
	allowedReadPaths?: string[];
	allowedWritePaths?: string[];
	readRepositories?: Array<{ projectId:string; projectSlug:string; repositoryId:string; baseRef:string; allowedPaths:string[]; allowedModels:string[]; source:'team-library'|'same-team'|'shared-team' }>;
	metadata?: Record<string, unknown>;
}

export interface ProviderAssignmentCapabilityHandleBase {
	id: string;
	kind: AgentAssignmentCapabilityHandleKind;
	teamId: string;
	projectId: string;
	assignmentId: string;
	executionMode?: AgentWorkExecutionMode;
	status?: 'active' | 'issued' | 'revoked' | 'expired' | 'blocked' | string;
	workspaceAccessMode?: AgentAssignmentWorkspaceAccessMode | string | null;
	operations?: AgentAssignmentCapabilityOperation[];
	expiresAt?: string | null;
	issuedAt?: string | null;
	metadata?: Record<string, unknown>;
}

export interface ProviderRepositoryAccessHandle extends ProviderAssignmentCapabilityHandleBase {
	kind: 'repository_access';
	repositoryId?: string | null;
	repository?: string | null;
	provider?: 'github_app' | 'treedx_proxy' | 'local_workspace' | 'workflow_operation' | string;
	allowedRefs?: string[];
	allowedPaths?: string[];
	credentialMode?: 'none' | 'brokered' | 'ephemeral_trusted_direct' | string;
}

export interface ProviderTreeDxWorkspaceHandle extends ProviderAssignmentCapabilityHandleBase {
	kind: 'treedx_workspace';
	proxyHandleId: string;
	repositoryId?: string | null;
	workspaceId?: string | null;
	allowedOperations?: string[];
	allowedPaths?: string[];
}

export interface ProviderWorkflowOperationHandle extends ProviderAssignmentCapabilityHandleBase {
	kind: 'workflow_operation';
	operationId: string;
	repository: string;
	workflowFile: string;
	ref?: string | null;
	environment?: string | null;
	secretBearing?: boolean;
	trustedExecutionSetId?: string | null;
	allowedInputs?: Record<string, unknown>;
}

export interface ProviderSecretUseHandle extends ProviderAssignmentCapabilityHandleBase {
	kind: 'secret_use';
	secretIds?: string[];
	secretClasses?: string[];
	custodyMode?: string | null;
	revealAllowed?: false;
}

export type ProviderAssignmentCapabilityHandle =
	| ProviderRepositoryAccessHandle
	| ProviderTreeDxWorkspaceHandle
	| ProviderWorkflowOperationHandle
	| ProviderSecretUseHandle;

export interface ProviderAssignmentCapabilityHandles {
	workspaceAccessMode: AgentAssignmentWorkspaceAccessMode;
	repository?: ProviderRepositoryAccessHandle[];
	treeDx?: ProviderTreeDxWorkspaceHandle[];
	workflowOperations?: ProviderWorkflowOperationHandle[];
	secrets?: ProviderSecretUseHandle[];
	metadata?: Record<string, unknown>;
}

export interface ProviderAssignment {
	id: string;
	membershipId: string;
	stateVersion: number;
	teamId: string;
	projectId: string;
	capacityProviderId: string;
	providerSessionId: string | null;
	executionProviderId: string | null;
	laneId: string | null;
	lanePurpose?: import('../communication/communication-records.ts').ProviderLanePurpose | null;
	communicationOverflow?: boolean;
	executionKind?: import('../communication/communication-records.ts').CapacityExecutionKind;
	triggerKind?: import('../communication/communication-records.ts').CapacityTriggerKind;
	invocationId?: string | null;
	parentWorkdayId?: string | null;
	parentAssignmentId?: string | null;
	handoffRootId?: string | null;
	handoffParentId?: string | null;
	handoffDepth?: number;
	sourceMessageRefs?: string[];
	allocationSetId: string | null;
	projectAgentClassId: string;
	reservationId: string | null;
	workDayId: string | null;
	taskId: string | null;
	mode: AgentExecutionMode;
	executionMode?: AgentWorkExecutionMode;
	status: ProviderAssignmentStatus;
	leaseState: ProviderAssignmentLeaseState;
	leaseExpiresAt: string | null;
	leaseToken: string | null;
	leaseRenewedAt: string | null;
	runnerId: string | null;
	agentId: string | null;
	handlerId: string | null;
	capacityEnvelope: AgentCapacityEnvelope;
	decisionInput: DecisionExecutionInput | Record<string, unknown>;
	workspaceContext: Record<string, unknown>;
	allowedOutputs: Record<string, unknown>;
	explanation: Record<string, unknown>;
	attemptCount: number;
	assignedAt: string | null;
	claimedAt: string | null;
	completedAt: string | null;
	returnedAt: string | null;
	failedAt: string | null;
	lifecycleReason: string | null;
	lifecycleCode: string | null;
	lifecycleOutput: Record<string, unknown>;
	synthesizedFrom: ProviderAssignmentSynthesisSource | null;
	synthesisKey: string | null;
	decisionId: string | null;
	proposalId: string | null;
	fallbackOutputId: string | null;
	treedxProxyHandle: TreeDxProxyHandle | Record<string, unknown> | null;
	capabilityHandles: ProviderAssignmentCapabilityHandles | Record<string, unknown> | null;
	metadata: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface ProviderAssignmentLifecycleRequest {
	runnerId?: string | null;
	leaseToken?: string | null;
	leaseSeconds?: number | null;
	reason?: string | null;
	code?: string | null;
	message?: string | null;
	retryable?: boolean | null;
	output?: Record<string, unknown> | null;
	summary?: Record<string, unknown> | null;
	fallbackOutput?: Record<string, unknown> | null;
	modeRunId?: string | null;
	metadata?: Record<string, unknown>;
	completion?: import('../../support/time-capacity.ts').AssignmentCompletionEvidence | null;
	performance?: import('../../support/time-capacity.ts').AssignmentPerformanceSummary | null;
}

export interface ProviderNextAssignmentRequest {
	sessionId?: string | null;
	runnerId?: string | null;
	leaseSeconds?: number | null;
	capabilities?: string[];
	laneId?: string | null;
	lanePurpose?: import('../communication/communication-records.ts').ProviderLanePurpose | null;
	waitSeconds?: number | null;
	metadata?: Record<string, unknown>;
}

export interface ProviderAssignmentLifecycleResult {
	ok: true;
	payload: ProviderAssignment | null;
	assignment?: ProviderAssignment | null;
	leaseToken?: string | null;
	leaseSeconds?: number | null;
	diagnostics?: Record<string, unknown> | null;
	leaseDiagnostics?: Record<string, unknown> | null;
}

export interface AgentModeRunUsageSettlement {
	capacityUsageActualId: string | null;
	capacityLedgerEntryId: string | null;
	activeSeconds: number | null;
	elapsedSeconds: number | null;
	actualUsd: number | null;
	nativeUsage: Record<string, unknown> | null;
	metadata: Record<string, unknown>;
}

export interface AgentModeRun {
	id: string;
	teamId: string;
	projectId: string;
	providerAssignmentId: string;
	capacityProviderId: string;
	executionProviderId: string | null;
	projectAgentClassId: string;
	agentId: string | null;
	handlerId: string | null;
	mode: AgentExecutionMode;
	executionMode?: AgentWorkExecutionMode;
	status: AgentModeRunStatus;
	selectedInput: Record<string, unknown>;
	capacityEnvelope: AgentCapacityEnvelope;
	outputs: Record<string, unknown>;
	traceRefs: Record<string, unknown>;
	usageActual: AgentModeRunUsageSettlement | Record<string, unknown>;
	validation: Record<string, unknown>;
	fallbackReason: string | null;
	startedAt: string | null;
	completedAt: string | null;
	failedAt: string | null;
	metadata: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}
