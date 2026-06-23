import type {
	CapacityGrant,
	CapacityLedgerEntry,
	CapacityPlan as LegacyCapacityPlan,
	CapacityProvider,
	CapacityReservation,
	ExecutionProvider,
	TaskUsageActual,
} from './sdk-types.ts';
import type {
	AgentRuntimeSpec,
	AgentWorkPackage,
	ExecutionCapabilityDemand,
	ExecutionCapabilitySupply,
	ExecutionProviderDescriptor,
	ExecutionResourceNeed,
} from './types/agents.ts';

export type AgentExecutionMode = 'planning' | 'acting';
export type AllocationSetStatus = 'draft' | 'active' | 'superseded' | 'archived';
export type ProjectAgentClassStatus = 'active' | 'paused' | 'archived';
export type ProviderAvailabilitySessionStatus = 'open' | 'draining' | 'closed' | 'expired';
export type ProviderAssignmentStatus = 'pending' | 'leased' | 'running' | 'completed' | 'failed' | 'returned' | 'expired';
export type ProviderAssignmentLeaseState = 'unleased' | 'leased' | 'released' | 'expired';
export type AgentModeRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type AgentKernelModeExecutionStatus = 'completed' | 'waiting' | 'failed' | 'returned';
export type DecisionExecutionReadinessStatus = 'draft' | 'blocked' | 'ready' | 'stale' | 'waived';
export type PlanningInputRequestStatus = 'requested' | 'complete' | 'waived' | 'rejected' | 'stale';
export type DecisionExecutionInputStatus = 'proposed' | 'accepted' | 'revision_requested' | 'rejected' | 'stale';
export type WorkdayCapacityEnvelopeStatus = 'draft' | 'active' | 'paused' | 'completed' | 'cancelled';
export type DurableAgentCapacityPlanStatus = 'draft' | 'accepted' | 'revision_requested' | 'deferred' | 'scheduled' | 'active' | 'completed' | 'superseded';
export type ProviderAssignmentSynthesisSource =
	| 'approved_decision'
	| 'planning_input_request'
	| 'capacity_plan'
	| 'verification_failure'
	| 'fallback_queue'
	| 'fixture';
export type AgentKernelModeFallbackCode =
	| 'assignment_missing_project_or_agent'
	| 'assignment_lease_expired'
	| 'assignment_mode_not_allowed'
	| 'assignment_missing_capacity_envelope'
	| 'assignment_missing_decision_input'
	| 'assignment_handler_failed'
	| 'assignment_project_not_synced'
	| 'assignment_agent_not_found'
	| 'assignment_insufficient_capability'
	| 'assignment_decision_not_ready'
	| 'assignment_capacity_plan_not_accepted'
	| 'assignment_capacity_not_reserved'
	| 'assignment_capability_handle_invalid'
	| 'assignment_capability_handle_secret_material'
	| 'assignment_capability_handle_write_not_ready'
	| 'assignment_capability_handle_workspace_denied'
	| 'assignment_workflow_operation_denied'
	| 'assignment_eligibility_capability_mismatch'
	| 'assignment_retry_policy_exceeded'
	| 'assignment_treedx_proxy_scope_invalid'
	| 'assignment_fallback_quota_exceeded'
	| 'assignment_output_invalid';

export const AGENT_ASSIGNMENT_WORKSPACE_ACCESS_MODES = [
	'context_only',
	'brokered_workspace',
	'full_workspace_no_credentials',
	'trusted_direct',
] as const;

export type AgentAssignmentWorkspaceAccessMode = (typeof AGENT_ASSIGNMENT_WORKSPACE_ACCESS_MODES)[number];
export type AgentAssignmentCapabilityHandleKind = 'repository_access' | 'treedx_workspace' | 'workflow_operation' | 'secret_use';
export type AgentAssignmentCapabilityOperation = 'read' | 'write' | 'test' | 'release' | 'dispatch_workflow' | 'commit' | 'push' | string;

export interface AllocationSetSlice {
	projectId: string | null;
	capacityProviderId: string;
	laneId?: string | null;
	environment?: string | null;
	priorityWeight?: number | null;
	overflowPolicy?: string | null;
	percent?: number | null;
	dailyCreditLimit?: number | null;
	monthlyCreditLimit?: number | null;
	metadata?: Record<string, unknown>;
}

export interface AllocationSet {
	id: string;
	teamId: string;
	version: string;
	status: AllocationSetStatus | string;
	effectiveFrom?: string | null;
	effectiveUntil?: string | null;
	policy: Record<string, unknown>;
	slices: AllocationSetSlice[];
	createdById?: string | null;
	activatedAt?: string | null;
	supersededById?: string | null;
	metadata?: Record<string, unknown>;
	createdAt?: string;
	updatedAt?: string;
}

export type CapacityAllocationSet = AllocationSet;

export interface AgentKernelProfile {
	id?: string;
	name?: string;
	defaultMode?: AgentExecutionMode;
	allowedModes?: AgentExecutionMode[];
	planningBudgetPercent?: number;
	actingBudgetPercent?: number;
	maxConcurrentModeRuns?: number;
	fallbackMode?: AgentExecutionMode | null;
	metadata?: Record<string, unknown>;
}

export interface AgentKernelPolicy {
	modeSelection?: Record<string, unknown>;
	budgetSplit?: Record<string, unknown>;
	fallback?: Record<string, unknown>;
	outputValidation?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
}

export interface ProjectAgentClass {
	id: string;
	teamId: string;
	projectId: string;
	slug: string;
	name: string;
	status: ProjectAgentClassStatus | string;
	allowedModes: AgentExecutionMode[];
	requiredCapabilities: string[];
	kernelProfile: AgentKernelProfile;
	kernelPolicy: AgentKernelPolicy;
	handlerRefs: Record<string, unknown>;
	outputContracts: Record<string, unknown>;
	metadata?: Record<string, unknown>;
	createdAt?: string;
	updatedAt?: string;
}

export interface WorkdayCapacityEnvelope {
	teamId: string;
	projectId: string;
	workDayId?: string | null;
	environment?: string | null;
	allocationSetId?: string | null;
	availableCredits?: number | null;
	reservedCredits?: number | null;
	consumedCredits?: number | null;
	metadata?: Record<string, unknown>;
}

export interface AgentCapacityEnvelope extends WorkdayCapacityEnvelope {
	mode: AgentExecutionMode;
	projectAgentClassId?: string | null;
	capacityProviderId?: string | null;
	executionProviderId?: string | null;
	laneId?: string | null;
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
	taskId?: string | null;
	workDayId?: string | null;
	agentId?: string | null;
	handlerId?: string | null;
	capacity: AgentCapacityEnvelope;
	input: Record<string, unknown>;
	metadata?: Record<string, unknown>;
}

export interface AgentCapacityPlan {
	teamId: string;
	projectId: string;
	environment: string;
	allocationSetId?: string | null;
	workday: WorkdayCapacityEnvelope;
	assignableProviders: Array<{
		capacityProviderId: string;
		executionProviderId?: string | null;
		laneId?: string | null;
		availableCredits?: number | null;
		reasons?: string[];
		metadata?: Record<string, unknown>;
	}>;
	legacyPlan?: LegacyCapacityPlan | Record<string, unknown> | null;
	metadata?: Record<string, unknown>;
}

export type CapacityPlan = AgentCapacityPlan;

export interface ProviderAvailabilitySession {
	id: string;
	teamId: string;
	capacityProviderId: string;
	registrationId?: string | null;
	environment?: string | null;
	status: ProviderAvailabilitySessionStatus | string;
	checkedInAt: string;
	availableFrom?: string | null;
	availableUntil?: string | null;
	executionProviders: ExecutionProvider[];
	capabilities: string[];
	grants: CapacityGrant[];
	nativeLimits?: Record<string, unknown>;
	runnerPressure?: Record<string, unknown>;
	constraints?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
	createdAt?: string;
	updatedAt?: string;
	closedAt?: string | null;
}

export interface ProviderAssignment {
	id: string;
	teamId: string;
	projectId: string;
	capacityProviderId: string;
	providerSessionId?: string | null;
	executionProviderId?: string | null;
	allocationSetId?: string | null;
	projectAgentClassId: string;
	reservationId?: string | null;
	workDayId?: string | null;
	taskId?: string | null;
	mode: AgentExecutionMode;
	status: ProviderAssignmentStatus | string;
	leaseState: ProviderAssignmentLeaseState | string;
	leaseExpiresAt?: string | null;
	leaseToken?: string | null;
	leaseRenewedAt?: string | null;
	runnerId?: string | null;
	agentId?: string | null;
	handlerId?: string | null;
	capacityEnvelope: AgentCapacityEnvelope;
	decisionInput: DecisionExecutionInput | Record<string, unknown>;
	workspaceContext?: Record<string, unknown>;
	allowedOutputs?: Record<string, unknown>;
	explanation?: Record<string, unknown>;
	attemptCount?: number;
	assignedAt?: string | null;
	claimedAt?: string | null;
	completedAt?: string | null;
	returnedAt?: string | null;
	failedAt?: string | null;
	lifecycleReason?: string | null;
	lifecycleCode?: string | null;
	lifecycleOutput?: Record<string, unknown>;
	synthesizedFrom?: ProviderAssignmentSynthesisSource | string | null;
	synthesisKey?: string | null;
	decisionId?: string | null;
	proposalId?: string | null;
	fallbackOutputId?: string | null;
	treedxProxyHandle?: TreeDxProxyHandle | Record<string, unknown> | null;
	capabilityHandles?: ProviderAssignmentCapabilityHandles | Record<string, unknown> | null;
	metadata?: Record<string, unknown>;
	createdAt?: string;
	updatedAt?: string;
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
	usageActualId?: string | null;
	modeRunId?: string | null;
	metadata?: Record<string, unknown>;
}

export interface ProviderCheckInRequest {
	id?: string;
	registrationId?: string | null;
	environment?: string | null;
	status?: ProviderAvailabilitySessionStatus | string;
	availableFrom?: string | null;
	availableUntil?: string | null;
	executionProviders?: ExecutionProvider[];
	capabilities?: string[];
	grants?: CapacityGrant[];
	nativeLimits?: Record<string, unknown>;
	runnerPressure?: Record<string, unknown>;
	constraints?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
}

export interface ProviderNextAssignmentRequest {
	sessionId?: string | null;
	runnerId?: string | null;
	leaseSeconds?: number | null;
	capabilities?: string[];
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
	taskUsageActualId?: string | null;
	capacityLedgerEntryId?: string | null;
	actualCredits?: number | null;
	actualUsd?: number | null;
	nativeUsage?: Record<string, unknown> | null;
	metadata?: Record<string, unknown>;
}

export interface AgentModeRun {
	id: string;
	teamId: string;
	projectId: string;
	providerAssignmentId: string;
	capacityProviderId: string;
	executionProviderId?: string | null;
	projectAgentClassId: string;
	agentId?: string | null;
	handlerId?: string | null;
	mode: AgentExecutionMode;
	status: AgentModeRunStatus | string;
	selectedInput: Record<string, unknown>;
	capacityEnvelope: AgentCapacityEnvelope;
	outputs?: Record<string, unknown>;
	traceRefs?: Record<string, unknown>;
	usageActual?: AgentModeRunUsageSettlement | Record<string, unknown>;
	validation?: Record<string, unknown>;
	fallbackReason?: string | null;
	startedAt?: string | null;
	completedAt?: string | null;
	failedAt?: string | null;
	metadata?: Record<string, unknown>;
	createdAt?: string;
	updatedAt?: string;
}

export interface AgentKernelModeFallback {
	code: AgentKernelModeFallbackCode | string;
	reason: string;
	retryable: boolean;
	metadata?: Record<string, unknown>;
}

export interface AgentKernelModeExecutionInput {
	assignment: ProviderAssignment;
	projectAgentClass?: ProjectAgentClass | null;
	kernelProfile?: AgentKernelProfile | null;
	kernelPolicy?: AgentKernelPolicy | null;
	capacityEnvelope?: AgentCapacityEnvelope | null;
	decisionInput?: DecisionExecutionInput | null;
	leaseToken?: string | null;
	runnerId?: string | null;
	readiness?: DecisionPlanningStatus | null;
	treedxProxyHandle?: TreeDxProxyHandle | null;
	now?: string | Date;
	metadata?: Record<string, unknown>;
}

export interface AgentKernelModeExecutionResult {
	status: AgentKernelModeExecutionStatus;
	mode: AgentExecutionMode;
	assignmentId: string;
	projectId: string;
	projectAgentClassId: string;
	agentId?: string | null;
	handlerId?: string | null;
	summary: string;
	outputs?: Record<string, unknown>;
	selectedInput: Record<string, unknown>;
	capacityEnvelope: AgentCapacityEnvelope;
	traceRefs?: Record<string, unknown>;
	usageActual?: AgentModeRunUsageSettlement | Record<string, unknown> | null;
	fallback?: AgentKernelModeFallback | null;
	metadata?: Record<string, unknown>;
}

