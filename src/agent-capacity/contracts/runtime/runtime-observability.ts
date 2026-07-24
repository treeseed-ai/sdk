import type { CapacityLedgerEntry, CapacityReservation, CapacityUsageActual } from '../support/financial-records.ts';
import type { AgentCapacityEnvelope, AgentExecutionMode, AgentModeRun, DecisionExecutionInput, ProviderAssignment, ProviderAssignmentSynthesisSource, TreeDxProxyHandle, WorkdayCapacityEnvelope } from '../capacity/assignments/assignment-records.ts';
import type { CapacityGrantV2 } from '../../allocation.ts';
import type { AgentCapacityPlanRecord, DecisionExecutionInputStatus, DecisionExecutionReadinessStatus, DurableAgentCapacityPlanStatus, PlanningInputRequestStatus, WorkdayCapacityEnvelopeRecord, WorkdayCapacityEnvelopeStatus } from '../support/planning-records.ts';
import type { AgentKernelPolicy, AgentKernelProfile } from '../projects/agents/project-agent-class.ts';
import type { CapacityExecutionProvider, ProviderAvailabilitySession } from '../../../capacity-provider/contracts/index.ts';
import type { CapacityPageInfo } from '../../../capacity/capacity-core/capacity-pagination.ts';
import type { AgentRuntimeSpec, AgentWorkPackage, ExecutionCapabilityDemand, ExecutionCapabilitySupply, ExecutionProviderDescriptor, ExecutionResourceNeed } from '../../../types/agents.ts';

export type AgentKernelModeExecutionStatus = 'completed' | 'waiting' | 'failed' | 'returned';
export type AgentKernelModeFallbackCode =
	| 'assignment_missing_project_or_agent'
	| 'assignment_governance_provenance_missing'
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
	| 'assignment_repository_ref_scope_invalid'
	| 'assignment_workflow_operation_denied'
	| 'assignment_eligibility_capability_mismatch'
	| 'assignment_retry_policy_exceeded'
	| 'assignment_treedx_proxy_scope_invalid'
	| 'assignment_fallback_quota_exceeded'
	| 'assignment_output_invalid';

export interface AgentCapacityPlan {
	teamId: string;
	projectId: string;
	environment: string;
	allocationSetId?: string | null;
	workday: WorkdayCapacityEnvelope;
	assignableProviders: Array<{
		capacityProviderId: string;
		executionProviderId?: string | null;
		availableCredits?: number | null;
		reasons?: string[];
		metadata?: Record<string, unknown>;
	}>;
	metadata?: Record<string, unknown>;
}

export interface AgentKernelModeFallback {
	code: AgentKernelModeFallbackCode | string;
	reason: string;
	retryable: boolean;
	metadata?: Record<string, unknown>;
}

export interface AgentKernelModeExecutionInput {
	assignment: ProviderAssignment;
	modeRunId?: string | null;
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
	artifactManifest?: import('../../artifacts.ts').AgentArtifactManifest | null;
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
	ledgerEntries: CapacityLedgerEntry[];
	fallbackOutputs: Array<Record<string, unknown>>;
	diagnostics: CapacityRuntimeBlockerVm[];
	windows: {
		assignments: CapacityPageInfo & { total: number };
		modeRuns: CapacityPageInfo & { total: number };
		treeDxProxyAudit: CapacityPageInfo & { total: number };
		ledgerEntries: CapacityPageInfo & { total: number };
		fallbackOutputs: CapacityPageInfo & { total: number };
	};
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

export interface CapacityEvidenceWindow<T> {
	items: T[];
	page: CapacityPageInfo;
	total: number;
}

export interface WorkdayCapacitySummaryTotals {
	assignments: {
		total: number;
		pending: number;
		leased: number;
		completed: number;
		failed: number;
		returned: number;
		cancelled: number;
	};
	modeRuns: {
		total: number;
		queued: number;
		running: number;
		succeeded: number;
		failed: number;
		usageReported: number;
	};
	reservations: number;
	usageActuals: number;
	ledgerEntries: number;
}

export interface WorkdayCapacitySummaryPayload {
	workday: WorkdayCapacityEnvelopeRecord;
	totals: WorkdayCapacitySummaryTotals;
	settlement: CapacitySettlementSummary;
	evidence: {
		assignments: CapacityEvidenceWindow<ProviderAssignment>;
		modeRuns: CapacityEvidenceWindow<AgentModeRun>;
		reservations: CapacityEvidenceWindow<CapacityReservation>;
		usageActuals: CapacityEvidenceWindow<CapacityUsageActual>;
		ledgerEntries: CapacityEvidenceWindow<CapacityLedgerEntry>;
	};
}
