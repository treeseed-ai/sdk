/** Portable durable records shared by workday control-plane and operator consumers. */

export type CapacityWorkdayRunStatus =
	| 'queued'
	| 'running'
	| 'completed'
	| 'cancelled'
	| 'failed'
	| 'degraded';

export type CapacityWorkdayEventStatus =
	| 'recorded'
	| 'active'
	| 'completed'
	| 'warning'
	| 'error'
	| 'failed';

export type CapacityWorkdayDemandSource =
	| 'objective'
	| 'question'
	| 'proposal'
	| 'decision-review'
	| 'knowledge-gap'
	| 'release-readiness'
	| 'idle-intent'
	| 'planning-input'
	| 'capacity-plan'
	| 'assignment-completion'
	| 'assignment-blockage'
	| 'workday-summary'
	| 'handoff'
	| 'research-workflow';

export type CapacityWorkdayDemandStatus =
	| 'pending'
	| 'claimed'
	| 'admitted'
	| 'completed'
	| 'blocked'
	| 'cancelled'
	| 'superseded';

export type CapacityWorkdayParticipationCycleStatus = 'open' | 'covered' | 'closed';

export type CapacityWorkdayParticipationEntryStatus =
	| 'pending'
	| 'assigned'
	| 'completed'
	| 'excluded'
	| 'blocked';

export interface CapacityWorkdayRunRecord {
	id: string;
	teamId: string;
	capacityProviderId: string | null;
	scenarioId: string;
	status: CapacityWorkdayRunStatus;
	environment: string;
	requestedById: string | null;
	parameters: Record<string, unknown>;
	summary: Record<string, unknown>;
	metrics: Record<string, unknown>;
	expected: Record<string, unknown>;
	actual: Record<string, unknown>;
	reportRefs: Record<string, unknown>;
	error: Record<string, unknown>;
	startedAt: string | null;
	completedAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface CapacityWorkdayEventRecord {
	id: string;
	runId: string;
	teamId: string;
	projectId: string | null;
	workdayId: string | null;
	assignmentId: string | null;
	modeRunId: string | null;
	eventIndex: number;
	eventType: string;
	status: CapacityWorkdayEventStatus;
	title: string | null;
	message: string | null;
	parameters: Record<string, unknown>;
	context: Record<string, unknown>;
	refs: Record<string, unknown>;
	metadata: Record<string, unknown>;
	createdAt: string;
}

export interface CapacityWorkdayDemandRecord {
	id: string;
	teamId: string;
	projectId: string;
	workdayRunId: string;
	workdayId: string;
	sourceType: CapacityWorkdayDemandSource;
	sourceId: string;
	mode: 'planning' | 'acting';
	projectAgentClassId: string;
	agentId: string | null;
	handlerId: string;
	activityType: string;
	decisionId: string | null;
	capacityPlanId: string | null;
	status: CapacityWorkdayDemandStatus;
	priority: number;
	requestedCredits: number;
	idempotencyKey: string;
	claimToken: string | null;
	assignmentId: string | null;
	payload: Record<string, unknown>;
	metadata: Record<string, unknown>;
	availableAt: string;
	claimedAt: string | null;
	admittedAt: string | null;
	completedAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface CapacityWorkdayParticipationCycleRecord {
	id: string;
	teamId: string;
	projectId: string;
	workdayRunId: string;
	cycleNumber: number;
	status: CapacityWorkdayParticipationCycleStatus;
	openedAt: string;
	coveredAt: string | null;
	closedAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface CapacityWorkdayParticipationEntryRecord {
	id: string;
	cycleId: string;
	teamId: string;
	projectId: string;
	workdayRunId: string;
	agentId: string;
	projectAgentClassId: string;
	status: CapacityWorkdayParticipationEntryStatus;
	reasonCode: string | null;
	demandId: string | null;
	assignmentId: string | null;
	coveredAt: string | null;
	metadata: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}