export interface AgentKernelQueueObservation {
	planningReady?: number | null;
	actingReady?: number | null;
	fallbackReady?: number | null;
	planningBudgetCredits?: number | null;
	actingBudgetCredits?: number | null;
	modePreference?: AgentExecutionMode | 'fallback' | null;
	metadata?: Record<string, unknown>;
}

export interface AgentKernelModeDecision {
	kind: 'mode' | 'fallback' | 'idle';
	mode?: AgentExecutionMode | null;
	reason: string;
	metadata?: Record<string, unknown>;
}

export interface AgentKernelOutputValidationResult {
	ok: boolean;
	reason?: string | null;
	metadata?: Record<string, unknown>;
}

export interface DecisionPlanningStatus {
	id: string;
	teamId: string;
	projectId: string;
	decisionId: string;
	humanApprovalState?: string | null;
	executionReadiness: DecisionExecutionReadinessStatus | string;
	planningInputsStatus: PlanningInputRequestStatus | string;
	scopeHash: string;
	staleReason?: string | null;
	readyAt?: string | null;
	staleAt?: string | null;
	metadata?: Record<string, unknown>;
	createdAt?: string;
	updatedAt?: string;
}

export interface PlanningInputRequest {
	id: string;
	teamId: string;
	projectId: string;
	decisionId: string;
	projectAgentClassId?: string | null;
	mode: AgentExecutionMode;
	status: PlanningInputRequestStatus | string;
	scopeHash: string;
	prompt?: string | null;
	response?: Record<string, unknown> | null;
	metadata?: Record<string, unknown>;
	requestedAt?: string;
	completedAt?: string | null;
	staleAt?: string | null;
}

export interface DecisionExecutionInputRecord {
	id: string;
	teamId: string;
	projectId: string;
	decisionId: string;
	projectAgentClassId: string;
	mode: AgentExecutionMode;
	status: DecisionExecutionInputStatus | string;
	scopeHash: string;
	input: DecisionExecutionInput;
	acceptedAt?: string | null;
	revisionRequestedAt?: string | null;
	staleAt?: string | null;
	metadata?: Record<string, unknown>;
	createdAt?: string;
	updatedAt?: string;
}

export interface WorkdayCapacityEnvelopeRecord {
	id: string;
	teamId: string;
	projectId: string;
	allocationSetId?: string | null;
	status: WorkdayCapacityEnvelopeStatus | string;
	startedAt?: string | null;
	pausedAt?: string | null;
	completedAt?: string | null;
	envelope: WorkdayCapacityEnvelope;
	modeSplits: Record<string, unknown>;
	caps: Record<string, unknown>;
	reserves: Record<string, unknown>;
	borrowingRules: Record<string, unknown>;
	metadata?: Record<string, unknown>;
	createdAt?: string;
	updatedAt?: string;
}

export interface AgentCapacityPlanWorkUnit {
	id: string;
	decisionExecutionInputId: string;
	decisionId: string;
	projectAgentClassId: string;
	mode: AgentExecutionMode;
	taskId?: string | null;
	agentId?: string | null;
	handlerId?: string | null;
	workDayId?: string | null;
	expectedCredits: number;
	highCredits: number;
	requiredCapabilities: string[];
	dependencies: string[];
	blockers: string[];
	risk: Record<string, unknown>;
	assumptions: string[];
	confidence?: number | null;
	capacityEnvelope: AgentCapacityEnvelope;
	decisionInput: DecisionExecutionInput;
	metadata?: Record<string, unknown>;
}

export interface AgentCapacityPlanRecord {
	id: string;
	teamId: string;
	projectId: string;
	decisionId: string;
	status: DurableAgentCapacityPlanStatus | string;
	scopeHash: string;
	allocationSetId?: string | null;
	workDayId?: string | null;
	expectedCredits: number;
	highCredits: number;
	workUnits: AgentCapacityPlanWorkUnit[];
	capabilityNeeds: string[];
	environmentNeeds: string[];
	reserves: Record<string, unknown>;
	blockers: string[];
	priorityRationale?: string | null;
	review?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
	acceptedAt?: string | null;
	scheduledAt?: string | null;
	supersededAt?: string | null;
	createdAt?: string;
	updatedAt?: string;
}

export interface ProviderAssignmentSynthesisCandidate {
	id?: string;
	teamId: string;
	projectId: string;
	capacityProviderId: string;
	executionProviderId?: string | null;
	projectAgentClassId: string;
	mode: AgentExecutionMode;
	source: ProviderAssignmentSynthesisSource | string;
	sourceId: string;
	synthesisKey: string;
	priority?: number | null;
	readiness?: DecisionPlanningStatus | null;
	capacityEnvelope: AgentCapacityEnvelope;
	decisionInput: DecisionExecutionInput;
	workspaceContext?: Record<string, unknown>;
	explanation?: ProviderAssignmentExplanation | Record<string, unknown>;
	metadata?: Record<string, unknown>;
}

export interface ProviderAssignmentExplanation {
	id?: string;
	teamId: string;
	assignmentId: string;
	source: ProviderAssignmentSynthesisSource | string;
	sourceId?: string | null;
	eligible: boolean;
	reasons: string[];
	gates: Record<string, unknown>;
	allocationPolicyVersion?: string | null;
	grantScope?: string | null;
	createdAt?: string;
	metadata?: Record<string, unknown>;
}

export interface ExecutionCapabilityGateInput {
	grantMatches?: boolean;
	availabilityMatches?: boolean;
	runnerPressureAllows?: boolean;
	budgetAllows?: boolean;
	readinessAllows?: boolean;
	capabilityHandlesCanBeIssued?: boolean;
	metadata?: Record<string, unknown>;
}

export interface ExecutionProviderEligibilityResult {
	eligible: boolean;
	requiredCapabilities: string[];
	preferredCapabilities: string[];
	availableCapabilities: string[];
	aliasCapabilities: string[];
	missingCapabilities: string[];
	reasonCodes: string[];
	gates: {
		grantMatches: boolean;
		availabilityMatches: boolean;
		runnerPressureAllows: boolean;
		budgetAllows: boolean;
		readinessAllows: boolean;
		capabilityHandlesCanBeIssued: boolean;
	};
	metadata?: Record<string, unknown>;
}

export interface BuildExecutionProviderAssignmentExplanationInput {
	source: ProviderAssignmentSynthesisSource | string;
	sourceId?: string | null;
	demand: ExecutionCapabilityDemand;
	supply: ExecutionCapabilitySupply;
	eligibility: ExecutionProviderEligibilityResult;
	allocationPolicyVersion?: string | null;
	grantId?: string | null;
	grantScope?: string | null;
	readinessGate?: Record<string, unknown> | null;
	allocationBudgetGate?: Record<string, unknown> | null;
	capabilityHandleGate?: Record<string, unknown> | null;
	metadata?: Record<string, unknown>;
}

export interface ExecutionProviderVisibilitySummary {
	executionProviderId: string | null;
	executionProviderKind: string | null;
	adapterStatus: string | null;
	externalRef: string | null;
	externalUrl: string | null;
	blockerReason: string | null;
	usage: unknown[];
	artifacts: unknown[];
	requiredCapabilities: string[];
	preferredCapabilities: string[];
	availableCapabilities: string[];
	aliasCapabilities: string[];
	missingCapabilities: string[];
	selectedProvider: string | null;
	selectedExecutionProvider: string | null;
	capabilityEligible: boolean | null;
	reasonCodes: string[];
	metadata: Record<string, unknown>;
}

export type CapacityRuntimeBlockerOwner = 'project' | 'team_admin' | 'provider_operator' | 'system';
export type CapacityRuntimeBlockerSeverity = 'info' | 'warning' | 'danger';

export interface CapacityRuntimeBlockerVm {
	code: string;
	severity: CapacityRuntimeBlockerSeverity;
	title: string;
	message: string;
	owner: CapacityRuntimeBlockerOwner;
	assignmentId?: string | null;
	projectId?: string | null;
	providerId?: string | null;
	nextAction: string;
	evidence: Array<{
		label: string;
		value: string;
	}>;
}

export interface CapacityRuntimeDiagnosticsResponse {
	projectId: string;
	teamId: string;
	generatedAt: string;
	assignments: ProviderAssignment[];
	explanations: ProviderAssignmentExplanation[];
	modeRuns: AgentModeRun[];
	treeDxProxyAudit: Array<Record<string, unknown>>;
	ledgerEntries: Array<CapacityLedgerEntry & { assignmentId?: string | null; modeRunId?: string | null }>;
	fallbackOutputs: Array<Record<string, unknown>>;
	diagnostics: CapacityRuntimeBlockerVm[];
}

export interface CapacitySettlementInvariantViolation {
	code: string;
	message: string;
	severity: 'warning' | 'error';
}

export interface CapacitySettlementInvariantResult {
	ok: boolean;
	status: 'pass' | 'warning' | 'fail';
	violations: CapacitySettlementInvariantViolation[];
}

export interface TreeDxProxyHandle {
	id: string;
	teamId: string;
	projectId: string;
	assignmentId?: string | null;
	repositoryId?: string | null;
	workspaceId?: string | null;
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
	metadata?: Record<string, unknown>;
}

