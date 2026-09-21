import type { AgentExecutionMode } from '../capacity/assignments/assignment-records.ts';

export type DecisionExecutionReadinessStatus = 'draft' | 'blocked' | 'ready' | 'stale' | 'waived';
export type PlanningInputRequestStatus = 'requested' | 'complete' | 'waived' | 'rejected' | 'stale';

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
