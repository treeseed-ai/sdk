import type { CapacityPageInfo } from '../../../capacity/capacity-core/capacity-pagination.ts';
import type { ExecutionCapabilityDemand,ExecutionCapabilitySupply } from '../../../types/agents.ts';
import type { AgentExecutionMode,ProviderAssignment,ProviderAssignmentSynthesisSource,TreeDxProxyHandle } from '../capacity/assignments/assignment-records.ts';
import type { CapacityLedgerEntry } from '../support/financial-records.ts';

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

export interface AgentKernelModeFallback {
	code: AgentKernelModeFallbackCode | string;
	reason: string;
	retryable: boolean;
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
	treeDxProxyAudit: Array<Record<string, unknown>>;
	ledgerEntries: CapacityLedgerEntry[];
	fallbackOutputs: Array<Record<string, unknown>>;
	diagnostics: CapacityRuntimeBlockerVm[];
	windows: {
		assignments: CapacityPageInfo & { total: number };
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
