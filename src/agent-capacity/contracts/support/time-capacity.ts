export const CAPACITY_BUDGET_SCHEMA = 'treeseed.capacity-budget/v2' as const;

export interface CapacityTimeDimensions {
	requestedSeconds: number;
	/** Productive provider execution time. Preparation and closeout are separate. */
	executionSeconds?: number;
	preparationSeconds?: number;
	closeoutSeconds?: number;
	reservedSeconds: number;
	activeSeconds: number;
	elapsedSeconds: number;
	releasedSeconds: number;
	overrunSeconds: number;
	hardDeadlineAt?: string | null;
	authorityDeadlineAt?: string | null;
	preparationStartedAt?: string | null;
	preparationDeadlineAt?: string | null;
	executionStartedAt?: string | null;
	executionDeadlineAt?: string | null;
	closeoutStartedAt?: string | null;
	closeoutDeadlineAt?: string | null;
	remainingSeconds?: number | null;
	closeoutWarningSeconds?: number | null;
}

export type AssignmentTimePhase = 'preparation' | 'working' | 'closeout' | 'expired';

export function assignmentTimeWindow(time: Partial<CapacityTimeDimensions>, nowMs = Date.now()) {
	const timestamp = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
	const phased=time.preparationDeadlineAt!==undefined||time.executionStartedAt!==undefined||time.executionDeadlineAt!==undefined||time.closeoutDeadlineAt!==undefined;
	if(!phased){
		const deadline=timestamp(time.hardDeadlineAt); const remaining=deadline===null?null:Math.max(0,Math.floor((deadline-nowMs)/1_000)); const warning=Number(time.closeoutWarningSeconds??0);
		const phase:AssignmentTimePhase=remaining===0?'expired':remaining!==null&&remaining<=warning?'closeout':'working';
		return { phase,deadlineAt:typeof time.hardDeadlineAt==='string'?time.hardDeadlineAt:null,preparationRemainingSeconds:0,executionRemainingSeconds:phase==='working'?remaining:0,closeoutRemainingSeconds:phase==='closeout'?remaining:0,shouldCloseOut:phase==='closeout'||phase==='expired' };
	}
	const preparationDeadlineMs = timestamp(time.preparationDeadlineAt);
	const executionStartedMs = timestamp(time.executionStartedAt);
	const executionDeadlineMs = timestamp(time.executionDeadlineAt);
	const closeoutDeadlineMs = timestamp(time.closeoutDeadlineAt ?? time.hardDeadlineAt);
	let phase: AssignmentTimePhase;
	if (closeoutDeadlineMs !== null && nowMs >= closeoutDeadlineMs) phase = 'expired';
	else if (executionStartedMs === null) phase = preparationDeadlineMs !== null && nowMs >= preparationDeadlineMs ? 'closeout' : 'preparation';
	else if (executionDeadlineMs !== null && nowMs >= executionDeadlineMs) phase = 'closeout';
	else phase = 'working';
	const remaining = (deadline: number | null) => deadline === null ? null : Math.max(0, Math.floor((deadline - nowMs) / 1_000));
	return {
		phase,
		deadlineAt: phase === 'preparation' ? time.preparationDeadlineAt ?? null : phase === 'working' ? time.executionDeadlineAt ?? null : time.closeoutDeadlineAt ?? time.hardDeadlineAt ?? null,
		preparationRemainingSeconds: phase === 'preparation' ? remaining(preparationDeadlineMs) : 0,
		executionRemainingSeconds: phase === 'working' ? remaining(executionDeadlineMs) : phase === 'preparation' ? Number(time.executionSeconds ?? time.requestedSeconds) : 0,
		closeoutRemainingSeconds: phase === 'closeout' ? remaining(closeoutDeadlineMs) : phase === 'expired' ? 0 : Number(time.closeoutSeconds ?? time.closeoutWarningSeconds ?? 0),
		shouldCloseOut: phase === 'closeout' || phase === 'expired',
	};
}

export interface CapacityTokenDimensions {
	inputTokens: number;
	cachedInputTokens: number;
	reasoningTokens: number;
	outputTokens: number;
	warningTokens?: number | null;
	hardLimitTokens?: number | null;
	hardLimitEnforceable: boolean;
}

export interface CapacityCostDimensions {
	amount: number;
	currency: string;
	warningAmount?: number | null;
	hardLimitAmount?: number | null;
	hardLimitEnforceable: boolean;
}

export interface CapacityNativeDimensions {
	unit: string;
	observed: number;
	cap?: number | null;
	capEnforceable: boolean;
}

export interface CapacityBudgetV2 {
	schemaVersion: typeof CAPACITY_BUDGET_SCHEMA;
	time: CapacityTimeDimensions;
	tokens: CapacityTokenDimensions;
	cost?: CapacityCostDimensions | null;
	native?: CapacityNativeDimensions[];
	maxAttempts: number;
	maxConcurrency?: number | null;
	deadline: string;
	pricingGeneration?: string | null;
	enforcementConfidence?: 'exact' | 'bounded' | 'estimated' | 'opaque';
	legacyAccounting?: Record<string, unknown> | null;
}

