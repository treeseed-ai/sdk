import type {
	AgentCapacityEnvelope,
	AgentExecutionMode,
	DecisionExecutionInput,
	WorkdayCapacityEnvelope,
} from './assignment-records.ts';

export type DecisionExecutionReadinessStatus = 'draft' | 'blocked' | 'ready' | 'stale' | 'waived';
export type PlanningInputRequestStatus = 'requested' | 'complete' | 'waived' | 'rejected' | 'stale';
export type DecisionExecutionInputStatus = 'proposed' | 'accepted' | 'revision_requested' | 'rejected' | 'stale';
export type WorkdayCapacityEnvelopeStatus = 'draft' | 'queued' | 'active' | 'paused' | 'completed' | 'cancelled' | 'failed' | 'degraded';
export type DurableAgentCapacityPlanStatus = 'draft' | 'accepted' | 'revision_requested' | 'deferred' | 'scheduled' | 'active' | 'completed' | 'superseded';

export interface DecisionPlanningStatus {
	id: string;
	teamId: string;
	projectId: string;
	decisionId: string;
	humanApprovalState?: string | null;
	executionReadiness: DecisionExecutionReadinessStatus;
	planningInputsStatus: PlanningInputRequestStatus;
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
	status: PlanningInputRequestStatus;
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
	workGraphNodeId?: string | null;
	projectAgentClassId: string;
	mode: AgentExecutionMode;
	status: DecisionExecutionInputStatus;
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
	workdayRunId?: string | null;
	allocationSetId?: string | null;
	status: WorkdayCapacityEnvelopeStatus;
	startedAt?: string | null;
	pausedAt?: string | null;
	completedAt?: string | null;
	envelope: WorkdayCapacityEnvelope;
	metadata?: Record<string, unknown>;
	createdAt?: string;
	updatedAt?: string;
}

export interface AgentCapacityPlanWorkUnit {
	id: string;
	decisionExecutionInputId: string;
	decisionId: string;
	workGraphNodeId?: string | null;
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
	status: DurableAgentCapacityPlanStatus;
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