export interface ProviderAssignmentCapabilityHandleBase {
	id: string;
	kind: AgentAssignmentCapabilityHandleKind;
	teamId: string;
	projectId: string;
	assignmentId: string;
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

export interface TreeDxProxyAccessRequest {
	teamId?: string | null;
	projectId: string;
	assignmentId?: string | null;
	repositoryId?: string | null;
	workspaceId?: string | null;
	operation?: string | null;
	path?: string | null;
	token?: string | null;
	now?: Date;
}

export interface TreeDxProxyAccessResult {
	ok: boolean;
	code?: string;
	reason?: string;
	metadata?: Record<string, unknown>;
}

export interface TreeDxProjectProxyAuditRecord {
	id: string;
	teamId: string;
	projectId: string;
	assignmentId?: string | null;
	actorType: 'user' | 'capacity_provider' | string;
	actorId?: string | null;
	method: string;
	path: string;
	handle?: TreeDxProxyHandle | Record<string, unknown> | null;
	resultStatus: string;
	metadata?: Record<string, unknown>;
	createdAt?: string;
}

export interface AgentFallbackOutput {
	id: string;
	teamId: string;
	projectId: string;
	assignmentId?: string | null;
	mode: AgentExecutionMode;
	code: AgentKernelModeFallbackCode | string;
	status: 'draft' | 'emitted' | 'suppressed' | 'duplicate' | 'quota_exceeded' | string;
	output: Record<string, unknown>;
	provenance: Record<string, unknown>;
	quota: Record<string, unknown>;
	metadata?: Record<string, unknown>;
	createdAt?: string;
}

export interface CapacitySettlementSummary {
	id?: string;
	teamId: string;
	projectId?: string | null;
	workDayId?: string | null;
	allocationSetId?: string | null;
	policyVersion?: string | null;
	reservedCredits: number;
	consumedCredits: number;
	releasedCredits: number;
	refundedCredits: number;
	nativeUsage: Record<string, unknown>;
	providerConfidence: 'high' | 'medium' | 'low' | 'blocked' | string;
	warnings: string[];
	metadata?: Record<string, unknown>;
	createdAt?: string;
}

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringList(value: unknown): string[] {
	return Array.isArray(value) ? value.map((entry) => String(entry ?? '').trim()).filter(Boolean) : [];
}

function arrayValue(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function uniqueStrings(values: string[]): string[] {
	return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function numberOrNull(value: unknown): number | null {
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
}

function booleanDefault(value: unknown, fallback: boolean): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

function stringOrNull(value: unknown): string | null {
	if (value === null || value === undefined || value === '') return null;
	return String(value);
}

function firstString(...values: unknown[]): string | null {
	for (const value of values) {
		const normalized = stringOrNull(value);
		if (normalized) return normalized;
	}
	return null;
}

function firstArray(...values: unknown[]): unknown[] {
	for (const value of values) {
		if (Array.isArray(value)) return value;
	}
	return [];
}

function booleanOrNull(value: unknown): boolean | null {
	return typeof value === 'boolean' ? value : null;
}

function pressureAllows(pressure: ExecutionCapabilitySupply['pressure'] | undefined) {
	return pressure !== 'exhausted' && pressure !== 'throttled';
}

function resourceNeedKey(need: ExecutionResourceNeed) {
	return [
		need.kind,
		uniqueStrings(need.operations).join('|'),
		uniqueStrings(need.paths ?? []).join('|'),
		need.required === false ? 'optional' : 'required',
	].join(':');
}

function pushResourceNeed(target: ExecutionResourceNeed[], need: ExecutionResourceNeed) {
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

function handleResourceNeed(handle: ProviderAssignmentCapabilityHandle): ExecutionResourceNeed | null {
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

function preferredCapabilitiesFromAgent(agent: Pick<AgentRuntimeSpec, 'execution' | 'outputs'> | null | undefined): string[] {
	const preferences = agent?.execution.providerProfile?.preferredLanes ?? [];
	return uniqueStrings(preferences.flatMap((entry) => [
		entry.provider,
		entry.providerId,
		entry.laneId,
		entry.model,
		entry.modelClass,
	].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)));
}

function recordStringArray(source: unknown, key: string): string[] {
	return stringList(record(source)[key]);
}

function collectSupplyMetadataCapabilities(...sources: unknown[]) {
	return uniqueStrings(sources.flatMap((source) => [
		...recordStringArray(record(source).metadata, 'capabilities'),
		...recordStringArray(source, 'capabilities'),
	]));
}

function collectSupplyMetadataAliases(...sources: unknown[]) {
	return uniqueStrings(sources.flatMap((source) => [
		...recordStringArray(record(source).metadata, 'capabilityAliases'),
		...recordStringArray(record(source).metadata, 'aliases'),
		...recordStringArray(source, 'capabilityAliases'),
		...recordStringArray(source, 'aliases'),
	]));
}

function stableStringify(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
	const entries = Object.entries(value as Record<string, unknown>)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`);
	return `{${entries.join(',')}}`;
}

export function computeDecisionScopeHash(scope: unknown): string {
	const text = stableStringify(scope ?? {});
	let hash = 5381;
	for (let index = 0; index < text.length; index += 1) {
		hash = ((hash << 5) + hash) ^ text.charCodeAt(index);
	}
	return `scope_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function isDecisionReadyForActing(status?: Pick<DecisionPlanningStatus, 'executionReadiness' | 'planningInputsStatus'> | null): boolean {
	if (!status) return false;
	const readiness = status.executionReadiness;
	const planning = status.planningInputsStatus;
	return (readiness === 'ready' || readiness === 'waived') && (planning === 'complete' || planning === 'waived');
}

export function isPlanningInputOpen(request: Pick<PlanningInputRequest, 'status'>): boolean {
	return request.status === 'requested' || request.status === 'stale';
}

export function isDecisionExecutionInputAccepted(input: Pick<DecisionExecutionInputRecord, 'status'>): boolean {
	return input.status === 'accepted';
}

export function isAgentCapacityPlanAccepted(plan?: Pick<AgentCapacityPlanRecord, 'status'> | null): boolean {
	return Boolean(plan && ['accepted', 'scheduled', 'active'].includes(String(plan.status)));
}

export function normalizeDecisionExecutionEstimate(input: DecisionExecutionInputRecord | DecisionExecutionInput): {
	expectedCredits: number;
	highCredits: number;
	requiredCapabilities: string[];
	dependencies: string[];
	blockers: string[];
	assumptions: string[];
	confidence: number | null;
	environmentNeeds: string[];
	risk: Record<string, unknown>;
} {
	const source = 'input' in input && input.input && 'input' in input.input
		? input.input.input
		: record((input as DecisionExecutionInput).input);
	const metadata = record((input as DecisionExecutionInputRecord).metadata ?? (input as DecisionExecutionInput).metadata);
	const estimate = record(source.estimate ?? metadata.estimate);
	const capabilities = Array.isArray(source.requiredCapabilities)
		? source.requiredCapabilities
		: Array.isArray(metadata.requiredCapabilities)
			? metadata.requiredCapabilities
			: [];
	const dependencies = Array.isArray(source.dependencies) ? source.dependencies : Array.isArray(metadata.dependencies) ? metadata.dependencies : [];
	const blockers = Array.isArray(source.blockers) ? source.blockers : Array.isArray(metadata.blockers) ? metadata.blockers : [];
	const assumptions = Array.isArray(source.assumptions) ? source.assumptions : Array.isArray(metadata.assumptions) ? metadata.assumptions : [];
	const environmentNeeds = Array.isArray(source.environmentNeeds) ? source.environmentNeeds : Array.isArray(metadata.environmentNeeds) ? metadata.environmentNeeds : [];
	const expectedCredits = numberOrNull(estimate.expectedCredits ?? estimate.credits ?? source.expectedCredits ?? metadata.expectedCredits) ?? 1;
	const highCredits = Math.max(expectedCredits, numberOrNull(estimate.highCredits ?? estimate.p90Credits ?? source.highCredits ?? metadata.highCredits) ?? expectedCredits);
	const confidence = numberOrNull(estimate.confidence ?? source.confidence ?? metadata.confidence);
	return {
		expectedCredits,
		highCredits,
		requiredCapabilities: capabilities.map(String).filter(Boolean),
		dependencies: dependencies.map(String).filter(Boolean),
		blockers: blockers.map(String).filter(Boolean),
		assumptions: assumptions.map(String).filter(Boolean),
		confidence,
		environmentNeeds: environmentNeeds.map(String).filter(Boolean),
		risk: record(source.risk ?? metadata.risk),
	};
}

export function buildAgentCapacityPlanDraft(input: {
	id: string;
	teamId: string;
	projectId: string;
	decisionId: string;
	scopeHash: string;
	executionInputs: DecisionExecutionInputRecord[];
	allocationSetId?: string | null;
	workDayId?: string | null;
	status?: DurableAgentCapacityPlanStatus | string;
	metadata?: Record<string, unknown>;
	now?: string;
}): AgentCapacityPlanRecord {
	const timestamp = input.now ?? new Date().toISOString();
	const accepted = input.executionInputs.filter(isDecisionExecutionInputAccepted);
	const workUnits = accepted.map((entry, index): AgentCapacityPlanWorkUnit => {
		const estimate = normalizeDecisionExecutionEstimate(entry);
		const decisionInput = entry.input;
		const capacityEnvelope = {
			...decisionInput.capacity,
			teamId: input.teamId,
			projectId: input.projectId,
			workDayId: decisionInput.capacity?.workDayId ?? input.workDayId ?? null,
			allocationSetId: decisionInput.capacity?.allocationSetId ?? input.allocationSetId ?? null,
			mode: normalizeAgentExecutionMode(decisionInput.mode, 'acting'),
			projectAgentClassId: entry.projectAgentClassId,
			metadata: {
				...(decisionInput.capacity?.metadata ?? {}),
				capacityPlanId: input.id,
				decisionExecutionInputId: entry.id,
			},
		};
		return {
			id: `${input.id}:wu:${index + 1}`,
			decisionExecutionInputId: entry.id,
			decisionId: input.decisionId,
			projectAgentClassId: entry.projectAgentClassId,
			mode: normalizeAgentExecutionMode(entry.mode, 'acting'),
			taskId: decisionInput.taskId ?? null,
			agentId: decisionInput.agentId ?? null,
			handlerId: decisionInput.handlerId ?? null,
			workDayId: capacityEnvelope.workDayId ?? null,
			expectedCredits: estimate.expectedCredits,
			highCredits: estimate.highCredits,
			requiredCapabilities: estimate.requiredCapabilities,
			dependencies: estimate.dependencies,
			blockers: estimate.blockers,
			risk: estimate.risk,
			assumptions: estimate.assumptions,
			confidence: estimate.confidence,
			capacityEnvelope,
			decisionInput: {
				...decisionInput,
				capacity: capacityEnvelope,
				metadata: {
					...(decisionInput.metadata ?? {}),
					capacityPlanId: input.id,
					decisionExecutionInputId: entry.id,
				},
			},
			metadata: entry.metadata ?? {},
		};
	});
	const unique = (values: string[]) => [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
	return {
		id: input.id,
		teamId: input.teamId,
		projectId: input.projectId,
		decisionId: input.decisionId,
		status: input.status ?? 'draft',
		scopeHash: input.scopeHash,
		allocationSetId: input.allocationSetId ?? null,
		workDayId: input.workDayId ?? null,
		expectedCredits: workUnits.reduce((sum, unit) => sum + unit.expectedCredits, 0),
		highCredits: workUnits.reduce((sum, unit) => sum + unit.highCredits, 0),
		workUnits,
		capabilityNeeds: unique(workUnits.flatMap((unit) => unit.requiredCapabilities)),
		environmentNeeds: unique(accepted.flatMap((entry) => normalizeDecisionExecutionEstimate(entry).environmentNeeds)),
		reserves: { highCredits: workUnits.reduce((sum, unit) => sum + unit.highCredits, 0) },
		blockers: unique(workUnits.flatMap((unit) => unit.blockers)),
		priorityRationale: typeof input.metadata?.priorityRationale === 'string' ? input.metadata.priorityRationale : null,
		review: {},
		metadata: input.metadata ?? {},
		acceptedAt: null,
		scheduledAt: null,
		createdAt: timestamp,
		updatedAt: timestamp,
	};
}

export function isProviderAssignmentCandidateEligible(candidate: ProviderAssignmentSynthesisCandidate): boolean {
	if (!candidate.teamId || !candidate.projectId || !candidate.capacityProviderId || !candidate.projectAgentClassId) return false;
	if (candidate.mode === 'acting' && candidate.readiness && !isDecisionReadyForActing(candidate.readiness)) return false;
	return candidate.capacityEnvelope.mode === candidate.mode && candidate.decisionInput.mode === candidate.mode;
}

export function validateTreeDxProxyHandle(handle: TreeDxProxyHandle | null | undefined, expected: { teamId?: string | null; projectId: string; assignmentId?: string | null }): AgentKernelModeFallback | null {
	if (!handle) return null;
	if (!handle.id && !handle.projectId) return null;
	const access = evaluateTreeDxProxyHandleAccess(handle, {
		teamId: expected.teamId ?? null,
		projectId: expected.projectId,
		assignmentId: expected.assignmentId ?? null,
	});
	if (!access.ok) {
		return createAgentKernelModeFallback(
			'assignment_treedx_proxy_scope_invalid',
			access.reason ?? 'TreeDX proxy handle scope does not match the assignment.',
			{ retryable: access.code === 'treedx_proxy_handle_expired', metadata: access.metadata },
		);
	}
	return null;
}

function hasSecretLikeKey(key: string): boolean {
	return /(^|[_-])(plaintext|token|passphrase|password|private[_-]?key|deploy[_-]?key|raw[_-]?secret|unencrypted|credential)([_-]|$)/iu.test(key)
		|| ['secretValue', 'rawSecret', 'githubInstallationToken', 'deployKey', 'privateKey'].includes(key);
}

function findSecretLikePath(value: unknown, path = '$'): string | null {
	if (Array.isArray(value)) {
		for (let index = 0; index < value.length; index += 1) {
			const found = findSecretLikePath(value[index], `${path}[${index}]`);
			if (found) return found;
		}
		return null;
	}
	if (!isRecord(value)) return null;
	for (const [key, entry] of Object.entries(value)) {
		const nextPath = `${path}.${key}`;
		if (hasSecretLikeKey(key)) return nextPath;
		const found = findSecretLikePath(entry, nextPath);
		if (found) return found;
	}
	return null;
}

function normalizeWorkspaceAccessMode(value: unknown): AgentAssignmentWorkspaceAccessMode {
	return AGENT_ASSIGNMENT_WORKSPACE_ACCESS_MODES.includes(value as AgentAssignmentWorkspaceAccessMode)
		? value as AgentAssignmentWorkspaceAccessMode
		: 'context_only';
}

function capabilityHandleArrays(handles: ProviderAssignmentCapabilityHandles | Record<string, unknown> | null | undefined): ProviderAssignmentCapabilityHandle[] {
	const source = record(handles);
	return [
		...arrayValue(source.repository),
		...arrayValue(source.treeDx),
		...arrayValue(source.workflowOperations),
		...arrayValue(source.secrets),
	].filter(isRecord) as ProviderAssignmentCapabilityHandle[];
}

export function redactedProviderAssignmentCapabilityHandles(
	handles: ProviderAssignmentCapabilityHandles | Record<string, unknown> | null | undefined,
): ProviderAssignmentCapabilityHandles {
	const source = record(handles);
	const redact = (handle: unknown) => {
		const next = { ...record(handle) };
		for (const key of Object.keys(next)) {
			if (hasSecretLikeKey(key)) delete next[key];
		}
		return next as ProviderAssignmentCapabilityHandle;
	};
	return {
		workspaceAccessMode: normalizeWorkspaceAccessMode(source.workspaceAccessMode),
		repository: arrayValue(source.repository).map(redact) as ProviderRepositoryAccessHandle[],
		treeDx: arrayValue(source.treeDx).map(redact) as ProviderTreeDxWorkspaceHandle[],
		workflowOperations: arrayValue(source.workflowOperations).map(redact) as ProviderWorkflowOperationHandle[],
		secrets: arrayValue(source.secrets).map(redact) as ProviderSecretUseHandle[],
		metadata: record(source.metadata),
	};
}

export function providerAssignmentCapabilityHandlesContainSecretMaterial(value: unknown): boolean {
	return Boolean(findSecretLikePath(value));
}

export function validateProviderAssignmentCapabilityHandles(input: {
	assignment: Pick<ProviderAssignment, 'id' | 'teamId' | 'projectId' | 'mode' | 'metadata' | 'decisionInput' | 'capacityEnvelope' | 'synthesizedFrom'> & {
		capabilityHandles?: ProviderAssignmentCapabilityHandles | Record<string, unknown> | null;
	};
	capabilityHandles?: ProviderAssignmentCapabilityHandles | Record<string, unknown> | null;
	decisionInput?: DecisionExecutionInput | null;
	capacityEnvelope?: AgentCapacityEnvelope | null;
	now?: Date;
}): AgentKernelModeFallback | null {
	const assignment = input.assignment;
	const handles = input.capabilityHandles ?? assignment.capabilityHandles ?? null;
	if (!handles) return null;
	const leakedPath = findSecretLikePath(handles);
	if (leakedPath) {
		return createAgentKernelModeFallback(
			'assignment_capability_handle_secret_material',
			`Assignment ${assignment.id} capability handles include secret-like material at ${leakedPath}.`,
			{ retryable: false, metadata: { path: leakedPath } },
		);
	}
	const workspaceAccessMode = normalizeWorkspaceAccessMode(record(handles).workspaceAccessMode);
	const allHandles = capabilityHandleArrays(handles);
	for (const handle of allHandles) {
		if (!handle.id || !handle.kind) {
			return createAgentKernelModeFallback(
				'assignment_capability_handle_invalid',
				`Assignment ${assignment.id} has an invalid capability handle.`,
				{ retryable: false },
			);
		}
		if ((handle.teamId && handle.teamId !== assignment.teamId) || (handle.projectId && handle.projectId !== assignment.projectId) || (handle.assignmentId && handle.assignmentId !== assignment.id)) {
			return createAgentKernelModeFallback(
				'assignment_capability_handle_invalid',
				`Assignment ${assignment.id} capability handle ${handle.id} is scoped to a different assignment.`,
				{ retryable: false, metadata: { handleId: handle.id, kind: handle.kind } },
			);
		}
		if (handle.expiresAt && Date.parse(handle.expiresAt) <= (input.now ?? new Date()).getTime()) {
			return createAgentKernelModeFallback(
				'assignment_capability_handle_invalid',
				`Assignment ${assignment.id} capability handle ${handle.id} has expired.`,
				{ retryable: true, metadata: { handleId: handle.id, kind: handle.kind } },
			);
		}
		const operations = stringList(handle.operations);
		const writeCapable = operations.some((operation) => ['write', 'commit', 'push', 'release', 'dispatch_workflow', 'files:write', 'git:commit'].includes(operation));
		if (writeCapable && assignment.mode !== 'acting') {
			return createAgentKernelModeFallback(
				'assignment_capability_handle_write_not_ready',
				`Assignment ${assignment.id} cannot receive write-capable capability handles outside acting mode.`,
				{ retryable: false, metadata: { handleId: handle.id, kind: handle.kind, operations } },
			);
		}
		if (writeCapable && !hasAcceptedCapacityPlanProvenance({
			assignment,
			decisionInput: input.decisionInput ?? null,
			capacityEnvelope: input.capacityEnvelope ?? null,
		})) {
			return createAgentKernelModeFallback(
				'assignment_capability_handle_write_not_ready',
				`Assignment ${assignment.id} write-capable capability handles require accepted capacity-plan provenance.`,
				{ retryable: true, metadata: { handleId: handle.id, kind: handle.kind } },
			);
		}
		if (workspaceAccessMode === 'context_only' && writeCapable) {
			return createAgentKernelModeFallback(
				'assignment_capability_handle_workspace_denied',
				`Assignment ${assignment.id} context-only workspace mode cannot receive write-capable handles.`,
				{ retryable: false, metadata: { handleId: handle.id, kind: handle.kind } },
			);
		}
		if (handle.kind === 'workflow_operation') {
			const workflow = handle as ProviderWorkflowOperationHandle;
			if (!workflow.operationId || !workflow.repository || !workflow.workflowFile) {
				return createAgentKernelModeFallback(
					'assignment_workflow_operation_denied',
					`Assignment ${assignment.id} workflow operation handle ${handle.id} is missing operation scope.`,
					{ retryable: false, metadata: { handleId: handle.id } },
				);
			}
			if (!operations.includes('dispatch_workflow')) {
				return createAgentKernelModeFallback(
					'assignment_workflow_operation_denied',
					`Assignment ${assignment.id} workflow operation handle ${handle.id} is not dispatch-capable.`,
					{ retryable: false, metadata: { handleId: handle.id } },
				);
			}
		}
	}
	return null;
}

function globLikePathMatches(pattern: string, candidate: string): boolean {
	const normalizedPattern = pattern.replace(/^\/+/, '');
	const normalizedCandidate = candidate.replace(/^\/+/, '');
	if (!normalizedPattern || normalizedPattern === '**' || normalizedPattern === '*') return true;
	if (normalizedPattern.endsWith('/**')) {
		const prefix = normalizedPattern.slice(0, -3);
		return normalizedCandidate === prefix || normalizedCandidate.startsWith(`${prefix}/`);
	}
	if (normalizedPattern.endsWith('*')) {
		return normalizedCandidate.startsWith(normalizedPattern.slice(0, -1));
	}
	return normalizedCandidate === normalizedPattern || normalizedCandidate.startsWith(`${normalizedPattern}/`);
}

export function evaluateTreeDxProxyHandleAccess(handle: TreeDxProxyHandle | null | undefined, request: TreeDxProxyAccessRequest): TreeDxProxyAccessResult {
	if (!handle?.id) return { ok: false, code: 'treedx_proxy_handle_missing', reason: 'TreeDX proxy handle is required.' };
	if (handle.status === 'revoked' || handle.revokedAt) return { ok: false, code: 'treedx_proxy_handle_revoked', reason: 'TreeDX proxy handle has been revoked.' };
	if (handle.status === 'expired') return { ok: false, code: 'treedx_proxy_handle_expired', reason: 'TreeDX proxy handle has expired.' };
	if (handle.projectId !== request.projectId || (request.teamId && handle.teamId !== request.teamId)) {
		return { ok: false, code: 'treedx_proxy_scope_mismatch', reason: 'TreeDX proxy handle scope does not match the project.', metadata: { projectId: request.projectId, handleProjectId: handle.projectId } };
	}
	if (request.assignmentId && handle.assignmentId && handle.assignmentId !== request.assignmentId) {
		return { ok: false, code: 'treedx_proxy_assignment_mismatch', reason: 'TreeDX proxy handle is bound to a different assignment.', metadata: { assignmentId: request.assignmentId, handleAssignmentId: handle.assignmentId } };
	}
	if (request.repositoryId && handle.repositoryId && handle.repositoryId !== request.repositoryId) {
		return { ok: false, code: 'treedx_proxy_repository_mismatch', reason: 'TreeDX proxy handle is bound to a different repository.', metadata: { repositoryId: request.repositoryId, handleRepositoryId: handle.repositoryId } };
	}
	if (request.workspaceId && handle.workspaceId && handle.workspaceId !== request.workspaceId) {
		return { ok: false, code: 'treedx_proxy_workspace_mismatch', reason: 'TreeDX proxy handle is bound to a different workspace.', metadata: { workspaceId: request.workspaceId, handleWorkspaceId: handle.workspaceId } };
	}
	if (handle.expiresAt && Date.parse(handle.expiresAt) <= (request.now ?? new Date()).getTime()) {
		return { ok: false, code: 'treedx_proxy_handle_expired', reason: 'TreeDX proxy handle has expired.' };
	}
	if (handle.token && request.token && handle.token !== request.token) {
		return { ok: false, code: 'treedx_proxy_token_mismatch', reason: 'TreeDX proxy handle token does not match.' };
	}
	const operation = request.operation ? String(request.operation) : null;
	const allowedOperations = Array.isArray(handle.allowedOperations) ? handle.allowedOperations.map(String) : [];
	if (operation && allowedOperations.length && !allowedOperations.includes(operation) && !allowedOperations.includes('*')) {
		return { ok: false, code: 'treedx_proxy_operation_denied', reason: 'TreeDX proxy handle does not allow this operation.', metadata: { operation, allowedOperations } };
	}
	const path = request.path ? String(request.path).replace(/^\/+/, '') : null;
	const allowedPaths = Array.isArray(handle.allowedPaths) ? handle.allowedPaths.map(String).filter(Boolean) : [];
	if (path && allowedPaths.length && !allowedPaths.some((pattern) => globLikePathMatches(pattern, path))) {
		return { ok: false, code: 'treedx_proxy_path_denied', reason: 'TreeDX proxy handle does not allow this path.', metadata: { path, allowedPaths } };
	}
	return { ok: true };
}

export function compileExecutionCapabilityDemand(input: {
	agent?: Pick<AgentRuntimeSpec, 'execution' | 'outputs'> | null;
	projectAgentClass?: Pick<ProjectAgentClass, 'requiredCapabilities'> | null;
	decisionInput?: DecisionExecutionInput | Record<string, unknown> | null;
	capacityEnvelope?: AgentCapacityEnvelope | Record<string, unknown> | null;
	workUnit?: Pick<AgentCapacityPlanWorkUnit, 'requiredCapabilities' | 'metadata'> | null;
	assignment?: Pick<ProviderAssignment, 'mode' | 'metadata' | 'workspaceContext' | 'capabilityHandles' | 'allowedOutputs'> | null;
	workPackage?: AgentWorkPackage | null;
	mode?: AgentExecutionMode | string | null;
	resourceNeeds?: ExecutionResourceNeed[];
	metadata?: Record<string, unknown>;
}): ExecutionCapabilityDemand {
	const agentProfile = input.agent?.execution.providerProfile;
	const decisionInput = record(input.decisionInput);
	const decisionPayload = record(decisionInput.input);
	const decisionMetadata = record(decisionInput.metadata);
	const capacityMetadata = record(record(input.capacityEnvelope).metadata);
	const workUnitMetadata = record(input.workUnit?.metadata);
	const assignmentMetadata = record(input.assignment?.metadata);
	const allowedOutputs = record(input.assignment?.allowedOutputs);
	const allowedPaths = uniqueStrings([
		...stringList(input.agent?.execution.allowedPaths),
		...stringList(input.workPackage?.constraints.allowedPaths),
	]);
	const forbiddenPaths = uniqueStrings([
		...stringList(input.agent?.execution.forbiddenPaths),
		...stringList(input.workPackage?.constraints.forbiddenPaths),
	]);
	const required = uniqueStrings([
		...stringList(agentProfile?.requiredCapabilities),
		...stringList(input.projectAgentClass?.requiredCapabilities),
		...stringList(decisionPayload.requiredCapabilities),
		...stringList(decisionMetadata.requiredCapabilities),
		...stringList(capacityMetadata.requiredCapabilities),
		...stringList(input.workUnit?.requiredCapabilities),
		...stringList(workUnitMetadata.requiredCapabilities),
		...stringList(assignmentMetadata.requiredCapabilities),
		...stringList(input.workPackage?.constraints.requiredCapabilities),
	]);
	const preferred = preferredCapabilitiesFromAgent(input.agent);
	const outputTypes = uniqueStrings([
		...stringList(input.agent?.outputs.messageTypes),
		...stringList(input.agent?.outputs.modelMutations),
		...stringList(allowedOutputs.types),
		...(input.workPackage?.expectedOutputs ?? []).map((entry) => entry.type).filter(Boolean),
	]);
	const resourceNeeds: ExecutionResourceNeed[] = [];
	for (const need of input.resourceNeeds ?? []) {
		pushResourceNeed(resourceNeeds, need);
	}
	for (const handle of capabilityHandleArrays(input.assignment?.capabilityHandles)) {
		const need = handleResourceNeed(handle);
		if (need) pushResourceNeed(resourceNeeds, need);
	}
	const workspace = record(input.assignment?.workspaceContext);
	if (workspace.externalIssue || workspace.externalIssueKey) {
		pushResourceNeed(resourceNeeds, {
			kind: 'external_issue',
			operations: ['read'],
			required: true,
			metadata: {
				externalRef: String(workspace.externalIssueKey ?? workspace.externalIssue),
			},
		});
	}
	if (workspace.externalJob || workspace.externalJobId) {
		pushResourceNeed(resourceNeeds, {
			kind: 'external_job',
			operations: ['read'],
			required: true,
			metadata: {
				externalRef: String(workspace.externalJobId ?? workspace.externalJob),
			},
		});
	}
	return {
		required,
		preferred,
		mode: normalizeAgentExecutionMode(input.mode ?? input.assignment?.mode ?? input.workPackage?.constraints.mode ?? input.capacityEnvelope?.mode),
		resourceNeeds,
		outputTypes,
		metadata: {
			...(input.metadata ?? {}),
			allowedPaths,
			forbiddenPaths,
			providerProfile: agentProfile ?? null,
		},
	};
}

export function compileExecutionCapabilitySupply(input: {
	capacityProviderId: string;
	executionProviderId?: string | null;
	kind?: string | null;
	descriptor?: ExecutionProviderDescriptor | null;
	executionProvider?: ExecutionProvider | null;
	availabilitySession?: ProviderAvailabilitySession | null;
	providerCapabilities?: string[] | unknown[] | null;
	checkInCapabilities?: string[] | unknown[] | null;
	grants?: CapacityGrant[];
	pressure?: ExecutionCapabilitySupply['pressure'];
	maxConcurrentAssignments?: number | null;
	metadata?: Record<string, unknown>;
}): ExecutionCapabilitySupply {
	const executionProvider = input.executionProvider ?? null;
	const availability = input.availabilitySession ?? null;
	const observation = record(executionProvider?.latestObservation);
	const config = record(executionProvider?.config);
	const activeGrants = (input.grants ?? []).filter((grant) => grant.state === 'active');
	const pressure = input.pressure
		?? (typeof record(availability?.runnerPressure).pressure === 'string'
			? record(availability?.runnerPressure).pressure as ExecutionCapabilitySupply['pressure']
			: undefined)
		?? (observation.throttleState === 'exhausted' || observation.throttleState === 'throttled'
			? observation.throttleState as ExecutionCapabilitySupply['pressure']
			: undefined)
		?? 'normal';
	return {
		capacityProviderId: input.capacityProviderId,
		executionProviderId: input.executionProviderId ?? executionProvider?.id ?? input.descriptor?.id ?? input.capacityProviderId,
		kind: input.kind ?? input.descriptor?.kind ?? executionProvider?.kind ?? 'local_process',
		capabilities: uniqueStrings([
			...stringList(input.descriptor?.capabilities),
			...(executionProvider?.kind ? [executionProvider.kind] : []),
			...collectSupplyMetadataCapabilities(executionProvider),
			...stringList(availability?.capabilities),
			...stringList(input.providerCapabilities),
			...stringList(input.checkInCapabilities),
		]),
		aliases: uniqueStrings([
			...stringList(input.descriptor?.capabilityAliases),
			...collectSupplyMetadataAliases(executionProvider),
		]),
		grants: uniqueStrings([
			...activeGrants.map((grant) => grant.id),
			...stringList(config.grants),
		]),
		availability: availability ? {
			sessionId: availability.id,
			status: availability.status,
			checkedInAt: availability.checkedInAt,
		} : undefined,
		pressure,
		maxConcurrentAssignments: input.descriptor?.maxConcurrentAssignments
			?? executionProvider?.maxConcurrentWorkers
			?? input.maxConcurrentAssignments
			?? 1,
		nativeUnit: input.descriptor?.nativeUnit ?? executionProvider?.nativeUnit ?? 'assignment',
		quotaVisibility: input.descriptor?.quotaVisibility ?? executionProvider?.quotaVisibility ?? 'opaque',
		metadata: {
			...(input.metadata ?? {}),
			activeGrantScopes: activeGrants.map((grant) => grant.grantScope),
		},
	};
}

export function evaluateExecutionProviderEligibility(input: {
	demand: ExecutionCapabilityDemand;
	supply: ExecutionCapabilitySupply;
	gates?: ExecutionCapabilityGateInput;
}): ExecutionProviderEligibilityResult {
	const requiredCapabilities = uniqueStrings(input.demand.required);
	const preferredCapabilities = uniqueStrings(input.demand.preferred ?? []);
	const availableCapabilities = uniqueStrings(input.supply.capabilities);
	const aliasCapabilities = uniqueStrings(input.supply.aliases ?? []);
	const covered = new Set([...availableCapabilities, ...aliasCapabilities]);
	const missingCapabilities = requiredCapabilities.filter((capability) => !covered.has(capability));
	const gates = {
		grantMatches: booleanDefault(input.gates?.grantMatches, true),
		availabilityMatches: booleanDefault(input.gates?.availabilityMatches, true),
		runnerPressureAllows: booleanDefault(input.gates?.runnerPressureAllows, pressureAllows(input.supply.pressure)),
		budgetAllows: booleanDefault(input.gates?.budgetAllows, true),
		readinessAllows: booleanDefault(input.gates?.readinessAllows, true),
		capabilityHandlesCanBeIssued: booleanDefault(input.gates?.capabilityHandlesCanBeIssued, true),
	};
	const reasonCodes = [
		...missingCapabilities.map((capability) => `missing_capability:${capability}`),
		...(gates.grantMatches ? [] : ['grant_mismatch']),
		...(gates.availabilityMatches ? [] : ['availability_mismatch']),
		...(gates.runnerPressureAllows ? [] : ['runner_pressure_blocked']),
		...(gates.budgetAllows ? [] : ['budget_blocked']),
		...(gates.readinessAllows ? [] : ['readiness_blocked']),
		...(gates.capabilityHandlesCanBeIssued ? [] : ['capability_handle_blocked']),
	];
	return {
		eligible: missingCapabilities.length === 0 && Object.values(gates).every(Boolean),
		requiredCapabilities,
		preferredCapabilities,
		availableCapabilities,
		aliasCapabilities,
		missingCapabilities,
		reasonCodes,
		gates,
		metadata: input.gates?.metadata,
	};
}

export function buildProviderAssignmentExplanation(input: {
	source: ProviderAssignmentSynthesisSource | string;
	sourceId?: string | null;
	eligible: boolean;
	reasons?: string[];
	gates?: Record<string, unknown>;
	allocationPolicyVersion?: string | null;
	grantScope?: string | null;
	metadata?: Record<string, unknown>;
}): ProviderAssignmentExplanation {
	return {
		teamId: '',
		assignmentId: '',
		source: input.source,
		sourceId: input.sourceId ?? null,
		eligible: input.eligible,
		reasons: input.reasons ?? [],
		gates: input.gates ?? {},
		allocationPolicyVersion: input.allocationPolicyVersion ?? null,
		grantScope: input.grantScope ?? null,
		metadata: input.metadata ?? {},
	};
}

export function buildExecutionProviderAssignmentExplanation(
	input: BuildExecutionProviderAssignmentExplanationInput,
): ProviderAssignmentExplanation {
	return buildProviderAssignmentExplanation({
		source: input.source,
		sourceId: input.sourceId,
		eligible: input.eligibility.eligible,
		reasons: input.eligibility.reasonCodes,
		allocationPolicyVersion: input.allocationPolicyVersion ?? null,
		grantScope: input.grantScope ?? null,
		gates: {
			requiredCapabilities: input.eligibility.requiredCapabilities,
			preferredCapabilities: input.eligibility.preferredCapabilities,
			availableCapabilities: input.eligibility.availableCapabilities,
			aliasCapabilities: input.eligibility.aliasCapabilities,
			missingCapabilities: input.eligibility.missingCapabilities,
			selectedProvider: input.supply.capacityProviderId,
			selectedExecutionProvider: input.supply.executionProviderId,
			executionProviderKind: input.supply.kind,
			grantId: input.grantId ?? null,
			grantScope: input.grantScope ?? null,
			readinessGate: input.readinessGate ?? null,
			allocationBudgetGate: input.allocationBudgetGate ?? null,
			capabilityHandleGate: input.capabilityHandleGate ?? null,
			demand: input.demand,
			supply: input.supply,
			eligibility: input.eligibility,
		},
		metadata: input.metadata,
	});
}

function visibilityGateRecord(input: {
	assignment?: Record<string, unknown> | null;
	explanation?: Record<string, unknown> | null;
}) {
	const assignment = record(input.assignment);
	const explicitExplanation = record(input.explanation);
	const assignmentExplanation = record(assignment.explanation);
	const assignmentMetadata = record(assignment.metadata);
	const eligibility = record(assignmentMetadata.eligibility);
	const explicitGates = record(explicitExplanation.gates);
	const assignmentGates = record(assignmentExplanation.gates);
	if (Object.keys(explicitGates).length > 0) return explicitGates;
	if (Object.keys(assignmentGates).length > 0) return assignmentGates;
	return record(eligibility.gates);
}

function visibilityReasonCodes(input: {
	assignment?: Record<string, unknown> | null;
	explanation?: Record<string, unknown> | null;
	gates: Record<string, unknown>;
}) {
	const eligibility = record(input.gates.eligibility);
	const explicitExplanation = record(input.explanation);
	const assignmentExplanation = record(record(input.assignment).explanation);
	return uniqueStrings([
		...stringList(eligibility.reasonCodes),
		...stringList(explicitExplanation.reasons),
		...stringList(assignmentExplanation.reasons),
	]);
}

function visibilityCapabilityEligible(input: {
	assignment?: Record<string, unknown> | null;
	explanation?: Record<string, unknown> | null;
	gates: Record<string, unknown>;
}) {
	const eligibility = record(input.gates.eligibility);
	return booleanOrNull(eligibility.eligible)
		?? booleanOrNull(record(input.explanation).eligible)
		?? booleanOrNull(record(record(input.assignment).explanation).eligible);
}

export function summarizeExecutionProviderVisibility(input: {
	assignment?: Record<string, unknown> | null;
	modeRun?: Record<string, unknown> | null;
	explanation?: Record<string, unknown> | null;
}): ExecutionProviderVisibilitySummary {
	const assignment = record(input.assignment);
	const modeRun = record(input.modeRun);
	const explanation = record(input.explanation);
	const lifecycleOutput = record(assignment.lifecycleOutput);
	const lifecycleMetadata = record(lifecycleOutput.metadata);
	const modeOutputs = record(modeRun.outputs);
	const modeOutputMetadata = record(modeOutputs.metadata);
	const modeMetadata = record(modeRun.metadata);
	const traceRefs = record(modeRun.traceRefs);
	const gates = visibilityGateRecord({ assignment, explanation });
	const supply = record(gates.supply);
	const capabilitySupply = record(gates.capabilitySupply);
	const eligibility = record(gates.eligibility);
	const selectedExecutionProvider = firstString(
		gates.selectedExecutionProvider,
		supply.executionProviderId,
		capabilitySupply.executionProviderId,
		modeRun.executionProviderId,
		assignment.executionProviderId,
	);
	const executionProviderKind = firstString(
		gates.executionProviderKind,
		supply.kind,
		capabilitySupply.kind,
		assignment.executionProviderKind,
		record(assignment.metadata).executionProviderKind,
		modeOutputMetadata.provider,
		modeMetadata.provider,
		lifecycleMetadata.provider,
	);

	return {
		executionProviderId: firstString(
			modeRun.executionProviderId,
			assignment.executionProviderId,
			selectedExecutionProvider,
		),
		executionProviderKind,
		adapterStatus: firstString(
			modeOutputs.status,
			modeOutputMetadata.executionStatus,
			modeMetadata.executionStatus,
			lifecycleMetadata.executionStatus,
			lifecycleOutput.status,
			assignment.status,
		),
		externalRef: firstString(
			modeOutputs.externalRef,
			traceRefs.externalRef,
			lifecycleOutput.externalRef,
			lifecycleMetadata.externalRef,
		),
		externalUrl: firstString(
			modeOutputs.externalUrl,
			traceRefs.externalUrl,
			lifecycleOutput.externalUrl,
			lifecycleMetadata.externalUrl,
		),
		blockerReason: firstString(
			modeRun.fallbackReason,
			modeOutputs.blockerReason,
			modeOutputMetadata.blockerReason,
			lifecycleOutput.blockerReason,
			lifecycleMetadata.blockerReason,
			assignment.lifecycleReason,
			assignment.lifecycleCode,
		),
		usage: firstArray(
			modeOutputs.usage,
			record(record(modeRun.usageActual).nativeUsage).executionUsage,
			record(modeRun.usageActual).executionUsage,
			lifecycleOutput.usage,
			lifecycleMetadata.usage,
		),
		artifacts: firstArray(
			modeOutputs.artifacts,
			lifecycleOutput.artifacts,
			lifecycleMetadata.artifacts,
		),
		requiredCapabilities: uniqueStrings([
			...stringList(gates.requiredCapabilities),
			...stringList(record(eligibility).requiredCapabilities),
		]),
		preferredCapabilities: uniqueStrings([
			...stringList(gates.preferredCapabilities),
			...stringList(record(eligibility).preferredCapabilities),
		]),
		availableCapabilities: uniqueStrings([
			...stringList(gates.availableCapabilities),
			...stringList(record(eligibility).availableCapabilities),
			...stringList(supply.capabilities),
			...stringList(capabilitySupply.capabilities),
		]),
		aliasCapabilities: uniqueStrings([
			...stringList(gates.aliasCapabilities),
			...stringList(record(eligibility).aliasCapabilities),
			...stringList(supply.aliases),
			...stringList(capabilitySupply.aliases),
		]),
		missingCapabilities: uniqueStrings([
			...stringList(gates.missingCapabilities),
			...stringList(record(eligibility).missingCapabilities),
		]),
		selectedProvider: firstString(
			gates.selectedProvider,
			supply.capacityProviderId,
			capabilitySupply.capacityProviderId,
			assignment.capacityProviderId,
			assignment.providerId,
		),
		selectedExecutionProvider,
		capabilityEligible: visibilityCapabilityEligible({ assignment, explanation, gates }),
		reasonCodes: visibilityReasonCodes({ assignment, explanation, gates }),
		metadata: {
			sources: {
				assignment: Object.keys(assignment).length > 0,
				modeRun: Object.keys(modeRun).length > 0,
				explanation: Object.keys(explanation).length > 0,
			},
		},
	};
}

export function decorateExecutionProviderVisibility<T extends Record<string, unknown>>(
	recordInput: T,
	options: {
		explanation?: Record<string, unknown> | null;
		modeRun?: Record<string, unknown> | null;
	} = {},
): T & { executionVisibility: ExecutionProviderVisibilitySummary } {
	return {
		...recordInput,
		executionVisibility: summarizeExecutionProviderVisibility({
			assignment: options.modeRun ? null : recordInput,
			modeRun: options.modeRun ?? null,
			explanation: options.explanation ?? record(recordInput.explanation),
		}),
	};
}

export function evaluateFallbackQuota(input: { existingCount?: number | null; quota?: number | null }): AgentKernelModeFallback | null {
	const quota = Number(input.quota);
	if (!Number.isFinite(quota) || quota < 0) return null;
	const existing = Number(input.existingCount ?? 0);
	if (existing < quota) return null;
	return createAgentKernelModeFallback(
		'assignment_fallback_quota_exceeded',
		'Fallback output quota is exhausted for this project scope.',
		{ retryable: true, metadata: { quota, existingCount: existing } },
	);
}

export function deriveAllocationSetFromCapacityGrants(input: {
	id: string;
	teamId: string;
	version?: string;
	status?: AllocationSetStatus | string;
	grants: CapacityGrant[];
	createdById?: string | null;
	now?: string;
	metadata?: Record<string, unknown>;
}): AllocationSet {
	const timestamp = input.now ?? new Date().toISOString();
	return {
		id: input.id,
		teamId: input.teamId,
		version: input.version ?? timestamp,
		status: input.status ?? 'draft',
		effectiveFrom: null,
		effectiveUntil: null,
		policy: {
			source: 'capacity_grants',
			grantCount: input.grants.length,
		},
		slices: input.grants.map((grant) => ({
			projectId: grant.projectId,
			capacityProviderId: grant.capacityProviderId,
			laneId: grant.laneId,
			environment: grant.environment,
			priorityWeight: grant.priorityWeight,
			overflowPolicy: grant.overflowPolicy,
			percent: grant.portfolioAllocationPercent ?? null,
			dailyCreditLimit: grant.dailyCreditLimit,
			monthlyCreditLimit: grant.monthlyCreditLimit,
			metadata: grant.metadata ?? {},
		})),
		createdById: input.createdById ?? null,
		activatedAt: null,
		supersededById: null,
		metadata: input.metadata ?? {},
		createdAt: timestamp,
		updatedAt: timestamp,
	};
}

export function deriveProviderAvailabilitySession(input: {
	id: string;
	provider: CapacityProvider;
	registrationId?: string | null;
	environment?: string | null;
	executionProviders?: ExecutionProvider[];
	grants?: CapacityGrant[];
	runnerPressure?: Record<string, unknown>;
	constraints?: Record<string, unknown>;
	now?: string;
	metadata?: Record<string, unknown>;
}): ProviderAvailabilitySession {
	const timestamp = input.now ?? new Date().toISOString();
	return {
		id: input.id,
		teamId: input.provider.teamId ?? input.provider.ownerTeamId ?? '',
		capacityProviderId: input.provider.id,
		registrationId: input.registrationId ?? null,
		environment: input.environment ?? null,
		status: input.provider.status === 'draining' ? 'draining' : 'open',
		checkedInAt: timestamp,
		availableFrom: timestamp,
		availableUntil: null,
		executionProviders: input.executionProviders ?? [],
		capabilities: Array.isArray(input.provider.capabilities) ? input.provider.capabilities.map(String) : [],
		grants: input.grants ?? [],
		nativeLimits: record(input.provider.metadata?.nativeLimits),
		runnerPressure: input.runnerPressure ?? record(input.provider.metadata?.lastHealth),
		constraints: input.constraints ?? {},
		metadata: input.metadata ?? {},
		createdAt: timestamp,
		updatedAt: timestamp,
		closedAt: null,
	};
}

export function deriveAgentCapacityPlanFromCapacityPlan(plan: LegacyCapacityPlan | Record<string, unknown>): AgentCapacityPlan {
	const raw = record(plan);
	const project = record(raw.project);
	const capacity = record(raw.capacity ?? raw.summary);
	const providers = Array.isArray(raw.providers) ? raw.providers : [];
	return {
		teamId: String(raw.teamId ?? project.teamId ?? ''),
		projectId: String(raw.projectId ?? project.id ?? ''),
		environment: String(raw.environment ?? 'staging'),
		allocationSetId: typeof raw.allocationSetId === 'string' ? raw.allocationSetId : null,
		workday: {
			teamId: String(raw.teamId ?? project.teamId ?? ''),
			projectId: String(raw.projectId ?? project.id ?? ''),
			workDayId: typeof raw.workDayId === 'string' ? raw.workDayId : null,
			environment: String(raw.environment ?? 'staging'),
			availableCredits: numberOrNull(capacity.availableCredits),
			reservedCredits: numberOrNull(capacity.reservedCredits),
			consumedCredits: numberOrNull(capacity.consumedCredits),
			metadata: capacity,
		},
		assignableProviders: providers.map((provider) => {
			const entry = record(provider);
			return {
				capacityProviderId: String(entry.id ?? entry.capacityProviderId ?? ''),
				executionProviderId: typeof entry.executionProviderId === 'string' ? entry.executionProviderId : null,
				laneId: typeof entry.laneId === 'string' ? entry.laneId : null,
				availableCredits: numberOrNull(entry.availableCredits),
				reasons: Array.isArray(entry.reasons) ? entry.reasons.map(String) : [],
				metadata: entry,
			};
		}).filter((provider) => provider.capacityProviderId),
		legacyPlan: plan,
		metadata: {
			source: 'legacy_capacity_plan',
		},
	};
}

export function deriveAgentCapacityEnvelopeFromReservation(input: {
	reservation: CapacityReservation;
	mode: AgentExecutionMode;
	projectAgentClassId?: string | null;
	allocationSetId?: string | null;
	environment?: string | null;
	limits?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
}): AgentCapacityEnvelope {
	const reservation = input.reservation;
	return {
		teamId: reservation.teamId,
		projectId: reservation.projectId,
		workDayId: reservation.workDayId,
		environment: input.environment ?? null,
		allocationSetId: input.allocationSetId ?? null,
		mode: input.mode,
		projectAgentClassId: input.projectAgentClassId ?? null,
		capacityProviderId: reservation.capacityProviderId,
		executionProviderId: reservation.executionProviderId ?? null,
		laneId: reservation.laneId,
		reservationId: reservation.id,
		availableCredits: null,
		reservedCredits: reservation.reservedCredits,
		consumedCredits: reservation.consumedCredits,
		nativeUnit: reservation.nativeUnit ?? null,
		reservedNativeAmount: reservation.reservedNativeAmount ?? null,
		limits: input.limits ?? {},
		metadata: {
			...(reservation.metadata ?? {}),
			...(input.metadata ?? {}),
		},
	};
}

export function deriveModeRunUsageSettlement(actual: TaskUsageActual): AgentModeRunUsageSettlement {
	return {
		taskUsageActualId: actual.id,
		capacityLedgerEntryId: typeof actual.metadata?.capacityLedgerEntryId === 'string' ? actual.metadata.capacityLedgerEntryId : null,
		actualCredits: actual.actualCredits,
		actualUsd: actual.actualUsd,
		nativeUsage: record(actual.nativeUsage),
		metadata: actual.metadata ?? {},
	};
}

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
	return {
		code,
		reason,
		retryable: options.retryable ?? true,
		metadata: options.metadata ?? {},
	};
}

export function isAgentModeAllowedForClass(
	mode: AgentExecutionMode,
	agentClass?: Pick<ProjectAgentClass, 'allowedModes' | 'status'> | null,
	profile?: Pick<AgentKernelProfile, 'allowedModes'> | null,
): boolean {
	if (agentClass?.status && agentClass.status !== 'active') return false;
	const classModes = Array.isArray(agentClass?.allowedModes) ? agentClass.allowedModes : [];
	if (classModes.length && !classModes.includes(mode)) return false;
	const profileModes = Array.isArray(profile?.allowedModes) ? profile.allowedModes : [];
	if (profileModes.length && !profileModes.includes(mode)) return false;
	return true;
}

export function deriveAgentCapacityEnvelopeFromAssignment(
	assignment: Pick<ProviderAssignment,
		'teamId' | 'projectId' | 'mode' | 'capacityProviderId' | 'executionProviderId' | 'allocationSetId' |
		'projectAgentClassId' | 'reservationId' | 'workDayId' | 'capacityEnvelope'>,
): AgentCapacityEnvelope {
	const envelope = record(assignment.capacityEnvelope);
	return {
		teamId: String(envelope.teamId ?? assignment.teamId),
		projectId: String(envelope.projectId ?? assignment.projectId),
		workDayId: typeof envelope.workDayId === 'string' ? envelope.workDayId : assignment.workDayId ?? null,
		environment: typeof envelope.environment === 'string' ? envelope.environment : null,
		allocationSetId: typeof envelope.allocationSetId === 'string' ? envelope.allocationSetId : assignment.allocationSetId ?? null,
		mode: normalizeAgentExecutionMode(envelope.mode ?? assignment.mode),
		projectAgentClassId: typeof envelope.projectAgentClassId === 'string' ? envelope.projectAgentClassId : assignment.projectAgentClassId,
		capacityProviderId: typeof envelope.capacityProviderId === 'string' ? envelope.capacityProviderId : assignment.capacityProviderId,
		executionProviderId: typeof envelope.executionProviderId === 'string' ? envelope.executionProviderId : assignment.executionProviderId ?? null,
		laneId: typeof envelope.laneId === 'string' ? envelope.laneId : null,
		reservationId: typeof envelope.reservationId === 'string' ? envelope.reservationId : assignment.reservationId ?? null,
		nativeUnit: typeof envelope.nativeUnit === 'string' ? envelope.nativeUnit : null,
		reservedNativeAmount: numberOrNull(envelope.reservedNativeAmount),
		availableCredits: numberOrNull(envelope.availableCredits),
		reservedCredits: numberOrNull(envelope.reservedCredits),
		consumedCredits: numberOrNull(envelope.consumedCredits),
		limits: record(envelope.limits),
		metadata: record(envelope.metadata),
	};
}

export function deriveDecisionExecutionInputFromAssignment(
	assignment: Pick<ProviderAssignment,
		'teamId' | 'projectId' | 'projectAgentClassId' | 'mode' | 'taskId' | 'workDayId' | 'agentId' |
		'handlerId' | 'decisionInput' | 'capacityEnvelope'>,
): DecisionExecutionInput {
	const decision = record(assignment.decisionInput);
	return {
		teamId: String(decision.teamId ?? assignment.teamId),
		projectId: String(decision.projectId ?? assignment.projectId),
		projectAgentClassId: String(decision.projectAgentClassId ?? assignment.projectAgentClassId),
		mode: normalizeAgentExecutionMode(decision.mode ?? assignment.mode),
		taskId: typeof decision.taskId === 'string' ? decision.taskId : assignment.taskId ?? null,
		workDayId: typeof decision.workDayId === 'string' ? decision.workDayId : assignment.workDayId ?? null,
		agentId: typeof decision.agentId === 'string' ? decision.agentId : assignment.agentId ?? null,
		handlerId: typeof decision.handlerId === 'string' ? decision.handlerId : assignment.handlerId ?? null,
		capacity: deriveAgentCapacityEnvelopeFromAssignment(assignment),
		input: record(decision.input),
		metadata: record(decision.metadata),
	};
}

export function validateAgentKernelModeExecutionInput(input: AgentKernelModeExecutionInput): AgentKernelModeFallback | null {
	const assignment = input.assignment;
	const now = input.now instanceof Date ? input.now : new Date(input.now ?? Date.now());
	if (isProviderAssignmentLeaseExpired(assignment, now)) {
		return createAgentKernelModeFallback(
			'assignment_lease_expired',
			`Assignment ${assignment.id} lease expired before execution.`,
			{ retryable: true },
		);
	}
	if (!assignment.projectId || !assignment.agentId && !deriveDecisionExecutionInputFromAssignment(assignment).agentId) {
		return createAgentKernelModeFallback(
			'assignment_missing_project_or_agent',
			`Assignment ${assignment.id} is missing project or agent routing.`,
			{ retryable: false },
		);
	}
	const mode = normalizeAgentExecutionMode(assignment.mode);
	const profile = input.kernelProfile ?? input.projectAgentClass?.kernelProfile ?? null;
	if (!isAgentModeAllowedForClass(mode, input.projectAgentClass, profile)) {
		return createAgentKernelModeFallback(
			'assignment_mode_not_allowed',
			`Assignment ${assignment.id} mode ${mode} is not allowed for the project agent class.`,
			{ retryable: false },
		);
	}
	const capacity = input.capacityEnvelope ?? deriveAgentCapacityEnvelopeFromAssignment(assignment);
	if (capacity.mode !== mode) {
		return createAgentKernelModeFallback(
			'assignment_missing_capacity_envelope',
			`Assignment ${assignment.id} capacity envelope does not match selected mode ${mode}.`,
			{ retryable: false },
		);
	}
	const decision = input.decisionInput ?? deriveDecisionExecutionInputFromAssignment(assignment);
	if (decision.mode !== mode || decision.projectId !== assignment.projectId) {
		return createAgentKernelModeFallback(
			'assignment_missing_decision_input',
			`Assignment ${assignment.id} decision input does not match assignment scope.`,
			{ retryable: false },
		);
	}
	if (mode === 'acting' && input.readiness && !isDecisionReadyForActing(input.readiness)) {
		return createAgentKernelModeFallback(
			'assignment_decision_not_ready',
			`Assignment ${assignment.id} is not ready for acting execution.`,
			{ retryable: true, metadata: { readiness: input.readiness } },
		);
	}
	if (mode === 'acting' && !input.readiness) {
		return createAgentKernelModeFallback(
			'assignment_decision_not_ready',
			`Assignment ${assignment.id} is missing decision readiness for acting execution.`,
			{ retryable: true },
		);
	}
	if (mode === 'acting' && (!capacity.reservationId || Number(capacity.reservedCredits ?? 0) <= 0)) {
		return createAgentKernelModeFallback(
			'assignment_capacity_not_reserved',
			`Assignment ${assignment.id} is missing reserved capacity for acting execution.`,
			{ retryable: true, metadata: { reservationId: capacity.reservationId ?? null, reservedCredits: capacity.reservedCredits ?? null } },
		);
	}
	if (mode === 'acting' && !hasAcceptedCapacityPlanProvenance({ assignment, decisionInput: decision, capacityEnvelope: capacity })) {
		return createAgentKernelModeFallback(
			'assignment_capacity_plan_not_accepted',
			`Assignment ${assignment.id} is missing accepted capacity-plan provenance for acting execution.`,
			{ retryable: true },
		);
	}
	const policyMaxAttempts = numberOrNull(record(input.kernelPolicy?.fallback).maxAttempts)
		?? numberOrNull(record(input.projectAgentClass?.kernelPolicy?.fallback).maxAttempts)
		?? numberOrNull(record(input.kernelProfile?.metadata).maxAttempts);
	if (policyMaxAttempts !== null && Number(assignment.attemptCount ?? 0) >= policyMaxAttempts) {
		return createAgentKernelModeFallback(
			'assignment_retry_policy_exceeded',
			`Assignment ${assignment.id} has exceeded kernel retry policy.`,
			{ retryable: false, metadata: { attemptCount: assignment.attemptCount ?? 0, maxAttempts: policyMaxAttempts } },
		);
	}
	const assignmentMetadata = record(assignment.metadata);
	const eligibility = record(assignmentMetadata.eligibility);
	const eligibilityGates = record(eligibility.gates);
	const explanationGates = record(record(assignment.explanation).gates);
	const explanationSupply = record(explanationGates.supply);
	const explanationCapabilitySupply = record(explanationGates.capabilitySupply);
	const demand = compileExecutionCapabilityDemand({
		projectAgentClass: input.projectAgentClass,
		decisionInput: decision,
		capacityEnvelope: capacity,
		assignment,
		mode,
	});
	const requiredCapabilities = uniqueStrings([
		...demand.required,
		...stringList(input.projectAgentClass?.requiredCapabilities),
		...stringList(assignmentMetadata.requiredCapabilities),
		...stringList(record(decision.metadata).requiredCapabilities),
		...stringList(record(capacity.metadata).requiredCapabilities),
	]);
	const availableCapabilities = uniqueStrings([
		...stringList(eligibilityGates.availableCapabilities),
		...stringList(explanationGates.availableCapabilities),
		...stringList(explanationGates.aliasCapabilities),
		...stringList(explanationSupply.capabilities),
		...stringList(explanationSupply.aliases),
		...stringList(explanationCapabilitySupply.capabilities),
		...stringList(explanationCapabilitySupply.aliases),
		...stringList(assignmentMetadata.availableCapabilities),
	]);
	const missingCapabilities = requiredCapabilities.filter((capability) => !availableCapabilities.includes(capability));
	if (requiredCapabilities.length && (!availableCapabilities.length || missingCapabilities.length)) {
		return createAgentKernelModeFallback(
			'assignment_eligibility_capability_mismatch',
			`Assignment ${assignment.id} required capabilities were not covered by eligibility metadata.`,
			{ retryable: true, metadata: { requiredCapabilities, availableCapabilities, missingCapabilities, source: 'execution_capability_eligibility' } },
		);
	}
	const capabilityHandleFallback = validateProviderAssignmentCapabilityHandles({
		assignment,
		decisionInput: decision,
		capacityEnvelope: capacity,
		now,
	});
	if (capabilityHandleFallback) return capabilityHandleFallback;
	const proxyFallback = validateTreeDxProxyHandle(input.treedxProxyHandle ?? record(assignment.treedxProxyHandle) as TreeDxProxyHandle, {
		teamId: assignment.teamId,
		projectId: assignment.projectId,
		assignmentId: assignment.id,
	});
	if (proxyFallback) return proxyFallback;
	return null;
}

export function selectAgentKernelModeDecision(observation: AgentKernelQueueObservation): AgentKernelModeDecision {
	const planningReady = Math.max(0, Number(observation.planningReady ?? 0));
	const actingReady = Math.max(0, Number(observation.actingReady ?? 0));
	const fallbackReady = Math.max(0, Number(observation.fallbackReady ?? 0));
	const planningBudget = Number(observation.planningBudgetCredits ?? 0);
	const actingBudget = Number(observation.actingBudgetCredits ?? 0);
	const hasPlanningBudget = !Number.isFinite(planningBudget) || planningBudget > 0;
	const hasActingBudget = !Number.isFinite(actingBudget) || actingBudget > 0;
	if (observation.modePreference === 'planning' && planningReady > 0 && hasPlanningBudget) {
		return { kind: 'mode', mode: 'planning', reason: 'preferred_planning_ready', metadata: observation.metadata ?? {} };
	}
	if (observation.modePreference === 'acting' && actingReady > 0 && hasActingBudget) {
		return { kind: 'mode', mode: 'acting', reason: 'preferred_acting_ready', metadata: observation.metadata ?? {} };
	}
	if (actingReady > 0 && hasActingBudget) {
		return { kind: 'mode', mode: 'acting', reason: 'acting_queue_ready', metadata: observation.metadata ?? {} };
	}
	if (planningReady > 0 && hasPlanningBudget) {
		return { kind: 'mode', mode: 'planning', reason: 'planning_queue_ready', metadata: observation.metadata ?? {} };
	}
	if (fallbackReady > 0) {
		return { kind: 'fallback', mode: null, reason: 'fallback_queue_ready', metadata: observation.metadata ?? {} };
	}
	return { kind: 'idle', mode: null, reason: 'no_eligible_work', metadata: observation.metadata ?? {} };
}

export function validateAgentKernelOutputs(input: {
	mode: AgentExecutionMode;
	outputs?: Record<string, unknown> | null;
	allowedOutputs?: Record<string, unknown> | null;
}): AgentKernelOutputValidationResult {
	const allowed = record(input.allowedOutputs);
	if (!Object.keys(allowed).length) return { ok: true };
	const outputs = record(input.outputs);
	const allowedStatuses = Array.isArray(allowed.statuses) ? allowed.statuses.map(String) : [];
	const status = typeof outputs.status === 'string' ? outputs.status : null;
	if (allowedStatuses.length && (!status || !allowedStatuses.includes(status))) {
		return { ok: false, reason: `Output status ${status ?? '<missing>'} is not allowed for ${input.mode}.`, metadata: { status, allowedStatuses } };
	}
	const allowedTypes = Array.isArray(allowed.types) ? allowed.types.map(String) : [];
	const metadata = record(outputs.metadata);
	const outputType = typeof metadata.type === 'string'
		? metadata.type
		: typeof metadata.kind === 'string'
			? metadata.kind
			: null;
	if (allowedTypes.length && (!outputType || !allowedTypes.includes(outputType))) {
		return { ok: false, reason: `Output type ${outputType ?? '<missing>'} is not allowed for ${input.mode}.`, metadata: { outputType, allowedTypes } };
	}
	return { ok: true };
}

export function treeDxProxyHeaders(handle: TreeDxProxyHandle): Record<string, string> {
	const headers: Record<string, string> = {
		'x-treeseed-assignment-id': String(handle.assignmentId ?? ''),
		'x-treeseed-treedx-proxy-handle-id': String(handle.id ?? ''),
	};
	if (handle.token) headers['x-treeseed-treedx-proxy-handle'] = handle.token;
	return Object.fromEntries(Object.entries(headers).filter(([, value]) => value));
}

export function isAgentCapacityPlanStaleOrSuperseded(plan: Pick<AgentCapacityPlanRecord, 'status'> & { scopeHash?: string | null }, currentScopeHash?: string | null): boolean {
	if (plan.status === 'superseded') return true;
	return Boolean(currentScopeHash && plan.scopeHash && currentScopeHash !== plan.scopeHash);
}

export function hasAcceptedCapacityPlanProvenance(input: {
	assignment?: Pick<ProviderAssignment, 'metadata' | 'decisionInput' | 'capacityEnvelope' | 'synthesizedFrom'> | null;
	decisionInput?: DecisionExecutionInput | null;
	capacityEnvelope?: AgentCapacityEnvelope | null;
}): boolean {
	const assignmentMetadata = record(input.assignment?.metadata);
	const decisionMetadata = record(input.decisionInput?.metadata ?? record(input.assignment?.decisionInput).metadata);
	const capacityMetadata = record(input.capacityEnvelope?.metadata ?? record(input.assignment?.capacityEnvelope).metadata);
	const status = String(
		assignmentMetadata.capacityPlanStatus
		?? decisionMetadata.capacityPlanStatus
		?? capacityMetadata.capacityPlanStatus
		?? '',
	);
	const capacityPlanId = assignmentMetadata.capacityPlanId ?? decisionMetadata.capacityPlanId ?? capacityMetadata.capacityPlanId;
	const synthesizedFrom = input.assignment?.synthesizedFrom ?? assignmentMetadata.synthesizedFrom ?? capacityMetadata.synthesizedFrom;
	return Boolean(capacityPlanId && (['accepted', 'scheduled', 'active'].includes(status) || synthesizedFrom === 'capacity_plan'));
}

export function isProviderAssignmentLeaseExpired(assignment: Pick<ProviderAssignment, 'leaseExpiresAt'>, now = new Date()): boolean {
	if (!assignment.leaseExpiresAt) return false;
	const expiresAt = Date.parse(assignment.leaseExpiresAt);
	return Number.isFinite(expiresAt) && expiresAt <= now.getTime();
}

export function isProviderAssignmentLeasable(assignment: Pick<ProviderAssignment, 'status' | 'leaseState' | 'leaseExpiresAt'>, now = new Date()): boolean {
	if (assignment.status === 'pending' && assignment.leaseState === 'unleased') return true;
	if (assignment.status === 'returned' && assignment.leaseState === 'released') return true;
	if (assignment.leaseState === 'leased' && isProviderAssignmentLeaseExpired(assignment, now)) return true;
	return false;
}

const CAPACITY_RUNTIME_REASON_DETAILS: Record<string, {
	title: string;
	message: string;
	owner: CapacityRuntimeBlockerOwner;
	nextAction: string;
	severity: CapacityRuntimeBlockerSeverity;
}> = {
	provider_inactive: {
		title: 'Provider is inactive',
		message: 'The capacity provider is not currently eligible to receive work.',
		owner: 'provider_operator',
		nextAction: 'Start or reactivate the provider runtime and confirm it is checking in.',
		severity: 'danger',
	},
	provider_session_not_open: {
		title: 'Provider session is not open',
		message: 'The provider has no open availability session for this assignment.',
		owner: 'provider_operator',
		nextAction: 'Open a provider session by running the provider manager check-in loop.',
		severity: 'danger',
	},
	outside_availability_window: {
		title: 'Outside availability window',
		message: 'The provider checked in, but its availability window does not cover the current time.',
		owner: 'provider_operator',
		nextAction: 'Adjust the provider availability window or wait until the window opens.',
		severity: 'warning',
	},
	missing_required_capability: {
		title: 'Missing required capability',
		message: 'No checked-in execution provider advertised all capabilities required by the assignment.',
		owner: 'team_admin',
		nextAction: 'Update provider grants/capabilities or assign the work to a provider that supports the required capability set.',
		severity: 'danger',
	},
	missing_checked_in_grant: {
		title: 'Grant was not checked in',
		message: 'The provider did not present the grant needed for this project, class, or mode.',
		owner: 'provider_operator',
		nextAction: 'Refresh provider configuration and check in with the expected grants.',
		severity: 'danger',
	},
	missing_active_grant: {
		title: 'Grant is not active',
		message: 'A matching grant exists but is not active for assignment leasing.',
		owner: 'team_admin',
		nextAction: 'Activate or replace the capacity grant before retrying the assignment.',
		severity: 'danger',
	},
	workday_not_active: {
		title: 'Workday is not active',
		message: 'The assignment cannot lease because its workday envelope is not active.',
		owner: 'team_admin',
		nextAction: 'Start or resume the workday, or move the work to an active envelope.',
		severity: 'warning',
	},
	decision_readiness_not_ready: {
		title: 'Decision is not ready',
		message: 'The underlying decision input has not reached execution readiness.',
		owner: 'project',
		nextAction: 'Resolve open questions, accept the proposal, or mark the decision readiness gate ready.',
		severity: 'warning',
	},
	capacity_plan_not_ready: {
		title: 'Capacity plan is not ready',
		message: 'Acting work requires an accepted, scheduled, or active capacity plan.',
		owner: 'project',
		nextAction: 'Accept or schedule the capacity plan generated during planning.',
		severity: 'warning',
	},
	runner_pressure_exhausted: {
		title: 'Runner pressure exhausted',
		message: 'The provider runner reported that local concurrency, quota, or pressure limits are exhausted.',
		owner: 'provider_operator',
		nextAction: 'Wait for active work to finish or increase provider-local runner capacity.',
		severity: 'warning',
	},
	allocation_exhausted: {
		title: 'Allocation exhausted',
		message: 'The matching allocation set does not have enough remaining credits for this assignment.',
		owner: 'team_admin',
		nextAction: 'Increase allocation, change routing, or defer lower-priority work.',
		severity: 'danger',
	},
	allocation_overrun_hold: {
		title: 'Allocation overrun hold',
		message: 'The assignment would exceed allocation policy and requires overrun approval.',
		owner: 'team_admin',
		nextAction: 'Approve the overrun or adjust the capacity plan before leasing.',
		severity: 'warning',
	},
	treedx_proxy_handle_missing: {
		title: 'TreeDX proxy handle missing',
		message: 'Content-scoped work requires an assignment-scoped TreeDX proxy handle.',
		owner: 'system',
		nextAction: 'Regenerate the assignment after TreeDX workspace access is available.',
		severity: 'danger',
	},
	treedx_proxy_scope_mismatch: {
		title: 'TreeDX proxy scope mismatch',
		message: 'The TreeDX proxy handle does not match the assignment project, workspace, or operation scope.',
		owner: 'system',
		nextAction: 'Issue a fresh scoped proxy handle for this assignment.',
		severity: 'danger',
	},
	treedx_proxy_operation_denied: {
		title: 'TreeDX operation denied',
		message: 'The requested TreeDX operation is outside the handle scope.',
		owner: 'project',
		nextAction: 'Update the agent capability requirements or issue a handle with the required operation.',
		severity: 'danger',
	},
	treedx_proxy_path_denied: {
		title: 'TreeDX path denied',
		message: 'The requested content path is outside the TreeDX handle path scope.',
		owner: 'project',
		nextAction: 'Constrain the work to allowed paths or update the approved path scope.',
		severity: 'danger',
	},
	local_content_write_blocked: {
		title: 'Local content write blocked',
		message: 'Content writes must go through TreeDX when assignment workspace handles are expected.',
		owner: 'project',
		nextAction: 'Use TreeDX workspace write/commit tools for content, and reserve local files for code and artifacts.',
		severity: 'danger',
	},
	treedx_workspace_required: {
		title: 'TreeDX workspace required',
		message: 'The assignment needs a TreeDX workspace before content mutation can begin.',
		owner: 'system',
		nextAction: 'Create or attach a TreeDX workspace and retry assignment synthesis.',
		severity: 'danger',
	},
	execution_provider_prepare_rejected: {
		title: 'Execution provider rejected preparation',
		message: 'The selected execution provider could not prepare the work package.',
		owner: 'provider_operator',
		nextAction: 'Inspect provider readiness, auth, sandbox, and adapter diagnostics.',
		severity: 'danger',
	},
	assignment_output_invalid: {
		title: 'Assignment output invalid',
		message: 'The agent completed with output that did not satisfy the assignment output contract.',
		owner: 'project',
		nextAction: 'Tighten the agent output contract or fix the handler/provider output mapping.',
		severity: 'danger',
	},
};

function runtimeReasonDetails(code: string) {
	return CAPACITY_RUNTIME_REASON_DETAILS[code] ?? {
		title: code.split(/[_-]+/u).filter(Boolean).map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' ') || 'Runtime blocker',
		message: 'The assignment reported a runtime blocker that does not yet have a specialized explanation.',
		owner: 'system' as const,
		nextAction: 'Inspect the assignment explanation gates and provider runner logs.',
		severity: 'warning' as const,
	};
}

function assignmentById(assignments: ProviderAssignment[]) {
	return new Map(assignments.map((assignment) => [assignment.id, assignment]));
}

export function summarizeCapacityRuntimeDiagnostics(input: {
	projectId: string;
	teamId: string;
	generatedAt?: string;
	assignments: ProviderAssignment[];
	explanations?: ProviderAssignmentExplanation[];
	modeRuns?: AgentModeRun[];
	treeDxProxyAudit?: Array<Record<string, unknown>>;
	ledgerEntries?: Array<CapacityLedgerEntry & { assignmentId?: string | null; modeRunId?: string | null }>;
	fallbackOutputs?: Array<Record<string, unknown>>;
}): CapacityRuntimeDiagnosticsResponse {
	const assignments = input.assignments ?? [];
	const explanations = input.explanations ?? [];
	const byAssignment = assignmentById(assignments);
	const diagnostics: CapacityRuntimeBlockerVm[] = [];
	const addBlocker = (code: string, assignment?: ProviderAssignment | null, evidence: CapacityRuntimeBlockerVm['evidence'] = []) => {
		const details = runtimeReasonDetails(code);
		diagnostics.push({
			code,
			severity: details.severity,
			title: details.title,
			message: details.message,
			owner: details.owner,
			assignmentId: assignment?.id ?? null,
			projectId: assignment?.projectId ?? input.projectId,
			providerId: assignment?.capacityProviderId ?? null,
			nextAction: details.nextAction,
			evidence,
		});
	};

	for (const explanation of explanations) {
		const assignment = byAssignment.get(explanation.assignmentId) ?? null;
		for (const reason of explanation.reasons ?? []) {
			addBlocker(reason, assignment, [
				{ label: 'eligible', value: String(explanation.eligible) },
				{ label: 'source', value: String(explanation.source ?? 'unknown') },
			]);
		}
	}

	for (const assignment of assignments) {
		if (assignment.lifecycleCode) {
			addBlocker(String(assignment.lifecycleCode), assignment, [
				{ label: 'status', value: String(assignment.status) },
				{ label: 'lease', value: String(assignment.leaseState) },
			]);
		}
		if (assignment.status === 'failed') {
			addBlocker('assignment_failed', assignment, [
				{ label: 'reason', value: String(assignment.lifecycleReason ?? 'not recorded') },
			]);
		}
	}

	const auditAssignmentIds = new Set((input.treeDxProxyAudit ?? []).map((audit) => String(audit.assignmentId ?? '')).filter(Boolean));
	for (const assignment of assignments) {
		const handle = record(assignment.treedxProxyHandle);
		if (handle.id && !auditAssignmentIds.has(assignment.id) && assignment.status !== 'pending') {
			addBlocker('treedx_proxy_audit_missing', assignment, [
				{ label: 'handle', value: String(handle.id) },
				{ label: 'status', value: String(assignment.status) },
			]);
		}
	}

	const terminalPhases = new Set(['task_completed_actual_settlement', 'reservation_released', 'task_failed_refund']);
	const assignmentLedger = new Map<string, Array<CapacityLedgerEntry & { assignmentId?: string | null }>>();
	for (const entry of input.ledgerEntries ?? []) {
		const assignmentId = entry.assignmentId ?? null;
		if (!assignmentId) continue;
		assignmentLedger.set(assignmentId, [...(assignmentLedger.get(assignmentId) ?? []), entry]);
	}
	for (const assignment of assignments) {
		if (['completed', 'failed', 'returned'].includes(String(assignment.status))) {
			const hasTerminal = (assignmentLedger.get(assignment.id) ?? []).some((entry) => terminalPhases.has(String(entry.phase)));
			if (!hasTerminal && assignment.reservationId) {
				addBlocker('settlement_missing', assignment, [
					{ label: 'reservation', value: String(assignment.reservationId) },
					{ label: 'status', value: String(assignment.status) },
				]);
			}
		}
	}

	const uniqueDiagnostics = Array.from(new Map(diagnostics.map((diagnostic) => [
		`${diagnostic.assignmentId ?? 'global'}:${diagnostic.code}`,
		diagnostic,
	])).values());
	return {
		projectId: input.projectId,
		teamId: input.teamId,
		generatedAt: input.generatedAt ?? new Date().toISOString(),
		assignments,
		explanations,
		modeRuns: input.modeRuns ?? [],
		treeDxProxyAudit: input.treeDxProxyAudit ?? [],
		ledgerEntries: input.ledgerEntries ?? [],
		fallbackOutputs: input.fallbackOutputs ?? [],
		diagnostics: uniqueDiagnostics,
	};
}

export function validateCapacitySettlementInvariant(input: {
	assignment: ProviderAssignment;
	reservation?: CapacityReservation | null;
	ledgerEntries: Array<CapacityLedgerEntry & { assignmentId?: string | null; modeRunId?: string | null }>;
}): CapacitySettlementInvariantResult {
	const violations: CapacitySettlementInvariantViolation[] = [];
	const assignmentEntries = input.ledgerEntries.filter((entry) => !entry.assignmentId || entry.assignmentId === input.assignment.id);
	const byPhase = new Map<string, Array<CapacityLedgerEntry & { assignmentId?: string | null; modeRunId?: string | null }>>();
	for (const entry of assignmentEntries) {
		byPhase.set(String(entry.phase), [...(byPhase.get(String(entry.phase)) ?? []), entry]);
		if (Number(entry.credits ?? 0) < 0) {
			violations.push({ code: 'negative_consumed_credits', message: `Ledger entry ${entry.id} has negative credits.`, severity: 'error' });
		}
	}
	const completion = byPhase.get('task_completed_actual_settlement') ?? [];
	if (completion.length > 1) {
		violations.push({ code: 'duplicate_completion_settlement', message: `Assignment ${input.assignment.id} has ${completion.length} completion settlement entries.`, severity: 'error' });
	}
	const releases = byPhase.get('reservation_released') ?? [];
	if (input.reservation && releases.length) {
		const consumed = Math.max(...completion.map((entry) => Number(entry.credits ?? 0)), Number(input.reservation.consumedCredits ?? 0), 0);
		const reserved = Number(input.reservation.reservedCredits ?? 0);
		const released = releases.reduce((sum, entry) => sum + Number(entry.credits ?? 0), 0);
		if (released > Math.max(0, reserved - consumed) + 0.000001) {
			violations.push({ code: 'reservation_release_exceeds_unused', message: `Released ${released} credits exceeds unused reservation ${Math.max(0, reserved - consumed)}.`, severity: 'error' });
		}
	}
	const refunds = byPhase.get('task_failed_refund') ?? [];
	if (input.reservation && refunds.reduce((sum, entry) => sum + Number(entry.credits ?? 0), 0) > Number(input.reservation.reservedCredits ?? 0) + 0.000001) {
		violations.push({ code: 'refund_exceeds_reserved', message: 'Failure refund exceeds reserved credits.', severity: 'error' });
	}
	if (input.assignment.status === 'completed' && completion.length === 0 && input.assignment.reservationId) {
		violations.push({ code: 'completed_assignment_missing_settlement', message: 'Completed assignment with a reservation has no completion settlement.', severity: 'error' });
	}
	if (input.assignment.status === 'completed') {
		const hasModeRun = Boolean(input.assignment.lifecycleOutput?.modeRunId ?? input.assignment.lifecycleOutput?.usageActualId ?? completion.some((entry) => entry.modeRunId));
		if (!hasModeRun) {
			violations.push({ code: 'completed_assignment_missing_mode_run_or_usage', message: 'Completed assignment does not link a mode run or usage actual.', severity: 'warning' });
		}
	}
	if (input.assignment.mode === 'acting' && !hasAcceptedCapacityPlanProvenance({ assignment: input.assignment })) {
		violations.push({ code: 'acting_assignment_missing_capacity_plan_provenance', message: 'Acting assignment lacks accepted, scheduled, or active capacity-plan provenance.', severity: 'error' });
	}
	const hasErrors = violations.some((violation) => violation.severity === 'error');
	return {
		ok: violations.length === 0,
		status: hasErrors ? 'fail' : violations.length ? 'warning' : 'pass',
		violations,
	};
}