export const ASSIGNMENT_TERMINAL_DISPOSITIONS = [
	'completed',
	'completed_early',
	'deadline_exhausted',
	'budget_exhausted',
	'blocked',
	'cancelled',
	'failed',
] as const;

export type AssignmentTerminalDisposition = (typeof ASSIGNMENT_TERMINAL_DISPOSITIONS)[number];

export interface AssignmentCompletionEvidence {
	disposition: AssignmentTerminalDisposition;
	acceptanceChecks: Array<{ id: string; passed: boolean; evidenceRefs?: string[] }>;
	durableArtifactRefs: string[];
	remainingBudget: Partial<CapacityBudgetV2>;
	completionReason: string;
	noUsefulScopedWorkRemaining: boolean;
}

export const ASSIGNMENT_PERFORMANCE_SCHEMA = 'treeseed.assignment-performance/v2' as const;

export interface AssignmentConfigurationAttribution {
	planningGraphRevision: string | null;
	agentDefinitionRevision: string | null;
	agentClassRevision: string | null;
	activityProfileRevision: string | null;
	handlerRevision: string | null;
	groupMembershipRevision: string | null;
	executionProviderConfigurationRevision: string | null;
}

export interface AssignmentDownstreamOutcome {
	kind: 'validation' | 'revision' | 'rejection' | 'review' | 'signal' | 'integration' | 'deployment';
	status: string;
	evidenceRefs: string[];
	artifactMutationReceiptIds: string[];
	proposalId?: string | null;
	proposalVersion?: number | null;
	occurredAt: string;
}

export interface AssignmentPerformanceSummary {
	schemaVersion: typeof ASSIGNMENT_PERFORMANCE_SCHEMA;
	assignmentId: string;
	workdayId: string | null;
	teamId: string;
	projectId: string;
	agentId: string | null;
	agentClassId: string;
	activityProfile: string;
	handlerId: string | null;
	capacityProviderId: string;
	executionProviderId: string | null;
	model: string | null;
	groupIds: string[];
	configuration: AssignmentConfigurationAttribution;
	taskSignature: string;
	disposition: AssignmentTerminalDisposition;
	reason: string;
	acceptanceChecks: AssignmentCompletionEvidence['acceptanceChecks'];
	completedScope: string[];
	remainingScope: string[];
	artifactRefs: string[];
	budget: CapacityBudgetV2;
	actual: {
		preparationSeconds: number;
		executionSeconds: number;
		closeoutSeconds: number;
		custodySeconds: number;
		activeSeconds: number;
		elapsedSeconds: number;
		inputTokens: number;
		cachedInputTokens: number;
		reasoningTokens: number;
		outputTokens: number;
		costAmount: number | null;
		costCurrency: string | null;
		native: CapacityNativeDimensions[];
		attempts: number;
	};
	noUsefulScopedWorkRemaining: boolean;
	agentAssessment: Record<string, unknown> | null;
	systemAssessment: { generatedBy: 'agent-runner' | 'api-recovery'; measuredAt: string; enforcementConfidence: CapacityBudgetV2['enforcementConfidence'] };
	downstreamOutcomes: AssignmentDownstreamOutcome[];
}

export interface WorkdayTimePolicy {
	cooperativePlanningPercent: number;
	governedExecutionPercent: number;
	reservePercent: number;
}

export function validateWorkdayTimePolicy(policy: WorkdayTimePolicy): { ok: boolean; diagnostics: Array<{ code: string; path: string; message: string }>; value?: WorkdayTimePolicy } {
	const values = [policy.cooperativePlanningPercent, policy.governedExecutionPercent, policy.reservePercent];
	if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 100)) return { ok: false, diagnostics: [{ code: 'workday_time_percent_invalid', path: 'timePolicy', message: 'Workday time percentages must be finite values from 0 through 100.' }] };
	if (Math.abs(values.reduce((sum, value) => sum + value, 0) - 100) >= 0.000001) return { ok: false, diagnostics: [{ code: 'workday_time_total_invalid', path: 'timePolicy', message: 'Workday time percentages must total exactly 100%.' }] };
	return { ok: true, diagnostics: [], value: policy };
}

export function emptyCapacityBudget(deadline: string, requestedSeconds: number): CapacityBudgetV2 {
	return {
		schemaVersion: CAPACITY_BUDGET_SCHEMA,
		time: { requestedSeconds, reservedSeconds: 0, activeSeconds: 0, elapsedSeconds: 0, releasedSeconds: 0, overrunSeconds: 0 },
		tokens: { inputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0, outputTokens: 0, hardLimitEnforceable: false },
		maxAttempts: 1,
		deadline,
	};
}
